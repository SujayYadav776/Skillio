/**
 * Grievance & support desk (A4).
 *
 * Reuses `counsellorCases` (now with a `kind` column) for escalated, case-work
 * and employee-opened grievances, and adds `caseMessages` as the thread. Inbound
 * webhook content is still never persisted; only deliberate replies authored by
 * staff or the employee are stored here.
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { caseMessages, counsellorCases, trainees } from "../drizzle/schema";
import {
  InputValidationError,
  NotFoundError,
  recordAudit,
  requireDb,
  resolveEmployeeFromToken,
} from "./queries";

export const GRIEVANCE_KINDS = ["grievance", "wage_dispute", "harassment", "benefit", "other"] as const;

type GrievanceKind = (typeof GRIEVANCE_KINDS)[number];

function assertGrievanceKind(value: string): asserts value is GrievanceKind {
  if (!GRIEVANCE_KINDS.includes(value as GrievanceKind)) {
    throw new InputValidationError(`Grievance kind must be one of ${GRIEVANCE_KINDS.join(", ")}`);
  }
}

/** Employee-opened grievance: creates a P2 case + first message + audit. */
export async function openGrievance(input: {
  token: string;
  kind: string;
  subject: string;
  body: string;
}) {
  assertGrievanceKind(input.kind);
  const body = input.body.trim();
  if (!body) throw new InputValidationError("Message body cannot be empty");

  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);

  return db.transaction(async (tx) => {
    const [trainee] = await tx
      .select({ name: trainees.displayName })
      .from(trainees)
      .where(eq(trainees.id, employee.traineeId))
      .limit(1);

    const [caseRow] = await tx
      .insert(counsellorCases)
      .values({
        traineeId: employee.traineeId,
        kind: input.kind as GrievanceKind,
        priority: "P2",
        title: `${input.subject.trim().slice(0, 160)}`,
        reason: "employee_submitted",
        nextAction: "Ops team to review and respond",
        channel: "portal",
        status: "open",
        dueAt: new Date(Date.now() + 7 * 86_400_000),
      })
      .returning();

    await tx.insert(caseMessages).values({
      caseId: caseRow.id,
      author: "employee",
      authorName: trainee ? trainee.name : "Employee",
      body,
    });

    await recordAudit(tx, {
      actorType: "system",
      action: "grievance.opened",
      entityType: "counsellorCase",
      entityId: caseRow.id,
      purposeCode: "grievance_support",
      metadata: { traineeRef: employee.traineeRef, kind: input.kind },
    });

    return { accepted: true, caseId: caseRow.id, kind: input.kind };
  });
}

/**
 * Reads one case's thread. Public path requires the employee's own token;
 * staff pass a district scope (null = admin sees everything).
 */
async function loadCaseThread(input: { caseId: number }, opts: { district: string | null }) {
  const db = await requireDb();
  const conditions = [eq(counsellorCases.id, input.caseId)];
  if (opts.district) {
    conditions.push(eq(trainees.district, opts.district));
  }
  const [row] = await db
    .select({
      id: counsellorCases.id,
      traineeId: counsellorCases.traineeId,
      kind: counsellorCases.kind,
      priority: counsellorCases.priority,
      title: counsellorCases.title,
      status: counsellorCases.status,
      assignedTo: counsellorCases.assignedTo,
      dueAt: counsellorCases.dueAt,
      createdAt: counsellorCases.createdAt,
      traineeName: trainees.displayName,
      district: trainees.district,
    })
    .from(counsellorCases)
    .innerJoin(trainees, eq(counsellorCases.traineeId, trainees.id))
    .where(and(...conditions))
    .limit(1);
  if (!row) throw new NotFoundError("Case", String(input.caseId));

  const messages = await db
    .select()
    .from(caseMessages)
    .where(eq(caseMessages.caseId, row.id))
    .orderBy(asc(caseMessages.createdAt), asc(caseMessages.id));

  return {
    ...row,
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    messages: messages.map((m) => ({
      id: m.id,
      author: m.author,
      authorName: m.authorName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

/** Employee-side read: only their own case, via their portal token. */
export async function getEmployeeCase(input: { token: string; caseId: number }) {
  const employee = await resolveEmployeeFromToken(input.token);
  const db = await requireDb();
  const [row] = await db
    .select({ id: counsellorCases.id, traineeId: counsellorCases.traineeId })
    .from(counsellorCases)
    .where(eq(counsellorCases.id, input.caseId))
    .limit(1);
  if (!row || row.traineeId !== employee.traineeId) {
    throw new NotFoundError("Case", String(input.caseId));
  }
  return loadCaseThread({ caseId: input.caseId }, { district: null });
}

/** Employee posts a follow-up message on their own case. */
export async function postEmployeeReply(input: { token: string; caseId: number; body: string }) {
  const body = input.body.trim();
  if (!body) throw new InputValidationError("Message body cannot be empty");
  const employee = await resolveEmployeeFromToken(input.token);
  const db = await requireDb();
  const [row] = await db
    .select({ id: counsellorCases.id, traineeId: counsellorCases.traineeId })
    .from(counsellorCases)
    .where(eq(counsellorCases.id, input.caseId))
    .limit(1);
  if (!row || row.traineeId !== employee.traineeId) {
    throw new NotFoundError("Case", String(input.caseId));
  }
  const [trainee] = await db
    .select({ name: trainees.displayName })
    .from(trainees)
    .where(eq(trainees.id, employee.traineeId))
    .limit(1);
  const [message] = await db
    .insert(caseMessages)
    .values({ caseId: row.id, author: "employee", authorName: trainee?.name ?? "Employee", body })
    .returning();
  return { accepted: true, messageId: message.id };
}
// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

export async function listOpenCases(input: { district: string | null; status?: string | null }) {
  const db = await requireDb();
  const parts: Array<ReturnType<typeof eq>> = [];
  if (input.district) parts.push(eq(trainees.district, input.district));
  parts.push(
    input.status
      ? eq(counsellorCases.status, input.status as (typeof counsellorCases)["$inferSelect"]["status"])
      : eq(counsellorCases.status, "open")
  );

  const rows = await db
    .select({
      id: counsellorCases.id,
      kind: counsellorCases.kind,
      priority: counsellorCases.priority,
      title: counsellorCases.title,
      status: counsellorCases.status,
      assignedTo: counsellorCases.assignedTo,
      dueAt: counsellorCases.dueAt,
      createdAt: counsellorCases.createdAt,
      traineeRef: trainees.traineeRef,
      traineeName: trainees.displayName,
      district: trainees.district,
    })
    .from(counsellorCases)
    .innerJoin(trainees, eq(counsellorCases.traineeId, trainees.id))
    .where(and(...parts))
    .orderBy(desc(counsellorCases.priority), asc(counsellorCases.createdAt));

  const ids = rows.map((row) => row.id);
  const messages = ids.length
    ? await db
        .select({
          caseId: caseMessages.caseId,
          body: caseMessages.body,
          createdAt: caseMessages.createdAt,
        })
        .from(caseMessages)
        .where(inArray(caseMessages.caseId, ids))
        .orderBy(asc(caseMessages.createdAt), asc(caseMessages.id))
    : [];
  const byCase = new Map<number, string>();
  for (const m of messages) byCase.set(m.caseId, m.body); // ascending → last win = latest

  return rows.map((row) => ({
    ...row,
    dueAt: row.dueAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    lastMessage: byCase.get(row.id) ?? null,
  }));
}

/** Staff read of a case thread; a scoped counsellor is restricted to their district. */
export async function getCaseThread(input: { caseId: number; district: string | null }) {
  return loadCaseThread({ caseId: input.caseId }, { district: input.district });
}

export async function postStaffReply(input: {
  caseId: number;
  district: string | null;
  authorName: string | null;
  body: string;
}) {
  const body = input.body.trim();
  if (!body) throw new InputValidationError("Message body cannot be empty");
  await loadCaseThread({ caseId: input.caseId }, { district: input.district }); // enforces scope + existence
  const db = await requireDb();
  const [message] = await db
    .insert(caseMessages)
    .values({
      caseId: input.caseId,
      author: "staff",
      authorName: input.authorName ?? "Counsellor",
      body,
    })
    .returning();
  return { accepted: true, messageId: message.id };
}

export async function assignCase(input: { caseId: number; district: string | null; assignedTo: string }) {
  await loadCaseThread({ caseId: input.caseId }, { district: input.district });
  const db = await requireDb();
  const [row] = await db
    .update(counsellorCases)
    .set({ assignedTo: input.assignedTo, status: "assigned" })
    .where(eq(counsellorCases.id, input.caseId))
    .returning({ id: counsellorCases.id, traineeId: counsellorCases.traineeId });
  if (!row) throw new NotFoundError("Case", String(input.caseId));
  await recordAudit(db, {
    actorType: "staff",
    action: "case.assigned",
    entityType: "counsellorCase",
    entityId: row.id,
    purposeCode: "grievance_support",
    metadata: { assignedTo: input.assignedTo },
  });
  return { accepted: true, assignedTo: input.assignedTo };
}

export async function resolveCase(input: { caseId: number; district: string | null; note?: string | null }) {
  await loadCaseThread({ caseId: input.caseId }, { district: input.district });
  const db = await requireDb();
  const [row] = await db
    .update(counsellorCases)
    .set({ status: "resolved", assignedTo: null })
    .where(eq(counsellorCases.id, input.caseId))
    .returning({ id: counsellorCases.id });
  if (!row) throw new NotFoundError("Case", String(input.caseId));

  if (input.note?.trim()) {
    await db.insert(caseMessages).values({
      caseId: input.caseId,
      author: "system",
      authorName: "System",
      body: `Case resolved: ${input.note.trim()}`,
    });
  }
  await recordAudit(db, {
    actorType: "staff",
    action: "case.resolved",
    entityType: "counsellorCase",
    entityId: row.id,
    purposeCode: "grievance_support",
  });
  return { accepted: true };
}

/** Employee portal: list the token owner's own cases (for the support desk). */
export async function listEmployeeCases(input: { token: string }) {
  const employee = await resolveEmployeeFromToken(input.token);
  const db = await requireDb();
  const rows = await db
    .select({
      id: counsellorCases.id,
      kind: counsellorCases.kind,
      priority: counsellorCases.priority,
      title: counsellorCases.title,
      status: counsellorCases.status,
      createdAt: counsellorCases.createdAt,
    })
    .from(counsellorCases)
    .where(eq(counsellorCases.traineeId, employee.traineeId))
    .orderBy(desc(counsellorCases.createdAt), desc(counsellorCases.id));

  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    priority: row.priority,
    title: row.title,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  }));
}
