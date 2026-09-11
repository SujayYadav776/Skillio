/**
 * The Verified Career Passport (Theme A / headline feature).
 *
 * A passport is a snapshot of a person's *verified* claims — completed courses
 * from the provider register and employer-confirmed employment — that the person
 * can share as a link or QR code that anyone can validate without an account.
 *
 * Three invariants hold everywhere in this module:
 *  1. Self-reported pulses never enter a passport. Only register-verified
 *     training and employer-confirmed/verified employment do.
 *  2. Nothing is published without a purpose-specific consent grant, and a
 *     withdrawal revokes the passport, its shares and its live links.
 *  3. Every read of a public passport is counted and audited; a content hash
 *     makes a forged or stale page detectable.
 */
import { and, desc, eq, isNotNull, isNull, lte } from "drizzle-orm";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";
import {
  consentGrants,
  oneTimeTokens,
  outcomeEvents,
  passportEntries,
  passportShares,
  passports,
  trainees,
  trainingRecords,
} from "../drizzle/schema";
import {
  InputValidationError,
  NOTICE_VERSION,
  NotFoundError,
  recordAudit,
  requireDb,
  resolveEmployeeFromToken,
  signPurposeToken,
  verifyPurposeToken,
  type DbOrTx,
} from "./queries";

export const PASSPORT_SHARE_PURPOSE = "passport_share";
const PASSPORT_PUBLIC_PURPOSE_CODE = "passport_public";
const PASSPORT_SHARE_PURPOSE_CODE = "credential_share";
const MIN_SHARE_TTL_DAYS = 1;
const MAX_SHARE_TTL_DAYS = 365;

export type PassportEntryInput = {
  kind: "training" | "employment" | "skill";
  title: string;
  subtitle: string | null;
  startDate: Date | null;
  endDate: Date | null;
  district: string | null;
  roleCategory: string | null;
  industry: string | null;
  wageBand: string | null;
  evidenceLevel: "self_reported" | "employer_confirmed" | "verified";
  source: string;
  sourceId: number | null;
  displayOrder: number;
};

/**
 * Canonical hash over the entry set. Titles, dates and evidence levels are
 * included; display order is not, so re-ordering never invalidates a passport.
 */
export function canonicalEntryHash(entries: PassportEntryInput[]): string {
  const canonical = entries
    .map((entry) =>
      [
        entry.kind,
        entry.title,
        entry.subtitle ?? "",
        entry.startDate ? entry.startDate.toISOString() : "",
        entry.endDate ? entry.endDate.toISOString() : "",
        entry.district ?? "",
        entry.roleCategory ?? "",
        entry.evidenceLevel,
        entry.source,
      ].join("|")
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 64);
}

/**
 * Builds the entry set for a trainee from verified sources only:
 *  - completed training from the provider register;
 *  - employment claims carrying employer verification;
 *  - one skill entry per completed course (the skills the course confers).
 */
export async function buildPassportEntries(
  handle: DbOrTx,
  traineeId: number
): Promise<{ entries: PassportEntryInput[]; verifiedTenureDays: number; headlineRole: string | null; headlineIndustry: string | null }> {
  const [trainee] = await handle
    .select()
    .from(trainees)
    .where(eq(trainees.id, traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(traineeId));

  const [records, events] = await Promise.all([
    handle
      .select()
      .from(trainingRecords)
      .where(and(eq(trainingRecords.traineeId, traineeId), isNotNull(trainingRecords.completionDate))),
    handle
      .select()
      .from(outcomeEvents)
      .where(eq(outcomeEvents.traineeId, traineeId)),
  ]);

  const entries: PassportEntryInput[] = [];
  let order = 0;

  for (const record of records) {
    const certified = record.certificationStatus === "certified";
    entries.push({
      kind: "training",
      title: record.course,
      subtitle: [record.provider, record.cohort ? `cohort ${record.cohort}` : null]
        .filter(Boolean)
        .join(" · "),
      startDate: record.enrolmentDate,
      endDate: record.completionDate,
      district: trainee.district,
      roleCategory: null,
      industry: null,
      wageBand: null,
      // The provider register is the system of record for completion.
      evidenceLevel: certified ? "verified" : "employer_confirmed",
      source: "training_register",
      sourceId: record.id,
      displayOrder: order++,
    });
    entries.push({
      kind: "skill",
      title: record.course,
      subtitle: certified ? "Certified skill" : "Course skill",
      startDate: null,
      endDate: record.completionDate,
      district: null,
      roleCategory: null,
      industry: null,
      wageBand: null,
      evidenceLevel: certified ? "verified" : "employer_confirmed",
      source: "training_register",
      sourceId: record.id,
      displayOrder: order++,
    });
  }

  // Only employer-verified employment enters the passport; self-reported pulses
  // never do — that is the whole point of the document.
  const verifiedEmployment = events
    .filter(
      (event) =>
        event.source === "employer_verification" &&
        ["formal_employment", "self_employment", "apprenticeship"].includes(event.outcomeType)
    )
    .sort(
      (a, b) =>
        (a.effectiveStartDate?.getTime() ?? 0) - (b.effectiveStartDate?.getTime() ?? 0)
    );

  let verifiedTenureDays = 0;
  const now = Date.now();
  for (const event of verifiedEmployment) {
    const start = event.effectiveStartDate?.getTime() ?? event.createdAt.getTime();
    const end = event.effectiveEndDate?.getTime() ?? now;
    verifiedTenureDays += Math.max(0, Math.round((end - start) / 86_400_000));
    entries.push({
      kind: "employment",
      title: event.roleCategory ?? trainee.outcomeLabel,
      subtitle: event.industry,
      startDate: event.effectiveStartDate ?? event.createdAt,
      endDate: event.effectiveEndDate,
      district: trainee.district,
      roleCategory: event.roleCategory,
      industry: event.industry,
      wageBand: event.wageBand,
      evidenceLevel: event.state === "active" ? "verified" : "employer_confirmed",
      source: "employer_verification",
      sourceId: event.id,
      displayOrder: order++,
    });
  }

  const latest = verifiedEmployment[verifiedEmployment.length - 1];
  return {
    entries,
    verifiedTenureDays,
    headlineRole: latest?.roleCategory ?? null,
    headlineIndustry: latest?.industry ?? null,
  };
}

/** First passport publish captures its own purpose-specific consent receipt. */
async function ensurePassportConsent(
  handle: DbOrTx,
  trainee: { id: number; traineeRef: string; preferredLanguage: string }
) {
  const [existing] = await handle
    .select({ id: consentGrants.id })
    .from(consentGrants)
    .where(
      and(
        eq(consentGrants.traineeId, trainee.id),
        eq(consentGrants.purposeCode, PASSPORT_PUBLIC_PURPOSE_CODE),
        eq(consentGrants.status, "granted")
      )
    )
    .limit(1);
  if (existing) return;

  const grantedAt = new Date();
  await handle.insert(consentGrants).values({
    traineeId: trainee.id,
    purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
    status: "granted",
    noticeVersion: NOTICE_VERSION,
    languageCode: trainee.preferredLanguage,
    channel: "portal",
    grantedAt,
    receiptHash: createHash("sha256")
      .update(`${trainee.traineeRef}:${PASSPORT_PUBLIC_PURPOSE_CODE}:grant:${grantedAt.toISOString()}`)
      .digest("hex")
      .slice(0, 64),
  });
  await handle.insert(consentGrants).values({
    traineeId: trainee.id,
    purposeCode: PASSPORT_SHARE_PURPOSE_CODE,
    status: "granted",
    noticeVersion: NOTICE_VERSION,
    languageCode: trainee.preferredLanguage,
    channel: "portal",
    grantedAt,
    receiptHash: createHash("sha256")
      .update(`${trainee.traineeRef}:${PASSPORT_SHARE_PURPOSE_CODE}:grant:${grantedAt.toISOString()}`)
      .digest("hex")
      .slice(0, 64),
  });
  await recordAudit(handle, {
    actorType: "employee",
    action: "consent.granted",
    entityType: "trainee",
    entityId: trainee.id,
    purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
    metadata: { noticeVersion: NOTICE_VERSION, channel: "portal" },
  });
}

/** Recomputes and stores the content hash for a passport; returns the hash. */
async function refreshPassportContent(
  handle: DbOrTx,
  passportId: number,
  traineeId: number,
  sharing: { shareWageBands: boolean; shareEmployerNames: boolean }
) {
  const built = await buildPassportEntries(handle, traineeId);
  await handle.delete(passportEntries).where(eq(passportEntries.passportId, passportId));
  if (built.entries.length > 0) {
    await handle.insert(passportEntries).values(
      built.entries.map((entry) => ({ ...entry, passportId }))
    );
  }
  const contentHash = canonicalEntryHash(built.entries);
  await handle
    .update(passports)
    .set({
      contentHash,
      verifiedTenureDays: built.verifiedTenureDays,
      headlineRole: built.headlineRole,
      headlineIndustry: built.headlineIndustry,
      shareWageBands: sharing.shareWageBands,
      shareEmployerNames: sharing.shareEmployerNames,
      updatedAt: new Date(),
    })
    .where(eq(passports.id, passportId));
  return { contentHash, entryCount: built.entries.length };
}

// ---------------------------------------------------------------------------
// Employee-facing operations (the portal link is the session)
// ---------------------------------------------------------------------------

export async function getEmployeePassport(input: { token: string }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);

  const [passport] = await db
    .select()
    .from(passports)
    .where(eq(passports.traineeId, employee.traineeId))
    .limit(1);

  if (!passport) {
    // Not published yet: show what *would* be published so the choice is informed.
    const built = await buildPassportEntries(db, employee.traineeId);
    return {
      passport: null,
      preview: built.entries.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        subtitle: entry.subtitle,
        evidenceLevel: entry.evidenceLevel,
      })),
      shares: [],
    };
  }

  const [entries, shares] = await Promise.all([
    db
      .select()
      .from(passportEntries)
      .where(eq(passportEntries.passportId, passport.id))
      .orderBy(passportEntries.displayOrder),
    db
      .select()
      .from(passportShares)
      .where(eq(passportShares.passportId, passport.id))
      .orderBy(desc(passportShares.createdAt)),
  ]);

  return {
    passport: {
      publicId: passport.publicId,
      status: passport.status,
      publishedAt: passport.publishedAt ? passport.publishedAt.toISOString() : null,
      revokedAt: passport.revokedAt ? passport.revokedAt.toISOString() : null,
      revokeReason: passport.revokeReason,
      verifiedTenureDays: passport.verifiedTenureDays,
      shareWageBands: passport.shareWageBands,
      shareEmployerNames: passport.shareEmployerNames,
      contentHash: passport.contentHash,
      url: `/passport/${passport.publicId}`,
    },
    preview: entries.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      evidenceLevel: entry.evidenceLevel,
    })),
    shares: shares.map((share) => ({
      id: share.id,
      recipientLabel: share.recipientLabel,
      scope: share.scope,
      viewCount: share.viewCount,
      lastViewedAt: share.lastViewedAt ? share.lastViewedAt.toISOString() : null,
      expiresAt: share.expiresAt.toISOString(),
      revokedAt: share.revokedAt ? share.revokedAt.toISOString() : null,
      live: !share.revokedAt && share.expiresAt.getTime() > Date.now(),
    })),
  };
}

export async function publishPassport(input: {
  token: string;
  shareWageBands?: boolean;
  shareEmployerNames?: boolean;
}) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [trainee] = await db
    .select()
    .from(trainees)
    .where(eq(trainees.id, employee.traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", String(employee.traineeId));

  return db.transaction(async (tx) => {
    await ensurePassportConsent(tx, {
      id: trainee.id,
      traineeRef: trainee.traineeRef,
      preferredLanguage: trainee.preferredLanguage,
    });

    const [existing] = await tx
      .select()
      .from(passports)
      .where(eq(passports.traineeId, trainee.id))
      .limit(1);

    const shareWageBands = input.shareWageBands ?? existing?.shareWageBands ?? false;
    const shareEmployerNames = input.shareEmployerNames ?? existing?.shareEmployerNames ?? false;

    const passportId =
      existing?.id ??
      (
        await tx
          .insert(passports)
          .values({
            traineeId: trainee.id,
            publicId: nanoid(16),
            district: trainee.district,
          })
          .returning({ id: passports.id })
      )[0].id;

    const { contentHash, entryCount } = await refreshPassportContent(tx, passportId, trainee.id, {
      shareWageBands,
      shareEmployerNames,
    });

    await tx
      .update(passports)
      .set({ status: "published", publishedAt: new Date(), revokedAt: null, revokeReason: null })
      .where(eq(passports.id, passportId));

    await recordAudit(tx, {
      actorType: "employee",
      actorId: trainee.id,
      action: existing ? "passport.republished" : "passport.published",
      entityType: "passport",
      entityId: passportId,
      purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
      metadata: { entryCount, contentHash, shareWageBands, shareEmployerNames },
    });

    const [passport] = await tx
      .select({ publicId: passports.publicId })
      .from(passports)
      .where(eq(passports.id, passportId))
      .limit(1);

    return {
      publicId: passport.publicId,
      url: `/passport/${passport.publicId}`,
      entryCount,
      contentHash,
    };
  });
}

export async function createPassportShare(input: {
  token: string;
  recipientLabel?: string | null;
  scope?: "summary" | "full";
  ttlDays?: number;
}) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [passport] = await db
    .select()
    .from(passports)
    .where(eq(passports.traineeId, employee.traineeId))
    .limit(1);
  if (!passport) throw new NotFoundError("Passport", "not published");
  if (passport.status !== "published") {
    throw new InputValidationError("Publish the passport before creating share links.");
  }

  const ttlDays = Math.min(
    MAX_SHARE_TTL_DAYS,
    Math.max(MIN_SHARE_TTL_DAYS, input.ttlDays ?? 30)
  );
  const scope = input.scope ?? "summary";
  const { token, jti, expiresAt } = await signPurposeToken({
    purpose: PASSPORT_SHARE_PURPOSE,
    claims: { publicId: passport.publicId, scope },
    ttlDays,
  });

  const [share] = await db
    .insert(passportShares)
    .values({
      passportId: passport.id,
      jti,
      recipientLabel: input.recipientLabel?.slice(0, 120) ?? null,
      scope,
      expiresAt,
    })
    .returning({ id: passportShares.id });

  await recordAudit(db, {
    actorType: "employee",
    actorId: employee.traineeId,
    action: "passport.share_created",
    entityType: "passportShare",
    entityId: share.id,
    purposeCode: PASSPORT_SHARE_PURPOSE_CODE,
    metadata: { scope, expiresAt: expiresAt.toISOString(), recipientLabel: input.recipientLabel ?? null },
  });

  return { shareId: share.id, url: `/passport/${passport.publicId}?share=${token}`, scope, expiresAt };
}

export async function revokePassportShare(input: { token: string; shareId: number }) {
  const db = await requireDb();
  const employee = await resolveEmployeeFromToken(input.token);
  const [passport] = await db
    .select({ id: passports.id })
    .from(passports)
    .where(eq(passports.traineeId, employee.traineeId))
    .limit(1);
  if (!passport) throw new NotFoundError("Passport", "not published");

  const revoked = await db
    .update(passportShares)
    .set({ revokedAt: new Date() })
    .where(and(eq(passportShares.id, input.shareId), eq(passportShares.passportId, passport.id)))
    .returning({ id: passportShares.id });
  if (revoked.length === 0) throw new NotFoundError("Passport share", String(input.shareId));

  await recordAudit(db, {
    actorType: "employee",
    actorId: employee.traineeId,
    action: "passport.share_revoked",
    entityType: "passportShare",
    entityId: input.shareId,
    purposeCode: PASSPORT_SHARE_PURPOSE_CODE,
  });
  return { revoked: true as const };
}

// ---------------------------------------------------------------------------
// Public verification surface
// ---------------------------------------------------------------------------

function shapePublicEntries(
  entries: Array<{
    kind: "training" | "employment" | "skill";
    title: string;
    subtitle: string | null;
    startDate: Date | null;
    endDate: Date | null;
    roleCategory: string | null;
    industry: string | null;
    wageBand: string | null;
    evidenceLevel: "self_reported" | "employer_confirmed" | "verified";
    source: string;
  }>,
  options: { revealWageBands: boolean; revealEmployerNames: boolean }
) {
  return entries.map((entry) => ({
    kind: entry.kind,
    title: entry.title,
    // Employer names are opt-in, so the subtitle is only revealed for
    // employment entries when the holder chose to share them.
    subtitle:
      entry.kind === "employment" && !options.revealEmployerNames ? null : entry.subtitle,
    startDate: entry.startDate ? entry.startDate.toISOString() : null,
    endDate: entry.endDate ? entry.endDate.toISOString() : null,
    roleCategory: entry.roleCategory,
    industry: entry.industry,
    wageBand: options.revealWageBands ? entry.wageBand : null,
    evidenceLevel: entry.evidenceLevel,
    source: entry.source,
  }));
}

/**
 * Public read. A tampered or forged share token degrades to the summary scope
 * rather than erroring, so a holder can still prove who they are. A revoked
 * passport returns a tombstone — never stale claims.
 */
export async function getPublicPassport(input: { publicId: string; shareToken?: string | null }) {
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(passports)
    .where(eq(passports.publicId, input.publicId))
    .limit(1);
  if (!row) throw new NotFoundError("Passport", input.publicId);

  const [trainee] = await db
    .select()
    .from(trainees)
    .where(eq(trainees.id, row.traineeId))
    .limit(1);
  if (!trainee) throw new NotFoundError("Passport holder", String(row.traineeId));

  if (row.status === "revoked") {
    return {
      status: "revoked" as const,
      publicId: row.publicId,
      revokedAt: row.revokedAt ? row.revokedAt.toISOString() : null,
      reason: row.revokeReason,
      holder: { name: trainee.displayName, district: trainee.district },
    };
  }
  if (row.status !== "published") {
    throw new NotFoundError("Passport", "not published");
  }

  // Resolve the optional share token: signature first, then the persisted row.
  let share: { id: number; scope: "summary" | "full" } | null = null;
  if (input.shareToken) {
    try {
      const { jti, payload } = await verifyPurposeToken(input.shareToken, PASSPORT_SHARE_PURPOSE);
      if (payload.publicId !== row.publicId) throw new Error("share does not belong to this passport");
      const [shareRow] = await db
        .select()
        .from(passportShares)
        .where(and(eq(passportShares.jti, jti), eq(passportShares.passportId, row.id)))
        .limit(1);
      if (shareRow && !shareRow.revokedAt && shareRow.expiresAt.getTime() > Date.now()) {
        share = { id: shareRow.id, scope: shareRow.scope };
        await db
          .update(passportShares)
          .set({ viewCount: shareRow.viewCount + 1, lastViewedAt: new Date() })
          .where(eq(passportShares.id, shareRow.id));
      }
    } catch {
      share = null;
    }
  }

  const entries = await db
    .select()
    .from(passportEntries)
    .where(eq(passportEntries.passportId, row.id))
    .orderBy(passportEntries.displayOrder);

  const integrityNow = canonicalEntryHash(
    entries.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      startDate: entry.startDate,
      endDate: entry.endDate,
      district: entry.district,
      roleCategory: entry.roleCategory,
      industry: entry.industry,
      wageBand: entry.wageBand,
      evidenceLevel: entry.evidenceLevel,
      source: entry.source,
      sourceId: entry.sourceId,
      displayOrder: entry.displayOrder,
    }))
  );
  const integrityVerified = integrityNow === row.contentHash;

  await recordAudit(db, {
    actorType: "employer",
    action: "passport.viewed",
    entityType: "passport",
    entityId: row.id,
    purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
    metadata: { scope: share?.scope ?? "summary", integrityVerified },
  });

  const revealWageBands = row.shareWageBands && share?.scope === "full";
  const revealEmployerNames = row.shareEmployerNames && share?.scope === "full";

  return {
    status: "published" as const,
    publicId: row.publicId,
    holder: {
      name: trainee.displayName,
      district: trainee.district,
      headlineRole: row.headlineRole,
      headlineIndustry: row.headlineIndustry,
      verifiedTenureDays: row.verifiedTenureDays,
      publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    },
    entries: shapePublicEntries(entries, {
      revealWageBands: Boolean(revealWageBands),
      revealEmployerNames,
    }),
    integrity: {
      contentHash: row.contentHash,
      verified: integrityVerified,
      checkedAt: new Date().toISOString(),
    },
    share: share ? { scope: share.scope } : null,
    scope: share?.scope ?? "summary",
  };
}

/** Standalone integrity check, so a verifier can re-run it on demand. */
export async function verifyPassportIntegrity(input: { publicId: string }) {
  const db = await requireDb();
  const [row] = await db
    .select()
    .from(passports)
    .where(eq(passports.publicId, input.publicId))
    .limit(1);
  if (!row) throw new NotFoundError("Passport", input.publicId);

  const entries = await db
    .select()
    .from(passportEntries)
    .where(eq(passportEntries.passportId, row.id));

  const recomputed = canonicalEntryHash(
    entries.map((entry) => ({
      kind: entry.kind,
      title: entry.title,
      subtitle: entry.subtitle,
      startDate: entry.startDate,
      endDate: entry.endDate,
      district: entry.district,
      roleCategory: entry.roleCategory,
      industry: entry.industry,
      wageBand: entry.wageBand,
      evidenceLevel: entry.evidenceLevel,
      source: entry.source,
      sourceId: entry.sourceId,
      displayOrder: entry.displayOrder,
    }))
  );
  return {
    publicId: row.publicId,
    stored: row.contentHash,
    recomputed,
    verified: recomputed === row.contentHash,
  };
}

// ---------------------------------------------------------------------------
// Staff controls and scheduled workers
// ---------------------------------------------------------------------------

/** Staff kill-switch: revokes the passport and every live share of it. */
export async function revokePassportForTrainee(input: { traineeRef: string; reason: string }) {
  const db = await requireDb();
  const [trainee] = await db
    .select({ id: trainees.id, traineeRef: trainees.traineeRef })
    .from(trainees)
    .where(eq(trainees.traineeRef, input.traineeRef))
    .limit(1);
  if (!trainee) throw new NotFoundError("Trainee", input.traineeRef);

  return db.transaction(async (tx) => {
    const [passport] = await tx
      .select()
      .from(passports)
      .where(eq(passports.traineeId, trainee.id))
      .limit(1);
    if (!passport) throw new NotFoundError("Passport", input.traineeRef);

    await tx
      .update(passports)
      .set({ status: "revoked", revokedAt: new Date(), revokeReason: input.reason.slice(0, 200) })
      .where(eq(passports.id, passport.id));

    const revokedShares = await tx
      .update(passportShares)
      .set({ revokedAt: new Date() })
      .where(and(eq(passportShares.passportId, passport.id), isNull(passportShares.revokedAt)))
      .returning({ id: passportShares.id });

    // Live share JWTs are neutralised at the same time as the rows.
    await tx
      .update(oneTimeTokens)
      .set({ usedAt: new Date() })
      .where(
        and(
          eq(oneTimeTokens.traineeId, passport.traineeId),
          eq(oneTimeTokens.purpose, PASSPORT_SHARE_PURPOSE),
          isNull(oneTimeTokens.usedAt)
        )
      );

    await recordAudit(tx, {
      actorType: "staff",
      action: "passport.revoked",
      entityType: "passport",
      entityId: passport.id,
      purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
      metadata: { reason: input.reason, revokedShares: revokedShares.length },
    });

    return { publicId: passport.publicId, revokedShares: revokedShares.length };
  });
}

/**
 * Consent withdrawal hook: any withdrawal revokes the passport, because a
 * passport's whole purpose is public sharing under a granted consent.
 */
export async function revokePassportOnConsentWithdrawal(traineeId: number, purposeCode: string) {
  if (purposeCode !== PASSPORT_PUBLIC_PURPOSE_CODE && purposeCode !== PASSPORT_SHARE_PURPOSE_CODE) {
    return { revoked: false as const };
  }
  const db = await requireDb();
  const [trainee] = await db
    .select({ traineeRef: trainees.traineeRef })
    .from(trainees)
    .where(eq(trainees.id, traineeId))
    .limit(1);
  if (!trainee) return { revoked: false as const };

  await revokePassportForTrainee({
    traineeRef: trainee.traineeRef,
    reason: `Consent withdrawn for ${purposeCode}`,
  });
  return { revoked: true as const };
}

/** Scheduler worker: expires old share rows (the JWT expiry is the real guard). */
export async function purgeExpiredPassportShares(now = new Date()) {
  const db = await requireDb();
  const purged = await db
    .delete(passportShares)
    .where(lte(passportShares.expiresAt, new Date(now.getTime() - 90 * 86_400_000)))
    .returning({ id: passportShares.id });
  return { purged: purged.length };
}

/**
 * Scheduler worker: keeps published passports in step with the append-only
 * evidence. Only passports whose holder data changed are rebuilt, and the
 * rebuilt set is hashed anew so integrity checks keep passing.
 */
export async function refreshPublishedPassports() {
  const db = await requireDb();
  const rows = await db
    .select({
      passportId: passports.id,
      traineeId: passports.traineeId,
      shareWageBands: passports.shareWageBands,
      shareEmployerNames: passports.shareEmployerNames,
      updatedAt: passports.updatedAt,
      lastUpdated: trainees.lastUpdated,
      publicId: passports.publicId,
    })
    .from(passports)
    .innerJoin(trainees, eq(passports.traineeId, trainees.id))
    .where(eq(passports.status, "published"));

  let refreshed = 0;
  for (const row of rows) {
    if (row.lastUpdated.getTime() <= row.updatedAt.getTime()) continue;
    await refreshPassportContent(db, row.passportId, row.traineeId, {
      shareWageBands: row.shareWageBands,
      shareEmployerNames: row.shareEmployerNames,
    });
    await recordAudit(db, {
      actorType: "system",
      action: "passport.refreshed",
      entityType: "passport",
      entityId: row.passportId,
      purposeCode: PASSPORT_PUBLIC_PURPOSE_CODE,
      metadata: { publicId: row.publicId },
    });
    refreshed += 1;
  }
  return { refreshed };
}
