import { and, asc, desc, eq, ilike, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { format } from "date-fns";
import { getDb } from "./db";
import { getMessagingProvider } from "./messaging";
// mappers imports only types back from this module, so there is no runtime cycle.
import { buildRiskFlags } from "./mappers";
import {
  auditEvents,
  consentGrants,
  counsellorCases,
  employeeDocuments,
  employees,
  followUpTasks,
  messageJobs,
  oneTimeTokens,
  outcomeEvents,
  outcomeTypeEnum,
  outcomeStatusEnum,
  trainees,
  trainingRecords,
} from "../drizzle/schema";
import {
  createDocumentUrl,
  deleteDocumentObject,
  uploadDocumentObject,
} from "./_core/supabaseStorage";
import type { TimelineEvent } from "@shared/demoData";

// Capability links (verification, employee portal) are signed with a secret that
// MUST be set in production — a known fallback would let anyone mint valid links.
if (process.env.NODE_ENV === "production" && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET is required in production (signs employer-verification and employee-portal links)");
}
const TOKEN_SIGNING_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "skillio-dev-token-secret-change-me"
);
export const NOTICE_VERSION = "v1.2";

type DbClient = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type TxClient = Parameters<Parameters<DbClient["transaction"]>[0]>[0];
export type DbOrTx = DbClient | TxClient;

export type OutcomeTypeValue = (typeof outcomeTypeEnum.enumValues)[number];
export type OutcomeStatusValue = (typeof outcomeStatusEnum.enumValues)[number];

const EMPLOYED_TYPES: OutcomeTypeValue[] = [
  "formal_employment",
  "self_employment",
  "apprenticeship",
];

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("Database is not configured: DATABASE_URL is not set");
    this.name = "DatabaseNotConfiguredError";
  }
}

export class NotFoundError extends Error {
  constructor(entity: string, identifier: string) {
    super(`${entity} not found: ${identifier}`);
    this.name = "NotFoundError";
  }
}

export class InputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InputValidationError";
  }
}

export async function requireDb(): Promise<DbClient> {
  const db = await getDb();
  if (!db) throw new DatabaseNotConfiguredError();
  return db;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without a database)
// ---------------------------------------------------------------------------

/** "₹10k–₹19k" -> 14.5 (thousands/month); null when no band is reportable. */
export function wageBandMidpoint(band: string | null | undefined): number | null {
  if (!band) return null;
  const numbers = band.match(/\d+/g);
  if (!numbers || numbers.length === 0) return null;
  const values = numbers.map(Number);
  const mid = values.reduce((a, b) => a + b, 0) / values.length;
  return Number.isFinite(mid) ? mid : null;
}

export function outcomeLabelFor(outcomeType: OutcomeTypeValue): string {
  switch (outcomeType) {
    case "formal_employment":
      return "Employed";
    case "self_employment":
      return "Self-employed";
    case "apprenticeship":
      return "Apprentice";
    case "seeking_work":
      return "Looking for work";
    case "not_working":
      return "Seeking work";
  }
}

type JourneyOutcomeEvent = {
  id: number;
  outcomeType: string;
  state: string;
  effectiveStartDate: Date | null;
  effectiveEndDate: Date | null;
  roleCategory: string | null;
  industry: string | null;
  wageBand: string | null;
  source: string;
};

type JourneyTrainingRecord = {
  course: string;
  attendanceRate: string | null;
  certificationStatus: string | null;
  completionDate: Date | null;
};

type JourneyCase = {
  title: string;
  reason: string | null;
  createdAt: Date;
};

const activeToneFor = (outcomeType: string): TimelineEvent["tone"] => {
  switch (outcomeType) {
    case "self_employment":
      return "teal";
    case "formal_employment":
      return "violet";
    case "apprenticeship":
      return "amber";
    default:
      return "rose";
  }
};

const activeTitleFor = (outcomeType: string): string => {
  switch (outcomeType) {
    case "formal_employment":
      return "Started formal employment";
    case "self_employment":
      return "Started self-employment";
    case "apprenticeship":
      return "Started apprenticeship";
    case "seeking_work":
      return "Looking for work";
    default:
      return "Not working";
  }
};

function eventDate(event: JourneyOutcomeEvent): Date {
  return event.effectiveStartDate ?? new Date(0);
}

/**
 * Decides the title for a superseded event: the earliest event of an outcome
 * type reads as the placement ("Started X"); later ones are repeat pulses.
 */
function supersededTitleFor(event: JourneyOutcomeEvent, events: JourneyOutcomeEvent[]): string {
  const earliestSameType = events
    .filter((other) => other.outcomeType === event.outcomeType)
    .reduce<number | null>((earliest, other) => {
      const start = eventDate(other).getTime();
      return earliest === null || start < earliest ? start : earliest;
    }, null);
  if (earliestSameType !== null && eventDate(event).getTime() === earliestSameType) {
    return activeTitleFor(event.outcomeType);
  }
  return "Outcome pulse";
}

/**
 * Builds the append-only journey timeline shown on the trainee page from raw
 * domain rows: training completions, outcome events (incl. superseded pulses),
 * employer verifications, and counsellor support actions — sorted chronologically.
 */
export function buildTimeline(input: {
  trainingRecords: JourneyTrainingRecord[];
  outcomeEvents: JourneyOutcomeEvent[];
  counsellorCases: JourneyCase[];
}): TimelineEvent[] {
  const events: Array<{ date: Date; event: TimelineEvent }> = [];

  for (const record of input.trainingRecords) {
    if (!record.completionDate) continue;
    const attendance = record.attendanceRate ? `${Math.round(Number(record.attendanceRate))}% attendance` : "Attendance unavailable";
    const certification = record.certificationStatus === "certified" ? " · certified" : "";
    events.push({
      date: record.completionDate,
      event: {
        id: `training-${events.length}`,
        date: format(record.completionDate, "d MMM yyyy"),
        title: "Course completed",
        description: `${record.course} · ${attendance}${certification}`,
        kind: "training",
        tone: "slate",
      },
    });
  }

  for (const event of input.outcomeEvents) {
    const date = eventDate(event);
    const description =
      [event.roleCategory, event.industry, event.wageBand ?? "No wage reported"]
        .filter(Boolean)
        .join(" · ") || `Reported via ${event.source.replace(/_/g, " ")}`;

    if (event.source === "employer_verification") {
      events.push({
        date,
        event: {
          id: `outcome-${event.id}`,
          date: date.getTime() === 0 ? format(new Date(), "d MMM yyyy") : format(date, "d MMM yyyy"),
          title: "Employer confirmation received",
          description,
          kind: "verification",
          tone: "teal",
        },
      });
      continue;
    }

    if (event.state === "ended") {
      // One row carries both milestones: the placement and its end.
      events.push({
        date,
        event: {
          id: `outcome-${event.id}`,
          date: format(date, "d MMM yyyy"),
          title: activeTitleFor(event.outcomeType),
          description,
          kind: "outcome",
          tone: activeToneFor(event.outcomeType),
        },
      });
      if (event.effectiveEndDate) {
        events.push({
          date: event.effectiveEndDate,
          event: {
            id: `outcome-${event.id}-end`,
            date: format(event.effectiveEndDate, "d MMM yyyy"),
            title: "Employment ended",
            description: event.roleCategory ?? "Outcome ended",
            kind: "outcome",
            tone: "rose",
          },
        });
      }
      continue;
    }

    const superseded = event.state === "superseded";
    events.push({
      date,
      event: {
        id: `outcome-${event.id}`,
        date: format(date, "d MMM yyyy"),
        title: superseded ? supersededTitleFor(event, input.outcomeEvents) : activeTitleFor(event.outcomeType),
        description,
        kind: "outcome",
        tone: superseded ? "violet" : activeToneFor(event.outcomeType),
      },
    });
  }

  for (const support of input.counsellorCases) {
    events.push({
      date: support.createdAt,
      event: {
        id: `case-${events.length}`,
        date: format(support.createdAt, "d MMM yyyy"),
        title: support.title,
        description: support.reason ?? "Counsellor follow-up",
        kind: "support",
        tone: "amber",
      },
    });
  }

  return events
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((entry) => entry.event);
}

const avg = (values: Array<number | null>): number | null => {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((a, b) => a + b, 0) / present.length;
};

const share = (part: number, whole: number): number => (whole > 0 ? part / whole : 0);

// ---------------------------------------------------------------------------
// Read queries
// ---------------------------------------------------------------------------

export async function listTrainees(opts: { district?: string; query?: string } = {}) {
  const db = await requireDb();

  const conditions = [];
  if (opts.district && opts.district !== "All districts") {
    conditions.push(eq(trainees.district, opts.district));
  }
  if (opts.query) {
    const pattern = `%${opts.query}%`;
    conditions.push(
      or(
        ilike(trainees.displayName, pattern),
        ilike(trainees.course, pattern),
        ilike(trainees.provider, pattern)
      )
    );
  }

  return db
    .select()
    .from(trainees)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(trainees.displayName));
}

export async function getTraineeBySlug(slug: string) {
  const db = await requireDb();
  const [row] = await db.select().from(trainees).where(eq(trainees.slug, slug)).limit(1);
  if (!row) throw new NotFoundError("Trainee", slug);
  return row;
}

export async function getTraineeByRef(traineeRef: string) {
  const db = await requireDb();
  const [row] = await db.select().from(trainees).where(eq(trainees.traineeRef, traineeRef)).limit(1);
  if (!row) throw new NotFoundError("Trainee", traineeRef);
  return row;
}

export async function getTraineeJourney(slug: string) {
  const trainee = await getTraineeBySlug(slug);
  const db = await requireDb();

  const [records, events, consent, tasks, cases] = await Promise.all([
    db.select().from(trainingRecords).where(eq(trainingRecords.traineeId, trainee.id)),
    db
      .select()
      .from(outcomeEvents)
      .where(eq(outcomeEvents.traineeId, trainee.id))
      .orderBy(asc(outcomeEvents.effectiveStartDate), asc(outcomeEvents.createdAt)),
    db.select().from(consentGrants).where(eq(consentGrants.traineeId, trainee.id)),
    db.select().from(followUpTasks).where(eq(followUpTasks.traineeId, trainee.id)),
    db.select().from(counsellorCases).where(eq(counsellorCases.traineeId, trainee.id)),
  ]);

  return {
    trainee,
    trainingRecords: records,
    outcomeEvents: events,
    consentGrants: consent,
    followUpTasks: tasks,
    counsellorCases: cases,
    timeline: buildTimeline({
      trainingRecords: records,
      outcomeEvents: events,
      counsellorCases: cases,
    }),
  };
}

export type DashboardSummary = {
  activeTrainees: number;
  verifiedEmploymentShare: number;
  retention90Share: number;
  wageProgressionShare: number;
  freshnessShare: number;
  responseRate: number;
  outcomeMix: Array<{ outcomeType: string; count: number }>;
  retentionSeries: Array<{ label: string; value: number }>;
  wageSeries: Array<{ label: string; value: number | null }>;
  districts: Array<{
    district: string;
    completions: number;
    verifiedShare: number;
    retentionShare: number;
    wageChange: number | null;
  }>;
};

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const db = await requireDb();

  const [allTrainees, events, tasks, districtRows, mixRows] = await Promise.all([
    db.select().from(trainees),
    db
      .select({
        traineeId: outcomeEvents.traineeId,
        outcomeType: outcomeEvents.outcomeType,
        state: outcomeEvents.state,
        wageBand: outcomeEvents.wageBand,
        effectiveStartDate: outcomeEvents.effectiveStartDate,
      })
      .from(outcomeEvents),
    db.select({ status: followUpTasks.status }).from(followUpTasks),
    db
      .select({
        district: trainees.district,
        completions: sql<number>`count(*)::int`,
        verified: sql<number>`count(*) filter (where ${trainees.outcomeStatus} = 'verified')::int`,
        employed: sql<number>`count(*) filter (where ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
        retained90: sql<number>`count(*) filter (where ${trainees.retentionDays} >= 90 and ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
      })
      .from(trainees)
      .groupBy(trainees.district),
    db
      .select({
        outcomeType: trainees.outcomeType,
        count: sql<number>`count(*)::int`,
      })
      .from(trainees)
      .groupBy(trainees.outcomeType),
  ]);

  const employed = allTrainees.filter((t) =>
    (EMPLOYED_TYPES as string[]).includes(t.outcomeType)
  );
  const employedIds = new Set(employed.map((t) => t.id));

  // Wage progression: current band vs. the first wage-bearing event per trainee.
  const firstWageByTrainee = new Map<number, number>();
  for (const event of [...events].sort(
    (a, b) => (a.effectiveStartDate?.getTime() ?? 0) - (b.effectiveStartDate?.getTime() ?? 0)
  )) {
    if (!employedIds.has(event.traineeId)) continue;
    const mid = wageBandMidpoint(event.wageBand);
    if (mid !== null && !firstWageByTrainee.has(event.traineeId)) {
      firstWageByTrainee.set(event.traineeId, mid);
    }
  }
  const firstWage = avg(
    employed.map((t) => firstWageByTrainee.get(t.id) ?? null)
  );
  const currentWage = avg(employed.map((t) => wageBandMidpoint(t.wageBand)));

  const now = Date.now();
  const freshCutoff = 90 * 24 * 60 * 60 * 1000;

  const contacted = tasks.filter(
    (t) => t.status !== "scheduled" && t.status !== "queued"
  ).length;
  const responded = tasks.filter(
    (t) => t.status === "completed" || t.status === "declined"
  ).length;

  const districtWageChange = new Map<string, { first: number[]; current: number[] }>();
  for (const trainee of employed) {
    const district = trainee.district;
    const entry = districtWageChange.get(district) ?? { first: [], current: [] };
    const first = firstWageByTrainee.get(trainee.id);
    const current = wageBandMidpoint(trainee.wageBand);
    if (first !== null && first !== undefined) entry.first.push(first);
    if (current !== null) entry.current.push(current);
    districtWageChange.set(district, entry);
  }

  return {
    activeTrainees: allTrainees.length,
    verifiedEmploymentShare: share(
      employed.filter((t) => t.outcomeStatus === "verified").length,
      employed.length
    ),
    retention90Share: share(
      employed.filter((t) => t.retentionDays >= 90).length,
      employed.length
    ),
    wageProgressionShare:
      firstWage && firstWage > 0 && currentWage !== null
        ? currentWage / firstWage - 1
        : 0,
    freshnessShare: share(
      allTrainees.filter(
        (t) => now - t.lastUpdated.getTime() < freshCutoff
      ).length,
      allTrainees.length
    ),
    responseRate: share(responded, contacted),
    outcomeMix: mixRows,
    retentionSeries: [30, 90, 180, 365].map((days) => ({
      label: `${days} days`,
      value: share(employed.filter((t) => t.retentionDays >= days).length, employed.length),
    })),
    wageSeries: [
      { label: "At completion", value: firstWage },
      { label: "90 days", value: avg(employed.filter((t) => t.retentionDays >= 90).map((t) => wageBandMidpoint(t.wageBand))) },
      { label: "180 days", value: avg(employed.filter((t) => t.retentionDays >= 180).map((t) => wageBandMidpoint(t.wageBand))) },
      { label: "Current", value: currentWage },
    ],
    districts: districtRows
      .map((row) => {
        const wageEntry = districtWageChange.get(row.district);
        const firstAvg = wageEntry ? avg(wageEntry.first) : null;
        const currentAvg = wageEntry ? avg(wageEntry.current) : null;
        return {
          district: row.district,
          completions: row.completions,
          verifiedShare: share(row.verified, row.completions),
          retentionShare: share(row.retained90, row.employed),
          wageChange:
            firstAvg !== null && firstAvg > 0 && currentAvg !== null
              ? currentAvg / firstAvg - 1
              : null,
        };
      })
      .sort((a, b) => b.completions - a.completions),
  };
}

export async function listFollowUpQueue() {
  const db = await requireDb();

  const rows = await db
    .select({
      id: counsellorCases.id,
      traineeSlug: trainees.slug,
      traineeName: trainees.displayName,
      district: trainees.district,
      priority: counsellorCases.priority,
      title: counsellorCases.title,
      reason: counsellorCases.reason,
      nextAction: counsellorCases.nextAction,
      channel: counsellorCases.channel,
      status: counsellorCases.status,
      assignedTo: counsellorCases.assignedTo,
      dueAt: counsellorCases.dueAt,
      createdAt: counsellorCases.createdAt,
    })
    .from(counsellorCases)
    .innerJoin(trainees, eq(counsellorCases.traineeId, trainees.id));

  const priorityOrder = { P1: 0, P2: 1, P3: 2, P4: 3 } as const;
  return rows.sort(
    (a, b) =>
      priorityOrder[a.priority] - priorityOrder[b.priority] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity)
  );
}

export async function listSkillGaps() {
  const db = await requireDb();

  return db
    .select({
      barrier: trainees.barrier,
      districts: sql<string[]>`array_agg(distinct ${trainees.district})`,
      affected: sql<number>`count(*)::int`,
      seeking: sql<number>`count(*) filter (where ${trainees.outcomeType} in ('seeking_work','not_working'))::int`,
      total: sql<number>`(count(*) over ())::int`,
    })
    .from(trainees)
    .where(sql`${trainees.barrier} is not null`)
    .groupBy(trainees.barrier)
    .orderBy(sql`count(*) desc`);
}

export async function getCounsellorCaseById(caseId: number) {
  const db = await requireDb();
  const [record] = await db
    .select()
    .from(counsellorCases)
    .where(eq(counsellorCases.id, caseId))
    .limit(1);
  if (!record) throw new NotFoundError("Counsellor case", String(caseId));
  return record;
}

export async function getConsentStatus(slug: string) {
  const trainee = await getTraineeBySlug(slug);
  const db = await requireDb();
  const grants = await db
    .select()
    .from(consentGrants)
    .where(eq(consentGrants.traineeId, trainee.id))
    .orderBy(asc(consentGrants.purposeCode));
  return { trainee, grants };
}

export async function getCohortPerformance() {
  const db = await requireDb();

  // Presence of any follow-up task marks a trainee as "covered" by outreach.
  const taskPresence = db
    .select({ traineeId: followUpTasks.traineeId })
    .from(followUpTasks)
    .groupBy(followUpTasks.traineeId)
    .as("taskPresence");

  return db
    .select({
      cohort: trainees.cohort,
      provider: trainees.provider,
      course: trainees.course,
      district: trainees.district,
      completed: sql<number>`count(*)::int`,
      verified: sql<number>`count(*) filter (where ${trainees.outcomeStatus} = 'verified')::int`,
      employed: sql<number>`count(*) filter (where ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
      retained90: sql<number>`count(*) filter (where ${trainees.retentionDays} >= 90 and ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
      relevance: sql<number | null>`avg(${trainees.relevance})`,
      barrier: sql<
        string | null
      >`mode() within group (order by ${trainees.barrier})`,
      covered: sql<number>`count(${taskPresence.traineeId})::int`,
    })
    .from(trainees)
    .leftJoin(taskPresence, eq(taskPresence.traineeId, trainees.id))
    .groupBy(trainees.cohort, trainees.provider, trainees.course, trainees.district);
}

export async function listRecentMessageJobs(limit = 8) {
  const db = await requireDb();
  return db
    .select({
      id: messageJobs.id,
      channel: messageJobs.channel,
      templateCode: messageJobs.templateCode,
      status: messageJobs.status,
      providerMessageId: messageJobs.providerMessageId,
      scheduledAt: messageJobs.scheduledAt,
      traineeRef: trainees.traineeRef,
    })
    .from(messageJobs)
    .innerJoin(trainees, eq(messageJobs.traineeId, trainees.id))
    .orderBy(desc(messageJobs.createdAt), desc(messageJobs.id))
    .limit(limit);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function recordAudit(
  handle: DbOrTx,
  entry: {
    actorType: string;
    actorId?: number | null;
    action: string;
    entityType: string;
    entityId?: number | null;
    purposeCode?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  await handle.insert(auditEvents).values({
    actorType: entry.actorType,
    actorId: entry.actorId ?? null,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId ?? null,
    purposeCode: entry.purposeCode ?? null,
    metadata: entry.metadata ?? null,
  });
}

export type CreateOutcomeEventInput = {
  traineeId: number;
  outcomeType: OutcomeTypeValue;
  effectiveStartDate?: Date | null;
  roleCategory?: string | null;
  industry?: string | null;
  wageBand?: string | null;
  relevanceRating?: number | null;
  source: string;
  evidenceConfidence?: string;
  outcomeStatus?: OutcomeStatusValue;
};

/**
 * Append-only outcome write: supersedes the trainee's current active event
 * (closing its effective end date) and refreshes the denormalised trainee row.
 */
export async function createOutcomeEvent(handle: DbOrTx, input: CreateOutcomeEventInput) {
  const [active] = await handle
    .select()
    .from(outcomeEvents)
    .where(
      and(eq(outcomeEvents.traineeId, input.traineeId), eq(outcomeEvents.state, "active"))
    )
    .limit(1);

  const effectiveStart = input.effectiveStartDate ?? new Date();

  const [event] = await handle
    .insert(outcomeEvents)
    .values({
      traineeId: input.traineeId,
      outcomeType: input.outcomeType,
      state: "active",
      effectiveStartDate: effectiveStart,
      roleCategory: input.roleCategory ?? null,
      industry: input.industry ?? null,
      wageBand: input.wageBand ?? null,
      relevanceRating: input.relevanceRating ?? null,
      source: input.source,
      evidenceConfidence: input.evidenceConfidence ?? "0.750",
      supersedesEventId: active?.id ?? null,
    })
    .returning();

  if (active) {
    await handle
      .update(outcomeEvents)
      .set({ state: "superseded", effectiveEndDate: effectiveStart })
      .where(eq(outcomeEvents.id, active.id));
  }

  await handle
    .update(trainees)
    .set({
      outcomeType: input.outcomeType,
      outcomeLabel: outcomeLabelFor(input.outcomeType),
      outcomeStatus: input.outcomeStatus ?? "self_reported",
      wageBand: input.wageBand ?? null,
      relevance: input.relevanceRating ?? null,
      lastUpdated: new Date(),
    })
    .where(eq(trainees.id, input.traineeId));

  // A verified employment outcome opens the employee portal (Theme A1).
  if (input.source === "employer_verification" && (EMPLOYED_TYPES as string[]).includes(input.outcomeType)) {
    await ensureEmployee(handle, input.traineeId);
  }

  return event;
}

/** Idempotently links a trainee to the employee portal. */
export async function ensureEmployee(handle: DbOrTx, traineeId: number) {
  await handle.insert(employees).values({ traineeId }).onConflictDoNothing({
    target: employees.traineeId,
  });
}

export async function scheduleFollowUp(input: {
  traineeId: number;
  purposeCode?: string;
  checkpointCode: string;
  dueAt: Date;
  preferredChannel?: "whatsapp" | "sms" | "call";
  assignedCounsellor?: string | null;
}) {
  const db = await requireDb();
  const [task] = await db
    .insert(followUpTasks)
    .values({
      traineeId: input.traineeId,
      purposeCode: input.purposeCode ?? "outcome_follow_up",
      checkpointCode: input.checkpointCode,
      dueAt: input.dueAt,
      preferredChannel: input.preferredChannel ?? "whatsapp",
      assignedCounsellor: input.assignedCounsellor ?? null,
    })
    .returning();
  return task;
}

export async function recordMessageJob(input: {
  followUpTaskId: number;
  traineeId: number;
  channel: "whatsapp" | "sms";
  templateCode: string;
  idempotencyKey: string;
  providerMessageId?: string | null;
}) {
  const db = await requireDb();
  const inserted = await db
    .insert(messageJobs)
    .values({
      followUpTaskId: input.followUpTaskId,
      traineeId: input.traineeId,
      channel: input.channel,
      templateCode: input.templateCode,
      idempotencyKey: input.idempotencyKey,
      providerMessageId: input.providerMessageId ?? null,
      status: input.providerMessageId ? "accepted" : "queued",
      attemptCount: 1,
      scheduledAt: new Date(),
    })
    .onConflictDoNothing({ target: messageJobs.idempotencyKey })
    .returning();

  if (inserted.length > 0) return { job: inserted[0], duplicate: false };

  const [existing] = await db
    .select()
    .from(messageJobs)
    .where(eq(messageJobs.idempotencyKey, input.idempotencyKey))
    .limit(1);
  return { job: existing, duplicate: true };
}

export async function submitTraineeResponse(input: {
  slug: string;
  outcomeType: OutcomeTypeValue;
  wageBand?: string | null;
  relevance?: number | null;
  consentToContact: boolean;
}) {
  const db = await requireDb();
  const trainee = await getTraineeBySlug(input.slug);

  return db.transaction(async (tx) => {
    const event = await createOutcomeEvent(tx, {
      traineeId: trainee.id,
      outcomeType: input.outcomeType,
      wageBand: input.wageBand ?? null,
      relevanceRating: input.relevance ?? null,
      source: "trainee_mobile",
      outcomeStatus: "self_reported",
    });

    const closedTasks = await tx
      .update(followUpTasks)
      .set({ status: "completed" })
      .where(
        and(
          eq(followUpTasks.traineeId, trainee.id),
          inArray(followUpTasks.status, ["sent", "queued"])
        )
      )
      .returning({ id: followUpTasks.id });

    let cancelledTasks = 0;
    if (!input.consentToContact) {
      await tx
        .update(consentGrants)
        .set({ status: "withdrawn", withdrawnAt: new Date() })
        .where(
          and(
            eq(consentGrants.traineeId, trainee.id),
            eq(consentGrants.purposeCode, "outcome_follow_up"),
            eq(consentGrants.status, "granted")
          )
        );
      await tx
        .update(trainees)
        .set({ consentStatus: "withdrawn" })
        .where(eq(trainees.id, trainee.id));
      const cancelled = await tx
        .update(followUpTasks)
        .set({ status: "cancelled" })
        .where(
          and(
            eq(followUpTasks.traineeId, trainee.id),
            inArray(followUpTasks.status, ["scheduled", "queued"])
          )
        )
        .returning({ id: followUpTasks.id });
      cancelledTasks = cancelled.length;
    }

    await recordAudit(tx, {
      actorType: "trainee",
      actorId: trainee.id,
      action: "outcome.response_submitted",
      entityType: "outcomeEvent",
      entityId: event.id,
      purposeCode: "outcome_follow_up",
      metadata: {
        outcomeType: input.outcomeType,
        wageBand: input.wageBand ?? null,
        relevance: input.relevance ?? null,
        consentToContact: input.consentToContact,
      },
    });

    return {
      outcomeEventId: event.id,
      closedTaskCount: closedTasks.length,
      cancelledTaskCount: cancelledTasks,
      nextFollowUpScheduled: input.consentToContact,
    };
  });
}

export async function withdrawConsent(input: { slug: string; purposeCode: string }) {
  const db = await requireDb();
  const trainee = await getTraineeBySlug(input.slug);

  return db.transaction(async (tx) => {
    const withdrawn = await tx
      .update(consentGrants)
      .set({ status: "withdrawn", withdrawnAt: new Date() })
      .where(
        and(
          eq(consentGrants.traineeId, trainee.id),
          eq(consentGrants.purposeCode, input.purposeCode),
          eq(consentGrants.status, "granted")
        )
      )
      .returning({ id: consentGrants.id });

    await tx
      .update(trainees)
      .set({ consentStatus: "withdrawn", lastUpdated: new Date() })
      .where(eq(trainees.id, trainee.id));

    const cancelled = await tx
      .update(followUpTasks)
      .set({ status: "cancelled" })
      .where(
        and(
          eq(followUpTasks.traineeId, trainee.id),
          eq(followUpTasks.purposeCode, input.purposeCode),
          inArray(followUpTasks.status, ["scheduled", "queued"])
        )
      )
      .returning({ id: followUpTasks.id });

    // A withdrawal gets its own verifiable receipt, separate from the grant receipt.
    const withdrawalReceipt = createHash("sha256")
      .update(`${trainee.traineeRef}:${input.purposeCode}:withdraw:${new Date().toISOString()}`)
      .digest("hex")
      .slice(0, 64);

    const [audit] = await tx
      .insert(auditEvents)
      .values({
        actorType: "staff",
        actorId: null,
        action: "consent.withdrawn",
        entityType: "trainee",
        entityId: trainee.id,
        purposeCode: input.purposeCode,
        metadata: { traineeSlug: trainee.slug, noticeVersion: NOTICE_VERSION, receiptHash: withdrawalReceipt },
      })
      .returning({ id: auditEvents.id });

    return {
      traineeId: trainee.id,
      purposeCode: input.purposeCode,
      withdrawnGrantCount: withdrawn.length,
      cancelledTaskCount: cancelled.length,
      auditEventId: audit.id,
    };
  });
}

/**
 * Counsellor-initiated outreach from the follow-up queue: reuses the trainee's
 * most recent open task or schedules one, records an idempotent message job
 * (one per case per day until the provider layer lands), and marks the task
 * sent. Calls have no message job — they are only logged.
 */
export async function sendManualOutreach(input: {
  caseId: number;
  channel: "whatsapp" | "sms" | "call";
}) {
  const db = await requireDb();
  const record = await getCounsellorCaseById(input.caseId);

  if (input.channel === "call") {
    await recordAudit(db, {
      actorType: "staff",
      action: "message.call_logged",
      entityType: "counsellorCase",
      entityId: record.id,
      purposeCode: "outcome_follow_up",
      metadata: { assignedTo: record.assignedTo },
    });
    return { taskId: null, providerMessageId: null, duplicate: false };
  }

  const [openTask] = await db
    .select()
    .from(followUpTasks)
    .where(
      and(
        eq(followUpTasks.traineeId, record.traineeId),
        inArray(followUpTasks.status, ["scheduled", "queued", "sent"])
      )
    )
    .orderBy(desc(followUpTasks.dueAt))
    .limit(1);

  const task =
    openTask ??
    (await scheduleFollowUp({
      traineeId: record.traineeId,
      purposeCode: "counsellor_outreach",
      checkpointCode: "manual_outreach",
      dueAt: new Date(),
      preferredChannel: input.channel,
      assignedCounsellor: record.assignedTo,
    }));

  const idempotencyKey = `manual:${record.id}:${new Date().toISOString().slice(0, 10)}`;
  const { job, duplicate } = await recordMessageJob({
    followUpTaskId: task.id,
    traineeId: record.traineeId,
    channel: input.channel,
    templateCode: "manual_outreach_v1",
    idempotencyKey,
  });

  if (duplicate) {
    return {
      taskId: task.id,
      providerMessageId: job?.providerMessageId ?? null,
      duplicate,
    };
  }

  await db.update(followUpTasks).set({ status: "sent" }).where(eq(followUpTasks.id, task.id));

  // Hand the actual delivery to the provider-neutral boundary.
  const [trainee] = await db
    .select({ contactPhone: trainees.contactPhone })
    .from(trainees)
    .where(eq(trainees.id, record.traineeId))
    .limit(1);

  let providerMessageId: string | null = null;
  let failed: string | null = null;
  if (!trainee?.contactPhone) {
    failed = "no_contact_address";
  } else {
    try {
      const result = await getMessagingProvider().send({
        channel: input.channel,
        to: trainee.contactPhone,
        templateCode: "manual_outreach_v1",
        idempotencyKey,
      });
      providerMessageId = result.providerMessageId;
      if (job) {
        await db
          .update(messageJobs)
          .set({ status: "accepted", providerMessageId: result.providerMessageId })
          .where(eq(messageJobs.id, job.id));
      }
    } catch (error) {
      failed =
        error && typeof error === "object" && "errorCode" in error
          ? String(error.errorCode)
          : "provider_error";
      if (job) {
        await db
          .update(messageJobs)
          .set({ status: "failed", lastErrorCode: failed })
          .where(eq(messageJobs.id, job.id));
      }
    }
  }

  await recordAudit(db, {
    actorType: "staff",
    action: failed ? "message.failed" : "message.sent",
    entityType: "messageJob",
    entityId: job?.id ?? null,
    purposeCode: "outcome_follow_up",
    metadata: { channel: input.channel, caseId: record.id, duplicate, failed },
  });

  return {
    taskId: task.id,
    providerMessageId,
    duplicate,
    failed,
  };
}

/**
 * Employer verification flow: consumes a one-time link token, then confirms
 * (or declines) a trainee's reported work outcome. A confirmation appends a
 * verified outcome event; a decline downgrades the trainee to pending evidence
 * without touching the event history.
 */
export async function submitEmployerVerification(input: {
  token: string;
  stillEmployed: boolean;
  roleCategory?: string | null;
  wageBand?: string | null;
}) {
  const db = await requireDb();
  const tokenRow = await consumeOneTimeToken(input.token, "employer_verification");
  if (!tokenRow.traineeId) throw new NotFoundError("Verification token trainee", "none");
  const [trainee] = await db.select().from(trainees).where(eq(trainees.id, tokenRow.traineeId)).limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(tokenRow.traineeId));

  if (!input.stillEmployed) {
    await db
      .update(trainees)
      .set({ outcomeStatus: "pending", lastUpdated: new Date() })
      .where(eq(trainees.id, trainee.id));
    await recordAudit(db, {
      actorType: "employer",
      action: "verification.employer_declined",
      entityType: "trainee",
      entityId: trainee.id,
      purposeCode: "employer_verification",
      metadata: { traineeRef: trainee.traineeRef },
    });
    return { verified: false, traineeRef: trainee.traineeRef, outcomeEventId: null };
  }

  const event = await createOutcomeEvent(db, {
    traineeId: trainee.id,
    outcomeType: trainee.outcomeType,
    roleCategory: input.roleCategory ?? null,
    wageBand: input.wageBand ?? trainee.wageBand,
    relevanceRating: trainee.relevance,
    source: "employer_verification",
    outcomeStatus: "verified",
  });
  await recordAudit(db, {
    actorType: "employer",
    action: "verification.employer_confirmed",
    entityType: "trainee",
    entityId: trainee.id,
    purposeCode: "employer_verification",
    metadata: { traineeRef: trainee.traineeRef, outcomeEventId: event.id },
  });
  return { verified: true, traineeRef: trainee.traineeRef, outcomeEventId: event.id };
}

// ---------------------------------------------------------------------------
// One-time link tokens (employer verification, future mobile pulses)
// ---------------------------------------------------------------------------

/** Issues a single-use signed link; consumption is persisted in oneTimeTokens. */
export async function createVerificationLink(input: { traineeRef: string; ttlDays?: number }) {
  const db = await requireDb();
  const [trainee] = await db
    .select({ id: trainees.id, traineeRef: trainees.traineeRef })
    .from(trainees)
    .where(eq(trainees.traineeRef, input.traineeRef))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", input.traineeRef);

  const ttlDays = input.ttlDays ?? 7;
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const token = await new SignJWT({ purpose: "employer_verification" })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(TOKEN_SIGNING_SECRET);

  await db.insert(oneTimeTokens).values({
    jti,
    purpose: "employer_verification",
    traineeId: trainee.id,
    expiresAt,
  });
  await recordAudit(db, {
    actorType: "staff",
    action: "verification.link_created",
    entityType: "trainee",
    entityId: trainee.id,
    purposeCode: "employer_verification",
    metadata: { traineeRef: trainee.traineeRef, expiresAt: expiresAt.toISOString() },
  });

  return {
    url: `/verify/employer?ref=${encodeURIComponent(trainee.traineeRef)}&token=${token}`,
    expiresAt,
  };
}

/** Verifies a signed one-time token and marks it consumed — atomically. */
async function consumeOneTimeToken(token: string, purpose: string) {
  const db = await requireDb();
  let jti: string;
  try {
    const { payload } = await jwtVerify(token, TOKEN_SIGNING_SECRET);
    if (!payload.jti) throw new Error("missing jti");
    jti = payload.jti;
  } catch {
    throw new NotFoundError("Verification token", "invalid");
  }

  const [row] = await db
    .update(oneTimeTokens)
    .set({ usedAt: new Date() })
    .where(and(eq(oneTimeTokens.jti, jti), eq(oneTimeTokens.purpose, purpose), isNull(oneTimeTokens.usedAt)))
    .returning();

  if (!row) throw new NotFoundError("Verification token", "already used or unknown");
  if (row.expiresAt.getTime() < Date.now()) throw new NotFoundError("Verification token", "expired");
  return row;
}

// ---------------------------------------------------------------------------
// Webhook event handlers (provider-neutral)
// ---------------------------------------------------------------------------

/** Delivery status webhook: updates the message job the event belongs to. */
export async function recordDeliveryStatus(input: {
  providerMessageId: string;
  status: "delivered" | "read" | "failed" | "undelivered";
  errorCode?: string | null;
}) {
  const db = await requireDb();
  const [job] = await db
    .update(messageJobs)
    .set({
      status: input.status,
      lastErrorCode: input.errorCode ?? null,
    })
    .where(eq(messageJobs.providerMessageId, input.providerMessageId))
    .returning({ id: messageJobs.id, traineeId: messageJobs.traineeId, followUpTaskId: messageJobs.followUpTaskId });

  if (!job) return { matched: false as const };

  await recordAudit(db, {
    actorType: "provider",
    action: `message.${input.status}`,
    entityType: "messageJob",
    entityId: job.id,
    purposeCode: "outcome_follow_up",
    metadata: { errorCode: input.errorCode ?? null },
  });
  return { matched: true as const, jobId: job.id };
}

/**
 * Inbound message webhook: maps the sender to a trainee by contact address,
 * closes their outstanding follow-up, and opens a counsellor case for review.
 * Message content is never persisted — only the fact of the reply.
 */
export async function handleInboundMessage(input: { contactPhone: string }) {
  const db = await requireDb();
  // Meta sends `from` without the leading "+" (e.g. 917370969624) while the
  // register stores E.164 with "+". Match on digits only so real replies
  // resolve regardless of formatting.
  const digits = input.contactPhone.replace(/\D/g, "");
  const [trainee] = digits
    ? await db
        .select({ id: trainees.id, slug: trainees.slug, traineeRef: trainees.traineeRef })
        .from(trainees)
        .where(sql`regexp_replace("contactPhone", '[^0-9]', '', 'g') = ${digits}`)
        .limit(1)
    : [];

  if (!trainee) {
    await recordAudit(db, {
      actorType: "provider",
      action: "message.inbound_unknown_sender",
      entityType: "messageJob",
      purposeCode: "outcome_follow_up",
      metadata: { contactHash: createHash("sha256").update(digits).digest("hex").slice(0, 16) },
    });
    return { matched: false as const };
  }

  const [openTask] = await db
    .select({ id: followUpTasks.id, preferredChannel: followUpTasks.preferredChannel })
    .from(followUpTasks)
    .where(and(eq(followUpTasks.traineeId, trainee.id), eq(followUpTasks.status, "sent")))
    .orderBy(desc(followUpTasks.dueAt))
    .limit(1);

  if (openTask) {
    await db.update(followUpTasks).set({ status: "completed" }).where(eq(followUpTasks.id, openTask.id));
  }

  await db.insert(counsellorCases).values({
    traineeId: trainee.id,
    priority: "P3",
    title: "Trainee replied via messaging",
    reason: "Trainee responded to a follow-up message; review their outcome pulse or next step.",
    nextAction: "Review the reply and confirm the outcome",
    channel: openTask?.preferredChannel ?? "whatsapp",
    status: "open",
  });

  await recordAudit(db, {
    actorType: "provider",
    action: "message.inbound_received",
    entityType: "trainee",
    entityId: trainee.id,
    purposeCode: "outcome_follow_up",
    metadata: { traineeRef: trainee.traineeRef, closedTaskId: openTask?.id ?? null },
  });
  return { matched: true as const, traineeId: trainee.id, closedTaskId: openTask?.id ?? null };
}

// ---------------------------------------------------------------------------
// Employee portal (Theme A1)
// ---------------------------------------------------------------------------

const EMPLOYEE_TOKEN_TTL_DAYS = 30;

/** Issues a passwordless portal link for an existing employee record. */
export async function createEmployeeLink(input: { traineeRef: string; ttlDays?: number }) {
  const db = await requireDb();
  const [row] = await db
    .select({ traineeRef: trainees.traineeRef })
    .from(employees)
    .innerJoin(trainees, eq(employees.traineeId, trainees.id))
    .where(eq(trainees.traineeRef, input.traineeRef))
    .limit(1);
  if (!row) {
    throw new NotFoundError("Employee record", input.traineeRef);
  }

  const ttlDays = input.ttlDays ?? EMPLOYEE_TOKEN_TTL_DAYS;
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  const token = await new SignJWT({ purpose: "employee_portal", traineeRef: row.traineeRef })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(TOKEN_SIGNING_SECRET);

  return {
    url: `/me?token=${token}`,
    expiresAt,
  };
}

/** Verifies an employee portal token and returns the trainee ref it belongs to. */
export async function resolveEmployeeToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, TOKEN_SIGNING_SECRET);
    if (payload.purpose !== "employee_portal" || typeof payload.traineeRef !== "string") {
      throw new Error("wrong purpose or claims");
    }
    return payload.traineeRef;
  } catch {
    throw new NotFoundError("Employee portal session", "invalid");
  }
}

export async function getEmployeePortal(input: { token: string }) {
  const db = await requireDb();
  const traineeRef = await resolveEmployeeToken(input.token);

  const [employee] = await db
    .select({ id: employees.id, linkedAt: employees.linkedAt })
    .from(employees)
    .innerJoin(trainees, eq(employees.traineeId, trainees.id))
    .where(eq(trainees.traineeRef, traineeRef))
    .limit(1);
  if (!employee) throw new NotFoundError("Employee record", traineeRef);

  const [trainee] = await db
    .select()
    .from(trainees)
    .where(eq(trainees.traineeRef, traineeRef))
    .limit(1);

  const [records, events] = await Promise.all([
    db.select().from(trainingRecords).where(eq(trainingRecords.traineeId, trainee.id)),
    db
      .select()
      .from(outcomeEvents)
      .where(eq(outcomeEvents.traineeId, trainee.id))
      .orderBy(asc(outcomeEvents.effectiveStartDate), asc(outcomeEvents.createdAt)),
  ]);

  // Wage history: every reportable band over time, for the progression chart.
  const wageHistory = events
    .filter((event) => event.wageBand && event.state !== "ended" && event.state !== "disputed")
    .map((event) => ({
      date: event.effectiveStartDate ?? event.createdAt,
      band: event.wageBand as string,
      value: wageBandMidpoint(event.wageBand),
      state: event.state,
    }));

  // The employee sees their own story — internal casework is never exposed.
  const timeline = buildTimeline({
    trainingRecords: records,
    outcomeEvents: events,
    counsellorCases: [],
  });

  const active = events.find((event) => event.state === "active");

  return {
    profile: {
      traineeRef: trainee.traineeRef,
      name: trainee.displayName,
      initials: trainee.initials,
      district: trainee.district,
      preferredLanguage: trainee.preferredLanguage,
      statusLabel: trainee.outcomeLabel,
      roleCategory: active?.roleCategory ?? null,
      industry: active?.industry ?? null,
      wageBand: trainee.wageBand,
      skills: records.map((record) => record.course),
      retentionDays: trainee.retentionDays,
      linkedAt: employee.linkedAt,
    },
    // Completed courses the employee can share as verified certificates.
    certificates: records
      .filter((record) => record.completionDate)
      .map((record) => ({
        id: record.id,
        course: record.course,
        provider: record.provider,
        completionDate: record.completionDate!.toISOString(),
        certificationStatus: record.certificationStatus,
      })),
    wageHistory,
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Employee document vault (Theme A2)
// ---------------------------------------------------------------------------

const DOCUMENT_MIME_ALLOWLIST = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const NON_CERTIFICATE_RETENTION_MONTHS = 24;

export async function resolveEmployeeFromToken(token: string) {
  const traineeRef = await resolveEmployeeToken(token);
  const db = await requireDb();
  const [row] = await db
    .select({
      employeeId: employees.id,
      traineeId: trainees.id,
      traineeRef: trainees.traineeRef,
      preferredLanguage: trainees.preferredLanguage,
    })
    .from(employees)
    .innerJoin(trainees, eq(employees.traineeId, trainees.id))
    .where(eq(trainees.traineeRef, traineeRef))
    .limit(1);
  if (!row) throw new NotFoundError("Employee record", traineeRef);
  return row;
}

/** First document upload captures purpose-specific consent with a receipt. */
async function ensureDocumentConsent(handle: DbOrTx, trainee: { traineeId: number; traineeRef: string; preferredLanguage: string }) {
  const [existing] = await handle
    .select({ id: consentGrants.id })
    .from(consentGrants)
    .where(
      and(
        eq(consentGrants.traineeId, trainee.traineeId),
        eq(consentGrants.purposeCode, "document_storage"),
        eq(consentGrants.status, "granted")
      )
    )
    .limit(1);
  if (existing) return;

  const grantedAt = new Date();
  await handle.insert(consentGrants).values({
    traineeId: trainee.traineeId,
    purposeCode: "document_storage",
    status: "granted",
    noticeVersion: NOTICE_VERSION,
    languageCode: trainee.preferredLanguage,
    channel: "portal",
    grantedAt,
    receiptHash: createHash("sha256")
      .update(`${trainee.traineeRef}:document_storage:grant:${grantedAt.toISOString()}`)
      .digest("hex")
      .slice(0, 64),
  });
  await recordAudit(handle, {
    actorType: "employee",
    actorId: trainee.traineeId,
    action: "consent.granted",
    entityType: "trainee",
    entityId: trainee.traineeId,
    purposeCode: "document_storage",
    metadata: { noticeVersion: NOTICE_VERSION, channel: "portal" },
  });
}

export async function uploadEmployeeDocument(input: {
  token: string;
  kind: "certificate" | "payslip" | "id_document" | "other";
  title: string;
  fileName: string;
  mimeType: string;
  dataBase64: string;
}) {
  if (!DOCUMENT_MIME_ALLOWLIST.has(input.mimeType)) {
    throw new InputValidationError("Unsupported file type. Allowed: PDF, JPEG, PNG, WebP.");
  }
  const data = Buffer.from(input.dataBase64, "base64");
  if (data.length === 0) throw new InputValidationError("The file is empty.");
  if (data.length > MAX_DOCUMENT_BYTES) throw new InputValidationError("Files are limited to 5 MB.");

  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);

  return db.transaction(async (tx) => {
    await ensureDocumentConsent(tx, employee);

    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const storagePath = `${employee.traineeRef}/${randomUUID()}-${safeName}`;
    await uploadDocumentObject(storagePath, data, input.mimeType);

    const retentionUntil =
      input.kind === "certificate"
        ? null
        : new Date(Date.now() + NON_CERTIFICATE_RETENTION_MONTHS * 31 * 86_400_000);

    const [document] = await tx
      .insert(employeeDocuments)
      .values({
        employeeId: employee.employeeId,
        kind: input.kind,
        title: input.title.slice(0, 160),
        storagePath,
        mimeType: input.mimeType,
        sizeBytes: data.length,
        retentionUntil,
      })
      .returning();

    await recordAudit(tx, {
      actorType: "employee",
      actorId: employee.traineeId,
      action: "document.uploaded",
      entityType: "employeeDocument",
      entityId: document.id,
      purposeCode: "document_storage",
      metadata: { kind: input.kind, sizeBytes: data.length, retentionUntil: retentionUntil?.toISOString() ?? null },
    });

    return {
      id: document.id,
      kind: document.kind,
      title: document.title,
      sizeBytes: document.sizeBytes,
      retentionUntil: document.retentionUntil ? document.retentionUntil.toISOString() : null,
      createdAt: document.createdAt.toISOString(),
    };
  });
}

export async function listEmployeeDocuments(input: { token: string }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const rows = await db
    .select()
    .from(employeeDocuments)
    .where(eq(employeeDocuments.employeeId, employee.employeeId))
    .orderBy(desc(employeeDocuments.createdAt));
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    retentionUntil: row.retentionUntil ? row.retentionUntil.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function employeeDocumentUrl(input: { token: string; documentId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [row] = await db
    .select({ storagePath: employeeDocuments.storagePath })
    .from(employeeDocuments)
    .where(and(eq(employeeDocuments.id, input.documentId), eq(employeeDocuments.employeeId, employee.employeeId)))
    .limit(1);
  if (!row) throw new NotFoundError("Document", String(input.documentId));
  return { url: await createDocumentUrl(row.storagePath) };
}

export async function deleteEmployeeDocument(input: { token: string; documentId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [row] = await db
    .delete(employeeDocuments)
    .where(and(eq(employeeDocuments.id, input.documentId), eq(employeeDocuments.employeeId, employee.employeeId)))
    .returning({ storagePath: employeeDocuments.storagePath, title: employeeDocuments.title });
  if (!row) throw new NotFoundError("Document", String(input.documentId));

  await deleteDocumentObject(row.storagePath);
  await recordAudit(db, {
    actorType: "employee",
    actorId: employee.traineeId,
    action: "document.deleted",
    entityType: "employeeDocument",
    entityId: input.documentId,
    purposeCode: "document_storage",
    metadata: { title: row.title },
  });
  return { deleted: true as const };
}

// ---------------------------------------------------------------------------
// Shareable verified certificates (Theme A2)
// ---------------------------------------------------------------------------

export async function createCertificateShareLink(input: { token: string; trainingRecordId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [record] = await db
    .select({ id: trainingRecords.id })
    .from(trainingRecords)
    .where(and(eq(trainingRecords.id, input.trainingRecordId), eq(trainingRecords.traineeId, employee.traineeId)))
    .limit(1);
  if (!record) throw new NotFoundError("Training record", String(input.trainingRecordId));

  const expiresAt = new Date(Date.now() + 30 * 86_400_000);
  const token = await new SignJWT({
    purpose: "certificate_share",
    traineeRef: employee.traineeRef,
    recordId: input.trainingRecordId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(TOKEN_SIGNING_SECRET);

  await recordAudit(db, {
    actorType: "employee",
    actorId: employee.traineeId,
    action: "certificate.shared",
    entityType: "trainingRecord",
    entityId: input.trainingRecordId,
    purposeCode: "document_storage",
    metadata: { expiresAt: expiresAt.toISOString() },
  });

  return { url: `/certificates?token=${token}`, expiresAt };
}

/** Public certificate view — the share link itself is the capability. */
export async function getPublicCertificate(input: { token: string }) {
  let traineeRef: string;
  let recordId: number;
  try {
    const { payload } = await jwtVerify(input.token, TOKEN_SIGNING_SECRET);
    if (payload.purpose !== "certificate_share") throw new Error("wrong purpose");
    if (typeof payload.traineeRef !== "string" || typeof payload.recordId !== "number") {
      throw new Error("missing claims");
    }
    traineeRef = payload.traineeRef;
    recordId = payload.recordId;
  } catch {
    throw new NotFoundError("Certificate", "invalid link");
  }

  const db = await requireDb();
  const [row] = await db
    .select({
      name: trainees.displayName,
      district: trainees.district,
      outcomeStatus: trainees.outcomeStatus,
      course: trainingRecords.course,
      provider: trainingRecords.provider,
      cohort: trainingRecords.cohort,
      completionDate: trainingRecords.completionDate,
      certificationStatus: trainingRecords.certificationStatus,
    })
    .from(trainingRecords)
    .innerJoin(trainees, eq(trainingRecords.traineeId, trainees.id))
    .where(and(eq(trainingRecords.id, recordId), eq(trainees.traineeRef, traineeRef)))
    .limit(1);
  if (!row) throw new NotFoundError("Certificate", String(recordId));

  return {
    ...row,
    completionDate: row.completionDate ? row.completionDate.toISOString() : null,
    verified: row.outcomeStatus === "verified",
  };
}

/** Retention worker: deletes vault rows past their retention window. */
export async function purgeExpiredEmployeeDocuments(now = new Date()) {
  const db = await requireDb();
  const expired = await db
    .delete(employeeDocuments)
    .where(and(lte(employeeDocuments.retentionUntil, now)))
    .returning({ id: employeeDocuments.id, storagePath: employeeDocuments.storagePath });

  for (const row of expired) {
    try {
      await deleteDocumentObject(row.storagePath);
    } catch (error) {
      console.error(`[Retention] failed to delete object ${row.storagePath}:`, error);
    }
  }
  if (expired.length > 0) {
    await recordAudit(db, {
      actorType: "system",
      action: "document.retention_purged",
      entityType: "employeeDocument",
      metadata: { count: expired.length },
    });
  }
  return { purged: expired.length };
}

// ---------------------------------------------------------------------------
// Signed capability links
//
// Two flavours share one primitive:
//  - single-use (`consumeOneTimeToken`): employer verification, where replay
//    must be impossible;
//  - reusable (`assertReusableTokenLive`): trainee pulses and passport shares,
//    where a page refresh must keep working but the link must stay revocable.
// ---------------------------------------------------------------------------

export const TRAINEE_PULSE_PURPOSE = "trainee_pulse";

export async function signPurposeToken(input: {
  purpose: string;
  claims: Record<string, unknown>;
  jti?: string;
  ttlDays: number;
}) {
  const jti = input.jti ?? randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlDays * 86_400_000);
  const token = await new SignJWT({ ...input.claims, purpose: input.purpose })
    .setProtectedHeader({ alg: "HS256" })
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(TOKEN_SIGNING_SECRET);
  return { token, jti, expiresAt };
}

export async function verifyPurposeToken(
  token: string,
  purpose: string
): Promise<{ jti: string; payload: Record<string, unknown> }> {
  try {
    const { payload } = await jwtVerify(token, TOKEN_SIGNING_SECRET);
    if (payload.purpose !== purpose || typeof payload.jti !== "string") {
      throw new Error("wrong purpose or missing jti");
    }
    return { jti: payload.jti, payload: payload as Record<string, unknown> };
  } catch {
    throw new NotFoundError("Link", "invalid or expired");
  }
}

/**
 * Verifies a reusable link: signature must hold *and* its persisted jti row
 * must still be live, which is what makes revocation immediate.
 */
export async function assertReusableTokenLive(token: string, purpose: string) {
  const { jti, payload } = await verifyPurposeToken(token, purpose);
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(oneTimeTokens)
    .where(and(eq(oneTimeTokens.jti, jti), eq(oneTimeTokens.purpose, purpose)))
    .limit(1);
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) {
    throw new NotFoundError("Link", "revoked or expired");
  }
  return { row, payload };
}

/** Revokes every live link of a purpose for a trainee (consent withdrawal path). */
export async function revokePurposeTokens(traineeId: number, purpose: string) {
  const db = await requireDb();
  const revoked = await db
    .update(oneTimeTokens)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(oneTimeTokens.traineeId, traineeId),
        eq(oneTimeTokens.purpose, purpose),
        isNull(oneTimeTokens.usedAt)
      )
    )
    .returning({ id: oneTimeTokens.id });
  return { revoked: revoked.length };
}

// ---------------------------------------------------------------------------
// Trainee pulse links (the public mobile flow)
// ---------------------------------------------------------------------------

/** Issues a reusable pulse link so the mobile flow can be refreshed safely. */
export async function createTraineePulseLink(input: { traineeRef: string; ttlDays?: number }) {
  const db = await requireDb();
  const trainee = await getTraineeByRef(input.traineeRef);
  const ttlDays = input.ttlDays ?? 14;
  const { token, jti, expiresAt } = await signPurposeToken({
    purpose: TRAINEE_PULSE_PURPOSE,
    claims: { traineeRef: trainee.traineeRef },
    ttlDays,
  });

  await db.insert(oneTimeTokens).values({
    jti,
    purpose: TRAINEE_PULSE_PURPOSE,
    traineeId: trainee.id,
    expiresAt,
  });
  await recordAudit(db, {
    actorType: "staff",
    action: "pulse.link_created",
    entityType: "trainee",
    entityId: trainee.id,
    purposeCode: "outcome_follow_up",
    metadata: { traineeRef: trainee.traineeRef, expiresAt: expiresAt.toISOString() },
  });

  return { url: `/follow-up/mobile?t=${token}`, expiresAt };
}

/** Resolves a pulse link to its trainee. Never exposes other trainees. */
export async function getTraineePulse(input: { token: string }) {
  const { payload } = await assertReusableTokenLive(input.token, TRAINEE_PULSE_PURPOSE);
  const traineeRef = typeof payload.traineeRef === "string" ? payload.traineeRef : "";
  if (!traineeRef) throw new NotFoundError("Link", "missing trainee claim");
  return getTraineeByRef(traineeRef);
}

/** Public pulse submission: the token is the authorisation, not a slug. */
export async function submitTraineePulseResponse(input: {
  token: string;
  outcomeType: OutcomeTypeValue;
  wageBand?: string | null;
  relevance?: number | null;
  consentToContact: boolean;
}) {
  const trainee = await getTraineePulse({ token: input.token });
  return submitTraineeResponse({
    slug: trainee.slug,
    outcomeType: input.outcomeType,
    wageBand: input.wageBand ?? null,
    relevance: input.relevance ?? null,
    consentToContact: input.consentToContact,
  });
}

// ---------------------------------------------------------------------------
// Counsellor escalation (the "assign to counsellor" action)
// ---------------------------------------------------------------------------

export async function escalateTrainee(input: {
  traineeRef: string;
  priority?: "P1" | "P2" | "P3" | "P4";
  reason?: string;
  assignedTo?: string | null;
}) {
  const db = await requireDb();
  const trainee = await getTraineeByRef(input.traineeRef);

  const [openCase] = await db
    .select({ id: counsellorCases.id })
    .from(counsellorCases)
    .where(
      and(
        eq(counsellorCases.traineeId, trainee.id),
        inArray(counsellorCases.status, ["open", "assigned"])
      )
    )
    .limit(1);
  if (openCase) return { caseId: openCase.id, created: false as const };

  const priority = input.priority ?? "P2";
  const [created] = await db
    .insert(counsellorCases)
    .values({
      traineeId: trainee.id,
      priority,
      title: "Counsellor review requested",
      reason: input.reason ?? "Escalated from the trainee journey by staff.",
      nextAction: "Contact the trainee and confirm the next step",
      channel: "whatsapp",
      status: "assigned",
      assignedTo: input.assignedTo ?? null,
      dueAt: new Date(Date.now() + 86_400_000),
    })
    .returning({ id: counsellorCases.id });

  await recordAudit(db, {
    actorType: "staff",
    action: "case.escalated",
    entityType: "counsellorCase",
    entityId: created.id,
    purposeCode: "outcome_follow_up",
    metadata: { traineeRef: trainee.traineeRef, priority },
  });

  return { caseId: created.id, created: true as const };
}

// ---------------------------------------------------------------------------
// Explainable attrition-risk watchlist
// ---------------------------------------------------------------------------

/**
 * Rule-based risk scoring over existing fields. Deliberately not a model: every
 * flag names the fact that raised it, so a counsellor can disagree with it.
 */
export async function getRiskWatchlist() {
  const db = await requireDb();
  const [allTrainees, events, tasks] = await Promise.all([
    db.select().from(trainees),
    db
      .select({
        traineeId: outcomeEvents.traineeId,
        wageBand: outcomeEvents.wageBand,
        effectiveStartDate: outcomeEvents.effectiveStartDate,
        supersedesEventId: outcomeEvents.supersedesEventId,
      })
      .from(outcomeEvents),
    db
      .select({ traineeId: followUpTasks.traineeId, status: followUpTasks.status, attemptNumber: followUpTasks.attemptNumber })
      .from(followUpTasks),
  ]);

  const now = Date.now();
  const eventsByTrainee = new Map<number, typeof events>();
  for (const event of events) {
    const list = eventsByTrainee.get(event.traineeId) ?? [];
    list.push(event);
    eventsByTrainee.set(event.traineeId, list);
  }

  const silentByTrainee = new Map<number, number>();
  for (const task of tasks) {
    if (task.status === "sent" || task.status === "failed") {
      const current = silentByTrainee.get(task.traineeId) ?? 0;
      silentByTrainee.set(task.traineeId, Math.max(current, task.attemptNumber));
    }
  }

  return allTrainees
    .map((trainee) => {
      const chain = (eventsByTrainee.get(trainee.id) ?? []).sort(
        (a, b) => (a.effectiveStartDate?.getTime() ?? 0) - (b.effectiveStartDate?.getTime() ?? 0)
      );
      const previousWage = chain.length > 1 ? wageBandMidpoint(chain[chain.length - 2].wageBand) : null;
      const currentWage = wageBandMidpoint(trainee.wageBand);
      const risk = buildRiskFlags({
        outcomeType: trainee.outcomeType,
        relevance: trainee.relevance,
        retentionDays: trainee.retentionDays,
        barrier: trainee.barrier,
        daysSinceUpdate: Math.round((now - trainee.lastUpdated.getTime()) / 86_400_000),
        unansweredReminders: silentByTrainee.get(trainee.id) ?? 0,
        previousWageMidpoint: previousWage,
        currentWageMidpoint: currentWage,
      });
      return { trainee, ...risk };
    })
    .filter((entry) => entry.flags.length > 0)
    .sort((a, b) => b.score - a.score || a.trainee.displayName.localeCompare(b.trainee.displayName));
}

// ---------------------------------------------------------------------------
// Public provider scorecards (aggregated from the trainee register)
// ---------------------------------------------------------------------------

export type ProviderScorecardRow = {
  provider: string;
  districts: string[];
  completed: number;
  verified: number;
  retention: number;
  relevance: number | null;
};

export async function listProviderScorecards(): Promise<ProviderScorecardRow[]> {
  const db = await requireDb();
  const rows = await db
    .select({
      provider: trainees.provider,
      districts: sql<string[]>`array_agg(distinct ${trainees.district})`,
      completed: sql<number>`count(*)::int`,
      verified: sql<number>`count(*) filter (where ${trainees.outcomeStatus} = 'verified')::int`,
      employed: sql<number>`count(*) filter (where ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
      retained90: sql<number>`count(*) filter (where ${trainees.retentionDays} >= 90 and ${trainees.outcomeType} in ('formal_employment','self_employment','apprenticeship'))::int`,
      relevance: sql<number | null>`avg(${trainees.relevance})`,
    })
    .from(trainees)
    .groupBy(trainees.provider)
    .orderBy(sql`count(*) desc`);

  return rows.map((row) => ({
    provider: row.provider,
    districts: row.districts ?? [],
    completed: row.completed,
    verified: share(row.verified, row.employed),
    retention: share(row.retained90, row.employed),
    relevance: row.relevance === null ? null : Number(row.relevance),
  }));
}
