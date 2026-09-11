/**
 * Benefits & scheme eligibility (A3).
 *
 * Schemes are centrally-authored with an auditable rule set stored as JSON.
 * Match is deterministic and explainable: every check returns { label, met } so
 * an employee or counsellor can always see *why* a scheme is (or isn't) shown.
 * Eligibility is recomputed on read and materialised into `employeeBenefits` so
 * the portal shows a stable "eligible → apply → approved → received" pipeline.
 */
import { and, asc, desc, eq } from "drizzle-orm";
import {
  benefitSchemes,
  employeeBenefits,
  employees,
  trainees,
  trainingRecords,
  type BenefitRules,
  type EmployeeBenefit,
} from "../drizzle/schema";
import {
  InputValidationError,
  NotFoundError,
  recordAudit,
  requireDb,
  resolveEmployeeFromToken,
  wageBandMidpoint,
  type DbOrTx,
} from "./queries";

export type BenefitCheck = { label: string; met: boolean };

export type EmployeeBenefitProfile = {
  traineeId: number;
  district: string;
  outcomeType: string;
  wageMidpoint: number | null;
  retentionDays: number;
  courses: string[];
};

/** Small pure matcher so the rule logic is unit-testable without a database. */
export function evaluateBenefitEligibility(
  profile: EmployeeBenefitProfile,
  rules: BenefitRules
): { eligible: boolean; checks: BenefitCheck[] } {
  const checks: BenefitCheck[] = [];

  const districts = rules.districts;
  if (districts && districts.length > 0) {
    checks.push({
      label: `Located in one of: ${districts.join(", ")}`,
      met: districts.includes(profile.district),
    });
  }

  if (rules.outcomeTypes && rules.outcomeTypes.length > 0) {
    checks.push({
      label: `Employment aligns with: ${rules.outcomeTypes.join(", ")}`,
      met: rules.outcomeTypes.includes(profile.outcomeType),
    });
  }

  if (rules.requiredCourses && rules.requiredCourses.length > 0) {
    const have = profile.courses.some((course) =>
      rules.requiredCourses!.some((want) => course.toLowerCase().includes(want.toLowerCase()))
    );
    checks.push({
      label: `Completed a qualifying course (${rules.requiredCourses.join(", ")})`,
      met: have,
    });
  }

  if (rules.minWageMidpoint != null) {
    const met = profile.wageMidpoint != null && profile.wageMidpoint >= rules.minWageMidpoint;
    checks.push({ label: `Earning at least ₹${rules.minWageMidpoint}k/month`, met });
  }

  if (rules.minRetentionDays != null) {
    checks.push({
      label: `Retained at least ${rules.minRetentionDays} days`,
      met: profile.retentionDays >= rules.minRetentionDays,
    });
  }

  if (checks.length === 0) {
    checks.push({ label: "Open to all eligible employees", met: true });
  }

  return { eligible: checks.every((check) => check.met), checks };
}

async function buildProfileFor(traineeId: number): Promise<EmployeeBenefitProfile> {
  const db = await requireDb();
  const [trainee] = await db
    .select({
      district: trainees.district,
      outcomeType: trainees.outcomeType,
      wageBand: trainees.wageBand,
      retentionDays: trainees.retentionDays,
    })
    .from(trainees)
    .where(eq(trainees.id, traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(traineeId));

  const records = await db
    .select({ course: trainingRecords.course })
    .from(trainingRecords)
    .where(eq(trainingRecords.traineeId, traineeId));

  return {
    traineeId,
    district: trainee.district,
    outcomeType: trainee.outcomeType,
    wageMidpoint: wageBandMidpoint(trainee.wageBand),
    retentionDays: trainee.retentionDays,
    courses: records.map((record) => record.course),
  };
}

/** Materialises eligibility: upserts an eligible row per matching active scheme. */
async function syncEligibilityRows(
  handle: DbOrTx,
  employeeId: number,
  profile: EmployeeBenefitProfile
): Promise<EmployeeBenefit[]> {
  const schemes = await handle.select().from(benefitSchemes).where(eq(benefitSchemes.active, true));
  const existing = await handle
    .select({ schemeId: employeeBenefits.schemeId })
    .from(employeeBenefits)
    .where(eq(employeeBenefits.employeeId, employeeId));

  const known = new Set(existing.map((row) => row.schemeId));
  const rows: EmployeeBenefit[] = [];

  for (const scheme of schemes) {
    const { eligible } = evaluateBenefitEligibility(profile, scheme.eligibilityRules);
    if (!eligible) continue;
    if (known.has(scheme.id)) continue;
    const [row] = await handle
      .insert(employeeBenefits)
      .values({ employeeId, schemeId: scheme.id, matchedAt: new Date() })
      .onConflictDoNothing()
      .returning();
    if (row) rows.push(row);
  }
  return rows;
}

/** Employee-portal read: eligible benefits for the token owner. */
export async function listEmployeeBenefits(input: { token: string }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const profile = await buildProfileFor(employee.traineeId);
  await syncEligibilityRows(db, employee.employeeId, profile);

  const schemes = await db.select().from(benefitSchemes);
  const benefits = await db
    .select()
    .from(employeeBenefits)
    .where(eq(employeeBenefits.employeeId, employee.employeeId));

  const byScheme = new Map(benefits.map((row) => [row.schemeId, row]));
  const items = [];
  for (const scheme of schemes) {
    const { eligible, checks } = evaluateBenefitEligibility(profile, scheme.eligibilityRules);
    const record = byScheme.get(scheme.id);
    items.push({
      schemeId: scheme.id,
      code: scheme.code,
      title: scheme.title,
      description: scheme.description,
      agency: scheme.agency,
      eligible,
      checks,
      status: record?.status ?? null,
      appliedAt: record?.appliedAt?.toISOString() ?? null,
      decidedAt: record?.decidedAt?.toISOString() ?? null,
      notes: record?.notes ?? null,
    });
  }
  return { items };
}

/** Employee taps "apply" on an eligible scheme. */
export async function applyForBenefit(input: { token: string; schemeId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const profile = await buildProfileFor(employee.traineeId);

  const [scheme] = await db
    .select()
    .from(benefitSchemes)
    .where(eq(benefitSchemes.id, input.schemeId));
  if (!scheme || !scheme.active) throw new NotFoundError("Benefit scheme", String(input.schemeId));
  const { eligible } = evaluateBenefitEligibility(profile, scheme.eligibilityRules);
  if (!eligible) throw new InputValidationError("This scheme is not available for you yet");

  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(employeeBenefits)
      .values({
        employeeId: employee.employeeId,
        schemeId: scheme.id,
        status: "applied",
        matchedAt: new Date(),
        appliedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [employeeBenefits.employeeId, employeeBenefits.schemeId],
        set: { status: "applied", appliedAt: new Date(), updatedAt: new Date() },
      })
      .returning();

    await recordAudit(tx, {
      actorType: "system",
      action: "benefit.applied",
      entityType: "employeeBenefit",
      entityId: row.id,
      purposeCode: "benefit_support",
      metadata: { traineeRef: employee.traineeRef, schemeCode: scheme.code },
    });
    return { accepted: true, benefitId: row.id, status: "applied" as const };
  });
}

// ---------------------------------------------------------------------------
// Staff side
// ---------------------------------------------------------------------------

export async function listBenefitSchemes(input: { activeOnly?: boolean } = {}) {
  const db = await requireDb();
  return db
    .select()
    .from(benefitSchemes)
    .where(input.activeOnly ? eq(benefitSchemes.active, true) : undefined)
    .orderBy(asc(benefitSchemes.title));
}

export async function createBenefitScheme(input: {
  code: string;
  title: string;
  description?: string | null;
  agency: string;
  district?: string | null;
  eligibilityRules?: BenefitRules;
  active?: boolean;
}) {
  const db = await requireDb();
  const [row] = await db
    .insert(benefitSchemes)
    .values({
      code: input.code.trim(),
      title: input.title.trim(),
      description: input.description ?? null,
      agency: input.agency.trim(),
      district: input.district ?? null,
      eligibilityRules: input.eligibilityRules ?? {},
      active: input.active ?? true,
    })
    .returning();
  await recordAudit(db, {
    actorType: "staff",
    action: "benefit.scheme_created",
    entityType: "benefitScheme",
    entityId: row.id,
    purposeCode: "benefit_support",
    metadata: { code: row.code },
  });
  return row;
}

export async function setBenefitStatus(input: {
  benefitId: number;
  status: EmployeeBenefit["status"];
  notes?: string | null;
}) {
  const db = await requireDb();
  const [row] = await db
    .update(employeeBenefits)
    .set({
      status: input.status,
      notes: input.notes ?? null,
      decidedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(employeeBenefits.id, input.benefitId))
    .returning();
  if (!row) throw new NotFoundError("Benefit claim", String(input.benefitId));
  await recordAudit(db, {
    actorType: "staff",
    action: "benefit.status_updated",
    entityType: "employeeBenefit",
    entityId: row.id,
    purposeCode: "benefit_support",
    metadata: { status: input.status },
  });
  return row;
}

/** Staff register of claims, with trainee names joined in. */
export async function listBenefitClaims(input: { status?: string | null; district?: string | null } = {}) {
  const db = await requireDb();
  const conditions: ReturnType<typeof eq>[] = [];
  if (input.status) conditions.push(eq(employeeBenefits.status, input.status as EmployeeBenefit["status"]));
  if (input.district) conditions.push(eq(trainees.district, input.district));

  return db
    .select({
      id: employeeBenefits.id,
      status: employeeBenefits.status,
      appliedAt: employeeBenefits.appliedAt,
      decidedAt: employeeBenefits.decidedAt,
      notes: employeeBenefits.notes,
      traineeRef: trainees.traineeRef,
      traineeName: trainees.displayName,
      district: trainees.district,
      schemeId: benefitSchemes.id,
      schemeCode: benefitSchemes.code,
      schemeTitle: benefitSchemes.title,
    })
    .from(employeeBenefits)
    .innerJoin(benefitSchemes, eq(employeeBenefits.schemeId, benefitSchemes.id))
    .innerJoin(employees, eq(employeeBenefits.employeeId, employees.id))
    .innerJoin(trainees, eq(employees.traineeId, trainees.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(employeeBenefits.appliedAt));
}
