/**
 * Defence-in-depth (Theme F): enables Postgres Row-Level Security on every
 * domain table with no policies, so direct PostgREST access by `anon` or an
 * `authenticated` role is denied by default.
 *
 * The application connects as the postgres/service role, which bypasses RLS, so
 * this does not affect the app or the integration tests. It closes the door on
 * anyone holding only the publishable anon key.
 *
 * Run with `pnpm db:rls` (idempotent — safe to re-run).
 */
import "dotenv/config";
import postgres from "postgres";

const TABLES = [
  "users",
  "trainees",
  "consentGrants",
  "trainingRecords",
  "outcomeEvents",
  "followUpTasks",
  "messageJobs",
  "counsellorCases",
  "caseMessages",
  "auditEvents",
  "oneTimeTokens",
  "employees",
  "employeeDocuments",
  "employeeBenefits",
  "benefitSchemes",
  "passports",
  "passportEntries",
  "passportShares",
  "employers",
  "jobPostings",
  "jobApplications",
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required to apply RLS policies");

  const client = postgres(connectionString, { prepare: false });
  try {
    for (const table of TABLES) {
      // CREATE POLICY ... IF NOT EXISTS is not supported; guard by catalog lookup.
      const existing = await client`
        select 1 from pg_tables
        where tablename = ${table} and rowsecurity = true
      `;
      await client.unsafe(`alter table "${table}" enable row level security`);
      console.log(
        existing.length > 0
          ? `[RLS] ${table}: already protected`
          : `[RLS] ${table}: row level security enabled (deny-by-default)`
      );
    }
    console.log("[RLS] Done. The app's service-role connection is unaffected.");
  } finally {
    await client.end();
  }
}

if (!process.env.VITEST) {
  main().catch((error) => {
    console.error("[RLS] Failed:", error);
    process.exit(1);
  });
}
