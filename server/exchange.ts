/**
 * Employment Exchange (Theme B / third headline feature).
 *
 * Employers already touch Skillio through the verification flow, so the only
 * new machinery here is the registry, postings, a referral pipeline, and a
 * deterministic matcher. The matcher is intentionally rule-based: every match
 * returns the factors that produced it, in keeping with the product's
 * "no black-box ranking" promise.
 *
 * A confirmed placement writes an employer-verified outcome event, which is
 * what closes the loop back into the dashboard.
 */
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  employers,
  jobApplications,
  jobPostings,
  messageJobs,
  trainees,
  type JobPosting,
  type Trainee,
} from "../drizzle/schema";
import { getMessagingProvider } from "./messaging";
import {
  InputValidationError,
  NotFoundError,
  createOutcomeEvent,
  getTraineeByRef,
  recordAudit,
  recordMessageJob,
  requireDb,
  resolveEmployeeFromToken,
  scheduleFollowUp,
  wageBandMidpoint,
  type DbOrTx,
} from "./queries";

export type MatchFactor = { label: string; points: number; detail: string };

export type MatchResult = { score: number; factors: MatchFactor[] };

const MAX_MATCH_SCORE = 100;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 160);
}

/** Courses are matched loosely: "CNC Machining" should match "cnc operator". */
function courseTokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 3);
}

/**
 * Deterministic, explainable match: district, course-tag overlap, wage fit and
 * barrier status. Returns the factor breakdown so a counsellor can see *why*.
 */
export function scoreMatch(
  trainee: Pick<Trainee, "district" | "course" | "wageBand" | "barrier" | "relevance" | "outcomeType">,
  posting: Pick<JobPosting, "district" | "courseTags" | "wageBand" | "roleCategory">
): MatchResult {
  const factors: MatchFactor[] = [];

  if (posting.district === trainee.district) {
    factors.push({
      label: "Same district",
      points: 40,
      detail: `Posting and trainee are both in ${trainee.district}`,
    });
  } else {
    factors.push({
      label: "Relocation required",
      points: 10,
      detail: `Posting is in ${posting.district}, trainee is in ${trainee.district}`,
    });
  }

  const traineeTokens = new Set(courseTokens(trainee.course));
  const tags = posting.courseTags ?? [];
  const overlap = tags.filter((tag) => courseTokens(tag).some((token) => traineeTokens.has(token)));
  if (tags.length === 0) {
    factors.push({ label: "No course tags on the posting", points: 15, detail: "Role is open to any course" });
  } else if (overlap.length > 0) {
    factors.push({
      label: "Course match",
      points: 30,
      detail: `${overlap.join(", ")} matches ${trainee.course}`,
    });
  } else {
    factors.push({
      label: "Different trade",
      points: 0,
      detail: `${trainee.course} does not match ${tags.join(", ")}`,
    });
  }

  const postingMid = wageBandMidpoint(posting.wageBand);
  const traineeMid = wageBandMidpoint(trainee.wageBand);
  if (postingMid === null || traineeMid === null) {
    factors.push({ label: "Wage band unstated", points: 10, detail: "One side has no wage band on record" });
  } else if (postingMid >= traineeMid) {
    factors.push({
      label: "No wage step down",
      points: 20,
      detail: `Posting band ₹${postingMid}k meets the current ₹${traineeMid}k`,
    });
  } else if (postingMid >= traineeMid * 0.8) {
    factors.push({
      label: "Minor wage step down",
      points: 8,
      detail: `Posting band ₹${postingMid}k is under the current ₹${traineeMid}k`,
    });
  } else {
    factors.push({
      label: "Significant wage step down",
      points: 0,
      detail: `Posting band ₹${postingMid}k is well below the current ₹${traineeMid}k`,
    });
  }

  if (!trainee.barrier) {
    factors.push({ label: "No open barrier", points: 10, detail: "No barrier signal on the latest pulse" });
  } else {
    factors.push({ label: "Barrier present", points: 0, detail: `${trainee.barrier} still reported` });
  }

  const raw = factors.reduce((sum, factor) => sum + factor.points, 0);
  return { score: Math.min(MAX_MATCH_SCORE, raw), factors };
}

/** Idempotently promotes an employer name from the verification flow. */
export async function upsertEmployer(
  handle: DbOrTx,
  input: { name: string; industry?: string | null; district?: string | null }
): Promise<number> {
  const name = input.name.trim().slice(0, 160);
  if (!name) throw new InputValidationError("Employer name is required");
  const [row] = await handle
    .insert(employers)
    .values({
      name,
      slug: slugify(name) || `employer-${Date.now()}`,
      industry: input.industry ?? null,
      district: input.district ?? null,
    })
    .onConflictDoUpdate({
      target: employers.name,
      set: { industry: input.industry ?? null, district: input.district ?? null },
    })
    .returning({ id: employers.id });
  return row.id;
}

export async function listEmployers() {
  const db = await requireDb();
  return db.select().from(employers).orderBy(employers.name);
}

export async function listPostings(opts: { district?: string; includeClosed?: boolean } = {}) {
  const db = await requireDb();
  const conditions = [];
  if (!opts.includeClosed) conditions.push(inArray(jobPostings.status, ["open"]));
  if (opts.district && opts.district !== "All districts") {
    conditions.push(eq(jobPostings.district, opts.district));
  }

  return db
    .select({
      id: jobPostings.id,
      title: jobPostings.title,
      roleCategory: jobPostings.roleCategory,
      district: jobPostings.district,
      wageBand: jobPostings.wageBand,
      courseTags: jobPostings.courseTags,
      seats: jobPostings.seats,
      status: jobPostings.status,
      closesAt: jobPostings.closesAt,
      employer: employers.name,
      industry: employers.industry,
    })
    .from(jobPostings)
    .innerJoin(employers, eq(jobPostings.employerId, employers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jobPostings.createdAt));
}

export async function createPosting(input: {
  employerName: string;
  industry?: string | null;
  district: string;
  title: string;
  roleCategory: string;
  wageBand?: string | null;
  courseTags?: string[];
  seats?: number;
  closesAt?: Date | null;
}) {
  const db = await requireDb();
  return db.transaction(async (tx) => {
    const employerId = await upsertEmployer(tx, {
      name: input.employerName,
      industry: input.industry ?? null,
      district: input.district,
    });
    const [posting] = await tx
      .insert(jobPostings)
      .values({
        employerId,
        title: input.title.slice(0, 160),
        roleCategory: input.roleCategory.slice(0, 120),
        district: input.district,
        wageBand: input.wageBand ?? null,
        courseTags: input.courseTags ?? [],
        seats: Math.max(1, input.seats ?? 1),
        closesAt: input.closesAt ?? null,
      })
      .returning({ id: jobPostings.id });
    await recordAudit(tx, {
      actorType: "staff",
      action: "posting.created",
      entityType: "jobPosting",
      entityId: posting.id,
      purposeCode: "placement_support",
      metadata: { employerName: input.employerName, district: input.district },
    });
    return { postingId: posting.id };
  });
}

/**
 * The placement board: every job seeker against every open posting, ranked by
 * the explainable score. Already-referred pairs are included with their status
 * so the board shows progress instead of hiding it.
 */
export async function getPlacementBoard(opts: { district?: string } = {}) {
  const db = await requireDb();
  const postings = await listPostings({ district: opts.district });

  const conditions = [inArray(trainees.outcomeType, ["seeking_work", "not_working"])];
  if (opts.district && opts.district !== "All districts") {
    conditions.push(eq(trainees.district, opts.district));
  }
  const seekers = await db
    .select()
    .from(trainees)
    .where(and(...conditions))
    .orderBy(trainees.displayName);

  const applications = await db
    .select({
      id: jobApplications.id,
      traineeId: jobApplications.traineeId,
      postingId: jobApplications.postingId,
      status: jobApplications.status,
      matchScore: jobApplications.matchScore,
    })
    .from(jobApplications);
  const applicationByPair = new Map(
    applications.map((application) => [`${application.traineeId}:${application.postingId}`, application])
  );

  const rows = seekers.flatMap((trainee) =>
    postings.map((posting) => {
      const match = scoreMatch(trainee, {
        district: posting.district,
        courseTags: posting.courseTags ?? [],
        wageBand: posting.wageBand,
        roleCategory: posting.roleCategory,
      });
      const application = applicationByPair.get(`${trainee.id}:${posting.id}`);
      return {
        trainee: {
          id: trainee.id,
          ref: trainee.traineeRef,
          slug: trainee.slug,
          name: trainee.displayName,
          initials: trainee.initials,
          district: trainee.district,
          course: trainee.course,
          barrier: trainee.barrier,
        },
        posting,
        match,
        application: application
          ? { id: application.id, status: application.status }
          : null,
      };
    })
  );

  return {
    seekers: seekers.length,
    postings: postings.length,
    rows: rows.sort((a, b) => b.match.score - a.match.score).slice(0, 60),
  };
}

/**
 * One-click referral: records the application, queues the outreach through the
 * messaging boundary, and audits the decision. Idempotent per pair per day.
 */
export async function referToPosting(input: {
  traineeRef: string;
  postingId: number;
  referredBy?: string | null;
}) {
  const db = await requireDb();
  const trainee = await getTraineeByRef(input.traineeRef);
  const [posting] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, input.postingId))
    .limit(1);
  if (!posting) throw new NotFoundError("Job posting", String(input.postingId));
  if (posting.status !== "open") throw new InputValidationError("This posting is no longer open.");

  const match = scoreMatch(trainee, {
    district: posting.district,
    courseTags: posting.courseTags ?? [],
    wageBand: posting.wageBand,
    roleCategory: posting.roleCategory,
  });

  const [existing] = await db
    .select({ id: jobApplications.id, status: jobApplications.status })
    .from(jobApplications)
    .where(
      and(eq(jobApplications.traineeId, trainee.id), eq(jobApplications.postingId, posting.id))
    )
    .limit(1);
  if (existing) {
    return { applicationId: existing.id, status: existing.status, duplicate: true as const };
  }

  const application = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(jobApplications)
      .values({
        traineeId: trainee.id,
        postingId: posting.id,
        status: "referred",
        referredBy: input.referredBy ?? null,
        matchScore: match.score,
        matchFactors: match.factors,
      })
      .returning({ id: jobApplications.id });

    await recordAudit(tx, {
      actorType: "staff",
      actorId: null,
      action: "placement.referred",
      entityType: "jobApplication",
      entityId: row.id,
      purposeCode: "placement_support",
      metadata: { traineeRef: trainee.traineeRef, postingId: posting.id, matchScore: match.score },
    });
    return row;
  });

  // Queue the outreach: a placement referral always has a follow-up task so the
  // message job has a parent and the counsellor sees it in the queue.
  const task = await scheduleFollowUp({
    traineeId: trainee.id,
    purposeCode: "placement_referral",
    checkpointCode: "placement_referral",
    dueAt: new Date(),
    preferredChannel: "whatsapp",
  });

  const idempotencyKey = `referral:${application.id}`;
  const { job, duplicate } = await recordMessageJob({
    followUpTaskId: task.id,
    traineeId: trainee.id,
    channel: "whatsapp",
    templateCode: "job_match_v1",
    idempotencyKey,
  });

  let providerMessageId: string | null = null;
  let failed: string | null = null;
  if (!duplicate && job) {
    if (!trainee.contactPhone) {
      failed = "no_contact_address";
      await db.update(jobApplications).set({ updatedAt: new Date() }).where(eq(jobApplications.id, application.id));
    } else {
      try {
        const result = await getMessagingProvider().send({
          channel: "whatsapp",
          to: trainee.contactPhone,
          templateCode: "job_match_v1",
          idempotencyKey,
        });
        providerMessageId = result.providerMessageId;
        await db
          .update(messageJobs)
          .set({ status: "accepted", providerMessageId: result.providerMessageId })
          .where(eq(messageJobs.id, job.id));
      } catch (error) {
        failed =
          error && typeof error === "object" && "errorCode" in error
            ? String(error.errorCode)
            : "provider_error";
        await db
          .update(messageJobs)
          .set({ status: "failed", lastErrorCode: failed })
          .where(eq(messageJobs.id, job.id));
      }
    }
  }

  return {
    applicationId: application.id,
    status: "referred" as const,
    duplicate: false as const,
    matchScore: match.score,
    providerMessageId,
    failed,
  };
}

/** Employee-side matches for the portal: open postings ranked for this person. */
export async function listEmployeeMatches(input: { token: string }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [trainee] = await db
    .select()
    .from(trainees)
    .where(eq(trainees.id, employee.traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(employee.traineeId));

  const postings = await listPostings();
  const applications = await db
    .select({
      id: jobApplications.id,
      postingId: jobApplications.postingId,
      status: jobApplications.status,
    })
    .from(jobApplications)
    .where(eq(jobApplications.traineeId, trainee.id));
  const byPosting = new Map(applications.map((application) => [application.postingId, application]));

  return postings
    .map((posting) => {
      const match = scoreMatch(trainee, {
        district: posting.district,
        courseTags: posting.courseTags ?? [],
        wageBand: posting.wageBand,
        roleCategory: posting.roleCategory,
      });
      return {
        postingId: posting.id,
        title: posting.title,
        employer: posting.employer,
        district: posting.district,
        wageBand: posting.wageBand,
        score: match.score,
        factors: match.factors,
        application: byPosting.get(posting.id) ?? null,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}

/** Employee-side apply: matched -> applied, with the match score preserved. */
export async function applyToPosting(input: { token: string; postingId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [posting] = await db
    .select()
    .from(jobPostings)
    .where(eq(jobPostings.id, input.postingId))
    .limit(1);
  if (!posting) throw new NotFoundError("Job posting", String(input.postingId));
  if (posting.status !== "open") throw new InputValidationError("This posting is no longer open.");

  const [trainee] = await db
    .select()
    .from(trainees)
    .where(eq(trainees.id, employee.traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(employee.traineeId));

  const match = scoreMatch(trainee, {
    district: posting.district,
    courseTags: posting.courseTags ?? [],
    wageBand: posting.wageBand,
    roleCategory: posting.roleCategory,
  });

  const [existing] = await db
    .select({ id: jobApplications.id, status: jobApplications.status })
    .from(jobApplications)
    .where(
      and(eq(jobApplications.traineeId, trainee.id), eq(jobApplications.postingId, posting.id))
    )
    .limit(1);

  if (existing) {
    if (existing.status !== "matched" && existing.status !== "referred") {
      return { applicationId: existing.id, status: existing.status, updated: false as const };
    }
    await db
      .update(jobApplications)
      .set({ status: "applied", updatedAt: new Date() })
      .where(eq(jobApplications.id, existing.id));
    return { applicationId: existing.id, status: "applied" as const, updated: true as const };
  }

  const [created] = await db
    .insert(jobApplications)
    .values({
      traineeId: trainee.id,
      postingId: posting.id,
      status: "applied",
      matchScore: match.score,
      matchFactors: match.factors,
    })
    .returning({ id: jobApplications.id });

  await recordAudit(db, {
    actorType: "employee",
    actorId: trainee.id,
    action: "placement.applied",
    entityType: "jobApplication",
    entityId: created.id,
    purposeCode: "placement_support",
    metadata: { postingId: posting.id, matchScore: match.score },
  });
  return { applicationId: created.id, status: "applied" as const, updated: true as const };
}

export async function listApplications(opts: { district?: string } = {}) {
  const db = await requireDb();
  const conditions = [];
  if (opts.district && opts.district !== "All districts") {
    conditions.push(eq(trainees.district, opts.district));
  }
  return db
    .select({
      id: jobApplications.id,
      status: jobApplications.status,
      matchScore: jobApplications.matchScore,
      referredBy: jobApplications.referredBy,
      createdAt: jobApplications.createdAt,
      traineeRef: trainees.traineeRef,
      traineeName: trainees.displayName,
      district: trainees.district,
      postingId: jobPostings.id,
      postingTitle: jobPostings.title,
      employer: employers.name,
    })
    .from(jobApplications)
    .innerJoin(trainees, eq(jobApplications.traineeId, trainees.id))
    .innerJoin(jobPostings, eq(jobApplications.postingId, jobPostings.id))
    .innerJoin(employers, eq(jobPostings.employerId, employers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(jobApplications.createdAt));
}

/**
 * Confirmed placement: marks the application placed and appends an
 * employer-verified outcome event, so the dashboard and the passport both learn
 * about the hire from one action.
 */
export async function confirmPlacement(input: {
  applicationId: number;
  roleCategory?: string | null;
  wageBand?: string | null;
}) {
  const db = await requireDb();
  const [row] = await db
    .select({
      id: jobApplications.id,
      traineeId: jobApplications.traineeId,
      status: jobApplications.status,
      postingId: jobApplications.postingId,
      title: jobPostings.title,
      roleCategory: jobPostings.roleCategory,
      wageBand: jobPostings.wageBand,
      industry: employers.industry,
    })
    .from(jobApplications)
    .innerJoin(jobPostings, eq(jobApplications.postingId, jobPostings.id))
    .innerJoin(employers, eq(jobPostings.employerId, employers.id))
    .where(eq(jobApplications.id, input.applicationId))
    .limit(1);
  if (!row) throw new NotFoundError("Job application", String(input.applicationId));
  if (row.status === "placed") return { placed: false as const, alreadyPlaced: true as const };

  return db.transaction(async (tx) => {
    await tx
      .update(jobApplications)
      .set({ status: "placed", updatedAt: new Date() })
      .where(eq(jobApplications.id, row.id));

    const event = await createOutcomeEvent(tx, {
      traineeId: row.traineeId,
      outcomeType: "formal_employment",
      roleCategory: input.roleCategory ?? row.roleCategory,
      industry: row.industry,
      wageBand: input.wageBand ?? row.wageBand,
      source: "employer_verification",
      outcomeStatus: "verified",
      evidenceConfidence: "0.900",
    });

    await recordAudit(tx, {
      actorType: "staff",
      action: "placement.confirmed",
      entityType: "jobApplication",
      entityId: row.id,
      purposeCode: "placement_support",
      metadata: { outcomeEventId: event.id, postingId: row.postingId },
    });

    return { placed: true as const, alreadyPlaced: false as const, outcomeEventId: event.id };
  });
}

/** Open-seat count per district, used by the placement board header. */
export async function postingCountsByDistrict() {
  const db = await requireDb();
  return db
    .select({ district: jobPostings.district, open: sql<number>`count(*)::int` })
    .from(jobPostings)
    .where(eq(jobPostings.status, "open"))
    .groupBy(jobPostings.district);
}
