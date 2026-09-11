import "dotenv/config";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import {
  auditEvents,
  consentGrants,
  counsellorCases,
  employees,
  followUpTasks,
  messageJobs,
  outcomeEvents,
  trainees,
  trainingRecords,
} from "../drizzle/schema";

type SeedDb = ReturnType<typeof drizzle>;

const receiptHash = (ref: string, purpose: string) =>
  createHash("sha256").update(`${ref}:${purpose}:skillio-seed`).digest("hex").slice(0, 64);

const d = (iso: string) => new Date(iso);

async function seed(db: SeedDb) {
  console.log("[Seed] Clearing existing domain rows (users are kept)...");
  await db.delete(employees);
  await db.delete(auditEvents);
  await db.delete(counsellorCases);
  await db.delete(messageJobs);
  await db.delete(followUpTasks);
  await db.delete(outcomeEvents);
  await db.delete(trainingRecords);
  await db.delete(consentGrants);
  await db.delete(trainees);

  // Reset id sequences so re-seeds keep the same row ids (e.g. case-3 stays case-3).
  for (const table of [
    "auditEvents",
    "counsellorCases",
    "employees",
    "messageJobs",
    "followUpTasks",
    "outcomeEvents",
    "trainingRecords",
    "consentGrants",
    "trainees",
  ]) {
    await db.execute(
      sql.raw(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), 1, false)`)
    );
  }

  console.log("[Seed] Inserting trainees...");
  const rows = await db
    .insert(trainees)
    .values([
      {
        traineeRef: "SKL-7F4K2M",
        contactPhone: "+919000000001",
        slug: "asha-patil",
        displayName: "Asha Patil",
        initials: "AP",
        district: "Pune",
        provider: "Udyogini Skills Centre",
        course: "Advanced Tailoring & Boutique",
        cohort: "PUN-TLR-24",
        preferredLanguage: "mr",
        outcomeType: "self_employment",
        outcomeLabel: "Self-employed",
        outcomeStatus: "verified",
        wageBand: "₹20k–₹29k",
        relevance: 5,
        retentionDays: 214,
        barrier: "Market access",
        consentStatus: "active",
      },
      {
        traineeRef: "SKL-1D8Q9P",
        contactPhone: "+919000000002",
        slug: "imran-shaikh",
        displayName: "Imran Shaikh",
        initials: "IS",
        district: "Nashik",
        provider: "Maharashtra Electrical Academy",
        course: "Solar PV Technician",
        cohort: "NAS-SOL-24",
        preferredLanguage: "hi",
        outcomeType: "not_working",
        outcomeLabel: "Seeking work",
        outcomeStatus: "self_reported",
        wageBand: null,
        relevance: 4,
        retentionDays: 35,
        barrier: "Transport cost",
        consentStatus: "active",
      },
      {
        traineeRef: "SKL-4M2V8A",
        contactPhone: "+919000000003",
        slug: "sneha-jadhav",
        displayName: "Sneha Jadhav",
        initials: "SJ",
        district: "Nagpur",
        provider: "Vidarbha Digital Futures",
        course: "Data Entry & Office Operations",
        cohort: "NAG-DIG-24",
        preferredLanguage: "mr",
        outcomeType: "formal_employment",
        outcomeLabel: "Employed",
        outcomeStatus: "verified",
        wageBand: "₹10k–₹19k",
        relevance: 2,
        retentionDays: 96,
        barrier: "Role mismatch",
        consentStatus: "active",
      },
      {
        traineeRef: "SKL-8N1T6C",
        contactPhone: "+919000000004",
        slug: "ravi-more",
        displayName: "Ravi More",
        initials: "RM",
        district: "Thane",
        provider: "Maharashtra Electrical Academy",
        course: "Industrial Wiring",
        cohort: "THN-ELE-24",
        preferredLanguage: "mr",
        outcomeType: "formal_employment",
        outcomeLabel: "Employed",
        outcomeStatus: "pending",
        wageBand: "₹20k–₹29k",
        relevance: 4,
        retentionDays: 182,
        barrier: "Stale follow-up",
        consentStatus: "active",
      },
      {
        traineeRef: "SKL-3B6R5H",
        contactPhone: "+919000000005",
        slug: "meena-kale",
        displayName: "Meena Kale",
        initials: "MK",
        district: "Chhatrapati Sambhajinagar",
        provider: "Udyogini Skills Centre",
        course: "Food Processing",
        cohort: "AUR-FOD-24",
        preferredLanguage: "mr",
        outcomeType: "apprenticeship",
        outcomeLabel: "Apprentice",
        outcomeStatus: "self_reported",
        wageBand: "₹10k–₹19k",
        relevance: 4,
        retentionDays: 62,
        barrier: null,
        consentStatus: "active",
      },
      {
        traineeRef: "SKL-9X5L3E",
        contactPhone: "+919000000006",
        slug: "farhan-khan",
        displayName: "Farhan Khan",
        initials: "FK",
        district: "Pune",
        provider: "Pune Mobility Institute",
        course: "EV Service Technician",
        cohort: "PUN-EV-24",
        preferredLanguage: "hi",
        outcomeType: "seeking_work",
        outcomeLabel: "Looking for work",
        outcomeStatus: "self_reported",
        wageBand: null,
        relevance: 3,
        retentionDays: 0,
        barrier: "Interview readiness",
        consentStatus: "active",
      },
    ])
    .returning({ id: trainees.id, traineeRef: trainees.traineeRef });

  const byRef = new Map(rows.map((r) => [r.traineeRef, r.id]));
  const id = (ref: string) => {
    const found = byRef.get(ref);
    if (!found) throw new Error(`Seed bug: missing trainee ${ref}`);
    return found;
  };

  console.log("[Seed] Inserting training records...");
  await db.insert(trainingRecords).values([
    {
      traineeId: id("SKL-7F4K2M"),
      provider: "Udyogini Skills Centre",
      course: "Advanced Tailoring & Boutique",
      cohort: "PUN-TLR-24",
      enrolmentDate: d("2025-10-06"),
      completionDate: d("2026-01-15"),
      attendanceRate: "92.00",
      assessmentScore: "88.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
    {
      traineeId: id("SKL-1D8Q9P"),
      provider: "Maharashtra Electrical Academy",
      course: "Solar PV Technician",
      cohort: "NAS-SOL-24",
      enrolmentDate: d("2025-10-13"),
      completionDate: d("2026-01-10"),
      attendanceRate: "88.00",
      assessmentScore: "84.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
    {
      traineeId: id("SKL-4M2V8A"),
      provider: "Vidarbha Digital Futures",
      course: "Data Entry & Office Operations",
      cohort: "NAG-DIG-24",
      enrolmentDate: d("2026-02-02"),
      completionDate: d("2026-06-01"),
      attendanceRate: "96.00",
      assessmentScore: "90.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
    {
      traineeId: id("SKL-8N1T6C"),
      provider: "Maharashtra Electrical Academy",
      course: "Industrial Wiring",
      cohort: "THN-ELE-24",
      enrolmentDate: d("2025-09-01"),
      completionDate: d("2025-12-12"),
      attendanceRate: "90.00",
      assessmentScore: "82.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
    {
      traineeId: id("SKL-3B6R5H"),
      provider: "Udyogini Skills Centre",
      course: "Food Processing",
      cohort: "AUR-FOD-24",
      enrolmentDate: d("2026-03-02"),
      completionDate: d("2026-06-20"),
      attendanceRate: "94.00",
      assessmentScore: "86.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
    {
      traineeId: id("SKL-9X5L3E"),
      provider: "Pune Mobility Institute",
      course: "EV Service Technician",
      cohort: "PUN-EV-24",
      enrolmentDate: d("2026-01-05"),
      completionDate: d("2026-05-08"),
      attendanceRate: "85.00",
      assessmentScore: "78.00",
      certificationStatus: "certified",
      sourceSystem: "provider_import",
    },
  ]);

  console.log("[Seed] Inserting outcome events (append-only chains)...");
  const [ashaFirst] = await db
    .insert(outcomeEvents)
    .values({
      traineeId: id("SKL-7F4K2M"),
      outcomeType: "self_employment",
      state: "superseded",
      effectiveStartDate: d("2026-02-04"),
      roleCategory: "Home-based tailoring service",
      industry: "Textiles",
      wageBand: "₹10k–₹19k",
      relevanceRating: 5,
      source: "trainee_mobile",
      evidenceConfidence: "0.800",
    })
    .returning({ id: outcomeEvents.id });
  await db.insert(outcomeEvents).values([
    {
      traineeId: id("SKL-7F4K2M"),
      outcomeType: "self_employment",
      state: "active",
      effectiveStartDate: d("2026-07-18"),
      roleCategory: "Home-based tailoring service",
      industry: "Textiles",
      wageBand: "₹20k–₹29k",
      relevanceRating: 5,
      source: "employer_verification",
      evidenceConfidence: "0.950",
      supersedesEventId: ashaFirst.id,
    },
    {
      traineeId: id("SKL-1D8Q9P"),
      outcomeType: "formal_employment",
      state: "ended",
      effectiveStartDate: d("2026-01-22"),
      effectiveEndDate: d("2026-02-26"),
      roleCategory: "Solar installation assistant",
      industry: "Renewable energy",
      wageBand: "₹10k–₹19k",
      relevanceRating: 4,
      source: "trainee_mobile",
      evidenceConfidence: "0.750",
    },
    {
      traineeId: id("SKL-1D8Q9P"),
      outcomeType: "not_working",
      state: "active",
      effectiveStartDate: d("2026-02-26"),
      wageBand: null,
      relevanceRating: 4,
      source: "trainee_mobile",
      evidenceConfidence: "0.750",
    },
    {
      traineeId: id("SKL-4M2V8A"),
      outcomeType: "formal_employment",
      state: "active",
      effectiveStartDate: d("2026-06-08"),
      roleCategory: "Customer support associate",
      industry: "BPO",
      wageBand: "₹10k–₹19k",
      relevanceRating: 2,
      source: "employer_verification",
      evidenceConfidence: "0.900",
    },
    {
      traineeId: id("SKL-8N1T6C"),
      outcomeType: "formal_employment",
      state: "active",
      effectiveStartDate: d("2026-03-13"),
      roleCategory: "Electrician",
      industry: "Electrical services",
      wageBand: "₹20k–₹29k",
      relevanceRating: 4,
      source: "provider_import",
      evidenceConfidence: "0.500",
    },
    {
      traineeId: id("SKL-3B6R5H"),
      outcomeType: "apprenticeship",
      state: "active",
      effectiveStartDate: d("2026-07-11"),
      roleCategory: "Food processing apprentice",
      industry: "Food processing",
      wageBand: "₹10k–₹19k",
      relevanceRating: 4,
      source: "trainee_mobile",
      evidenceConfidence: "0.700",
    },
    {
      traineeId: id("SKL-9X5L3E"),
      outcomeType: "seeking_work",
      state: "active",
      effectiveStartDate: d("2026-05-08"),
      relevanceRating: 3,
      source: "trainee_mobile",
      evidenceConfidence: "0.700",
    },
  ]);

  console.log("[Seed] Inserting employee portal records (verified placements)...");
  await db.insert(employees).values([
    { traineeId: id("SKL-7F4K2M") }, // Asha — verified self-employment
    { traineeId: id("SKL-4M2V8A") }, // Sneha — verified formal employment
  ]);

  console.log("[Seed] Inserting consent grants...");
  await db.insert(consentGrants).values(
    rows.flatMap((row) => [
      {
        traineeId: row.id,
        purposeCode: "outcome_follow_up",
        status: "granted" as const,
        noticeVersion: "v1.2",
        languageCode: "mr",
        channel: "whatsapp",
        grantedAt: d("2026-01-05"),
        receiptHash: receiptHash(row.traineeRef, "outcome_follow_up"),
      },
      {
        traineeId: row.id,
        purposeCode: "employer_verification",
        status: "granted" as const,
        noticeVersion: "v1.2",
        languageCode: "mr",
        channel: "sms",
        grantedAt: d("2026-01-05"),
        receiptHash: receiptHash(row.traineeRef, "employer_verification"),
      },
    ])
  );

  console.log("[Seed] Inserting follow-up tasks and counsellor cases...");
  const taskRows = await db
    .insert(followUpTasks)
    .values([
      {
        traineeId: id("SKL-1D8Q9P"),
        purposeCode: "job_loss_support",
        checkpointCode: "post_loss_7d",
        dueAt: d("2026-09-11T17:00:00"),
        preferredChannel: "whatsapp",
        attemptNumber: 1,
        status: "queued",
        assignedCounsellor: "Neha Kulkarni",
      },
      {
        traineeId: id("SKL-4M2V8A"),
        purposeCode: "relevance_review",
        checkpointCode: "relevance_low",
        dueAt: d("2026-09-12T17:00:00"),
        preferredChannel: "call",
        attemptNumber: 0,
        status: "scheduled",
        assignedCounsellor: "Amit Deshmukh",
      },
      {
        traineeId: id("SKL-8N1T6C"),
        purposeCode: "outcome_follow_up",
        checkpointCode: "verification_pending",
        dueAt: d("2026-09-11T17:00:00"),
        preferredChannel: "sms",
        attemptNumber: 0,
        status: "scheduled",
        assignedCounsellor: "Neha Kulkarni",
      },
      {
        traineeId: id("SKL-9X5L3E"),
        purposeCode: "placement_support",
        checkpointCode: "interview_support",
        dueAt: d("2026-09-16T17:00:00"),
        preferredChannel: "whatsapp",
        attemptNumber: 0,
        status: "scheduled",
        assignedCounsellor: "Meera Joshi",
      },
    ])
    .returning({ id: followUpTasks.id, traineeId: followUpTasks.traineeId });

  await db.insert(counsellorCases).values([
    {
      traineeId: id("SKL-1D8Q9P"),
      priority: "P1",
      title: "Recent job loss",
      reason: "Employment ended after 35 days",
      nextAction: "Connect with nearby solar employers",
      channel: "whatsapp",
      status: "open",
      assignedTo: "Neha Kulkarni",
      dueAt: d("2026-09-11T17:00:00"),
    },
    {
      traineeId: id("SKL-4M2V8A"),
      priority: "P2",
      title: "Low training relevance",
      reason: "Reported relevance score of 2/5",
      nextAction: "Invite course review interview",
      channel: "call",
      status: "open",
      assignedTo: "Amit Deshmukh",
      dueAt: d("2026-09-12T17:00:00"),
    },
    {
      traineeId: id("SKL-8N1T6C"),
      priority: "P2",
      title: "Verification pending",
      reason: "No update in 182 days",
      nextAction: "Send employer verification link",
      channel: "sms",
      status: "open",
      assignedTo: "Neha Kulkarni",
      dueAt: d("2026-09-11T17:00:00"),
    },
    {
      traineeId: id("SKL-9X5L3E"),
      priority: "P3",
      title: "Interview support requested",
      reason: "Looking for work; interview readiness barrier",
      nextAction: "Book mock interview slot",
      channel: "whatsapp",
      status: "open",
      assignedTo: "Meera Joshi",
      dueAt: d("2026-09-16T17:00:00"),
    },
  ]);

  console.log("[Seed] Inserting baseline audit events...");
  await db.insert(auditEvents).values([
    {
      actorType: "system",
      action: "seed.import",
      entityType: "trainee",
      purposeCode: "outcome_follow_up",
      metadata: { note: "Synthetic demo personas seeded", count: rows.length },
    },
    ...taskRows.map((task) => ({
      actorType: "system",
      action: "followup.scheduled",
      entityType: "followUpTask",
      entityId: task.id,
      purposeCode: "outcome_follow_up",
      metadata: { traineeId: task.traineeId },
    })),
  ]);

  console.log(`[Seed] Done. ${rows.length} trainees seeded with journeys, consent, and follow-ups.`);
}

/** Re-seeds the demo personas; safe to run repeatedly (clears domain rows first). */
export async function runSeed() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "[Seed] DATABASE_URL is not set. Add your Supabase connection string to .env first."
    );
  }
  const client = postgres(process.env.DATABASE_URL, { prepare: false });
  const db = drizzle(client);
  try {
    await seed(db);
  } finally {
    await client.end();
  }
}

// `pnpm db:seed` runs this file directly; under vitest it is imported as a library.
if (!process.env.VITEST) {
  runSeed().catch((error) => {
    console.error("[Seed] Failed:", error);
    process.exit(1);
  });
}
