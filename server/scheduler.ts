import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "./db";
import { getMessagingProvider } from "./messaging";
import { purgeExpiredEmployeeDocuments } from "./queries";
import { purgeExpiredPassportShares, refreshPublishedPassports } from "./passport";
import {
  auditEvents,
  consentGrants,
  counsellorCases,
  followUpTasks,
  messageJobs,
  oneTimeTokens,
  outcomeEvents,
  trainees,
} from "../drizzle/schema";

const TEMPLATE_BY_PURPOSE: Record<string, string> = {
  outcome_follow_up: "outcome_pulse_90d",
  job_loss_support: "job_loss_support_v1",
  placement_support: "placement_support_v1",
  relevance_review: "relevance_review_v1",
};
const DEFAULT_TEMPLATE = "generic_follow_up_v1";
const ESCALATION_AFTER_DAYS = 7;
const REMINDER_AFTER_DAYS = 3;
const MAX_ATTEMPTS = 2;

/**
 * Promotes due scheduled follow-up tasks to message jobs and hands them to the
 * provider. A "sent" task that heard nothing back for REMINDER_AFTER_DAYS gets
 * one reminder attempt (up to MAX_ATTEMPTS). Tasks needing a call stay human;
 * tasks without consent are cancelled; tasks without a contact address stay put.
 */
export async function promoteDueFollowUps(now = new Date()) {
  const db = await getDb();
  if (!db) return { promoted: 0, skipped: 0 };

  const reminderCutoff = new Date(now.getTime() - REMINDER_AFTER_DAYS * 86_400_000);
  const due = await db
    .select()
    .from(followUpTasks)
    .where(
      or(
        and(eq(followUpTasks.status, "scheduled"), lte(followUpTasks.dueAt, now)),
        and(
          eq(followUpTasks.status, "sent"),
          sql`${followUpTasks.attemptNumber} < ${MAX_ATTEMPTS}`,
          lte(followUpTasks.dueAt, reminderCutoff)
        )
      )
    );

  let promoted = 0;
  let skipped = 0;

  for (const task of due) {
    if (task.preferredChannel === "call") {
      skipped += 1; // call tasks stay human-owned
      continue;
    }

    const [trainee] = await db
      .select({ contactPhone: trainees.contactPhone, consentStatus: trainees.consentStatus })
      .from(trainees)
      .where(eq(trainees.id, task.traineeId))
      .limit(1);

    if (!trainee || trainee.consentStatus !== "active") {
      await db
        .update(followUpTasks)
        .set({ status: "cancelled" })
        .where(and(eq(followUpTasks.id, task.id), eq(followUpTasks.status, "scheduled")));
      await db.insert(auditEvents).values({
        actorType: "system",
        action: "followup.cancelled_no_consent",
        entityType: "followUpTask",
        entityId: task.id,
        purposeCode: task.purposeCode,
      });
      skipped += 1;
      continue;
    }
    if (!trainee.contactPhone) {
      skipped += 1;
      continue;
    }

    const attemptNumber = task.attemptNumber + 1;
    const idempotencyKey = `auto:${task.id}:${attemptNumber}`;
    const [job] = await db
      .insert(messageJobs)
      .values({
        followUpTaskId: task.id,
        traineeId: task.traineeId,
        channel: task.preferredChannel === "sms" ? "sms" : "whatsapp",
        templateCode: TEMPLATE_BY_PURPOSE[task.purposeCode] ?? DEFAULT_TEMPLATE,
        idempotencyKey,
        scheduledAt: now,
      })
      .onConflictDoNothing({ target: messageJobs.idempotencyKey })
      .returning();
    if (!job) {
      skipped += 1;
      continue;
    }

    await db
      .update(followUpTasks)
      .set({ status: "sent", attemptNumber })
      .where(eq(followUpTasks.id, task.id));

    try {
      const result = await getMessagingProvider().send({
        channel: task.preferredChannel === "sms" ? "sms" : "whatsapp",
        to: trainee.contactPhone,
        templateCode: job.templateCode,
        idempotencyKey,
      });
      await db
        .update(messageJobs)
        .set({ status: "accepted", providerMessageId: result.providerMessageId })
        .where(eq(messageJobs.id, job.id));
    } catch (error) {
      const errorCode =
        error && typeof error === "object" && "errorCode" in error
          ? String(error.errorCode)
          : "provider_error";
      await db
        .update(messageJobs)
        .set({ status: "failed", lastErrorCode: errorCode })
        .where(eq(messageJobs.id, job.id));
    }
    promoted += 1;
  }

  return { promoted, skipped };
}

/**
 * Escalation rule shown on the FollowUps screen: after two unanswered reminders
 * (task still "sent" past its grace window), open a counsellor case and expire
 * the task. Content of the reminder is never needed — only the fact of silence.
 */
export async function escalateUnansweredFollowUps(now = new Date()) {
  const db = await getDb();
  if (!db) return { escalated: 0 };

  const cutoff = new Date(now.getTime() - ESCALATION_AFTER_DAYS * 86_400_000);
  const stale = await db
    .select()
    .from(followUpTasks)
    .where(
      and(
        eq(followUpTasks.status, "sent"),
        sql`${followUpTasks.attemptNumber} >= 2`,
        lte(followUpTasks.dueAt, cutoff)
      )
    );

  let escalated = 0;
  for (const task of stale) {
    const [openCase] = await db
      .select({ id: counsellorCases.id })
      .from(counsellorCases)
      .where(
        and(
          eq(counsellorCases.traineeId, task.traineeId),
          or(eq(counsellorCases.status, "open"), eq(counsellorCases.status, "assigned"))
        )
      )
      .limit(1);
    if (openCase) continue;

    await db.insert(counsellorCases).values({
      traineeId: task.traineeId,
      priority: "P2",
      title: "No response after two reminders",
      reason: `Follow-up ${task.checkpointCode} went unanswered after ${task.attemptNumber} attempts`,
      nextAction: "Try a different channel or schedule a call",
      channel: task.preferredChannel,
      status: "open",
    });
    await db
      .update(followUpTasks)
      .set({ status: "expired" })
      .where(eq(followUpTasks.id, task.id));
    await db.insert(auditEvents).values({
      actorType: "system",
      action: "followup.escalated_no_response",
      entityType: "followUpTask",
      entityId: task.id,
      purposeCode: task.purposeCode,
      metadata: { attempts: task.attemptNumber },
    });
    escalated += 1;
  }

  return { escalated };
}

/** Consent expiry worker: grants past their expiresAt become expired. */
export async function expireStaleConsents(now = new Date()) {
  const db = await getDb();
  if (!db) return { expired: 0 };

  const expired = await db
    .update(consentGrants)
    .set({ status: "expired" })
    .where(
      and(eq(consentGrants.status, "granted"), lte(consentGrants.expiresAt, now))
    )
    .returning({ id: consentGrants.id, traineeId: consentGrants.traineeId });

  for (const grant of expired) {
    await db.insert(auditEvents).values({
      actorType: "system",
      action: "consent.expired",
      entityType: "consentGrant",
      entityId: grant.id,
      metadata: { traineeId: grant.traineeId },
    });
  }
  return { expired: expired.length };
}

// ---------------------------------------------------------------------------
// Retention / hygiene workers
// ---------------------------------------------------------------------------

/**
 * Data-invariant repair: a trainee must have at most one active outcome event.
 * If a write raced and left several, all but the latest are superseded with a
 * closing end date and an audit row explaining the repair.
 */
export async function enforceSingleActiveOutcome(now = new Date()) {
  const db = await getDb();
  if (!db) return { repaired: 0 };

  const actives = await db
    .select({
      id: outcomeEvents.id,
      traineeId: outcomeEvents.traineeId,
      effectiveStartDate: outcomeEvents.effectiveStartDate,
      createdAt: outcomeEvents.createdAt,
    })
    .from(outcomeEvents)
    .where(eq(outcomeEvents.state, "active"));

  const byTrainee = new Map<number, typeof actives>();
  for (const event of actives) {
    const group = byTrainee.get(event.traineeId) ?? [];
    group.push(event);
    byTrainee.set(event.traineeId, group);
  }

  let repaired = 0;
  for (const [traineeId, group] of Array.from(byTrainee.entries())) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(
      (a, b) =>
        (b.effectiveStartDate?.getTime() ?? b.createdAt.getTime()) -
        (a.effectiveStartDate?.getTime() ?? a.createdAt.getTime())
    );
    const keep = sorted[0];
    const stale = sorted.slice(1).map((event) => event.id);
    await db
      .update(outcomeEvents)
      .set({ state: "superseded", effectiveEndDate: now, supersedesEventId: keep.id })
      .where(inArray(outcomeEvents.id, stale));
    await db.insert(auditEvents).values({
      actorType: "system",
      action: "outcome.duplicate_active_repaired",
      entityType: "trainee",
      entityId: traineeId,
      metadata: { keptEventId: keep.id, supersededEventIds: stale },
    });
    repaired += stale.length;
  }
  return { repaired };
}

/** Purges one-time tokens that expired more than 30 days ago. */
export async function purgeExpiredOneTimeTokens(now = new Date()) {
  const db = await getDb();
  if (!db) return { purged: 0 };
  const cutoff = new Date(now.getTime() - 30 * 86_400_000);
  const purged = await db
    .delete(oneTimeTokens)
    .where(lte(oneTimeTokens.expiresAt, cutoff))
    .returning({ id: oneTimeTokens.id });
  return { purged: purged.length };
}

export type AuditHealthReport = {
  messageJobsTerminalShare: number | null;
  staleNonTerminalJobs: number;
  traineesWithoutConsentGrant: number;
};

/**
 * Audit completeness check: measures whether the operational trail is closing
 * (message jobs reaching a terminal state) and whether every trainee has at
 * least one consent record. Purely observational — logs and returns counts.
 */
export async function auditCompletenessCheck(): Promise<AuditHealthReport> {
  const db = await getDb();
  if (!db) {
    return { messageJobsTerminalShare: null, staleNonTerminalJobs: 0, traineesWithoutConsentGrant: 0 };
  }

  const [jobs] = await db
    .select({
      total: sql<number>`count(*)::int`,
      terminal: sql<number>`count(*) filter (where ${messageJobs.status} in ('delivered','read','failed','undelivered'))::int`,
      staleNonTerminal: sql<number>`count(*) filter (where ${messageJobs.status} in ('queued','accepted') and ${messageJobs.scheduledAt} < now() - interval '3 days')::int`,
    })
    .from(messageJobs);

  const [consentless] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(trainees)
    .where(
      sql`not exists (select 1 from ${consentGrants} where ${consentGrants.traineeId} = ${trainees.id})`
    );

  const report: AuditHealthReport = {
    messageJobsTerminalShare: jobs.total > 0 ? jobs.terminal / jobs.total : null,
    staleNonTerminalJobs: jobs.staleNonTerminal,
    traineesWithoutConsentGrant: consentless.count,
  };
  console.log(
    `[Scheduler] audit health: terminalShare=${report.messageJobsTerminalShare ?? "n/a"} staleNonTerminal=${report.staleNonTerminalJobs} consentlessTrainees=${report.traineesWithoutConsentGrant}`
  );
  return report;
}

let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function runCycle() {
  if (running) return;
  running = true;
  try {
    await promoteDueFollowUps();
    await escalateUnansweredFollowUps();
    await expireStaleConsents();
    await enforceSingleActiveOutcome();
    await purgeExpiredOneTimeTokens();
    await purgeExpiredEmployeeDocuments();
    // Passports are snapshots: rebuild the published ones whose holder data
    // changed, so a shared link never shows a stale career record.
    await refreshPublishedPassports();
    await purgeExpiredPassportShares();
    await auditCompletenessCheck();
  } catch (error) {
    console.error("[Scheduler] cycle failed:", error);
  } finally {
    running = false;
  }
}

/** Starts the periodic scheduler (60s cadence); a no-op when disabled. */
export function startScheduler() {
  if (timer || process.env.SCHEDULER_ENABLED === "false") return;
  timer = setInterval(() => void runCycle(), 60_000);
  timer.unref?.();
  console.log("[Scheduler] started (60s cadence)");
}

export function stopScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
