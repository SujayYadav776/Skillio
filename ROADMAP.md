# Skillio — Build Checklist

> 🕐 **Last updated: 2026-09-12** · DB is **LIVE** on Supabase (project `nrxbelpmydquivcphxry`, ap-northeast-2) · 🎉 **Phases 0–5 COMPLETE** · ▶️ **Phase 6 — Employee System: A1 + A2 + A3 + A4 done** · ✅ **Suite now 113/113 passing** · Next-phase backlog: [RECOMMENDATION.md](RECOMMENDATION.md)

## 📊 Progress at a glance

| Phase | Progress | Status |
|---|---|---|
| **0 · Foundations** | 10 / 11 | 🟢 **DONE** — one optional item left |
| **1 · Query layer** | 15 / 15 | 🟢 **DONE** |
| **2 · DB-backed API** | 8 / 8 | 🟢 **DONE** |
| **3 · Pages onto tRPC** | 8 / 8 | 🟢 **DONE** — verified in-browser |
| **4 · Real flows** | 6 / 6 | 🟢 **DONE** — verified live end-to-end |
| **5 · Hardening** | 4 / 4 | 🟢 **DONE** — 59/59 tests, login verified in-browser |

Legend: ✅ = done · ⬜ = not started · 🔵 = next up · 🟡 = partially blocked

---

## 🟢 Phase 0 — Environment and foundations

**Decision: Supabase for database + auth.** Drizzle moved from MySQL dialect to `pg-core`; driver is `postgres` (postgres-js, `prepare: false` for Supabase's PgBouncer pooler); Supabase Auth replaced the Manus OAuth scaffold.

- [x] ✅ Schema rewritten to Postgres (`drizzle/schema.ts`): pgEnum types, jsonb, timezone-aware timestamps, FK references + indexes; `users.openId` stores the Supabase auth user id
- [x] ✅ `server/db.ts` on postgres-js with `onConflictDoUpdate`; `drizzle.config.ts` → `dialect: "postgresql"`, migrations in `drizzle/migrations/`
- [x] ✅ Windows-safe scripts (`cross-env`) + `db:generate` / `db:seed` scripts
- [x] ✅ Supabase auth scaffolding: `server/_core/supabaseAuth.ts` (JWKS JWT verification from `Authorization: Bearer` or `sb-access-token` cookie, mirrors users into the DB), wired into tRPC context
- [x] ✅ Seed script `server/seed.ts` (`pnpm db:seed`): all 6 demo personas — training records, append-only outcome chains (incl. Imran's placement → job-loss supersede chain), consent grants with receipt hashes, follow-up tasks, counsellor cases, audit events
- [x] ✅ Fresh migration generated (`drizzle/migrations/0000_greedy_mandarin.sql`, includes `trainees.slug`)
- [x] ✅ Login flow wired end-to-end: `/login` page (email + password), tRPC client sends the Supabase access token as Bearer, `useAuth` reacts to session changes, 401 → `/login?next=…`; Manus OAuth scaffold deleted (`oauth.ts`, `sdk.ts`, OAuth constants)
- [x] ✅ Verified: `pnpm check`, `pnpm test`, dev server boots, `GET /` 200, `auth.me` 200
- [x] ✅ `.env` filled via browser (2026-09-11): existing project `nrxbelpmydquivcphxry` (ap-northeast-2), new-format publishable/secret keys, DB password reset; `DATABASE_URL` is the port-6543 pooled string
- [x] ✅ `pnpm db:push` applied the migration (PostgreSQL 17.6, 9 tables) and `pnpm db:seed` loaded the personas — verified row counts (6 trainees, 8 outcome events, 12 consent grants, 4 tasks, 4 cases, 5 audit events); live probes: `outcomes.summary` returns real aggregates, `trainees?query=asha` works, `traineeJourney` builds Imran's timeline from DB rows, `sendMessage` wrote a `messageJobs` row and marked its task sent

**Optional leftovers:**

- [x] ✅ Staff user created (2026-09-11): `admin@skillio.test` / `SkillioDemo2026!` (demo-only credential) via the Supabase admin API, pre-promoted to `admin` in the local `users` table; sign-in verified in the browser — login → dashboard with live data

---

## 🟢 Phase 1 — Domain query layer

Lives in `server/queries.ts`; `server/db.ts` keeps only connection + user mirroring.

- [x] ✅ `getDashboardSummary()` — SQL `GROUP BY` district rollup + outcome mix; JS-computed retention/wage series from event chains
- [x] ✅ `listTrainees({ district, query })` — ILIKE search over name/course/provider
- [x] ✅ `getTraineeJourney(slug)` — trainee + records + ordered append-only events + consent + tasks + cases
- [x] ✅ `listFollowUpQueue()` — cases joined with trainees, P1→P4 then due-date ordering
- [x] ✅ `listSkillGaps()` — barrier × district aggregation with windowed total
- [x] ✅ `getConsentStatus(slug)`
- [x] ✅ `createOutcomeEvent` — append-only: supersedes the active event, closes its end date, refreshes the trainee row
- [x] ✅ `scheduleFollowUp`
- [x] ✅ `recordMessageJob` — idempotency-key dedupe
- [x] ✅ `submitTraineeResponse` — one transaction: event + task closure + consent handling + audit
- [x] ✅ `withdrawConsent` — grants withdrawn, future tasks cancelled, trainee flagged, audit row
- [x] ✅ `getCounsellorCaseById` + `sendManualOutreach` (reuses/schedules task, idempotent message job per case per day, audit)
- [x] ✅ `trainees.slug` column added (public URLs keep `/trainees/asha-patil` form); seed updated; migration regenerated
- [x] ✅ Typed errors: `DatabaseNotConfiguredError`, `NotFoundError`
- [x] ✅ Unit tests for pure helpers: `wageBandMidpoint`, `outcomeLabelFor`, `buildTimeline` (an "ended" employment row emits both placement and end milestones)

---

## 🟢 Phase 2 — Wire tRPC routers to the database

- [x] ✅ `server/routers.ts` — zero demo imports; every procedure DB-backed
- [x] ✅ `followUps.sendDemoMessage` → `followUps.sendMessage` (real manual-outreach flow; calls logged without a message job)
- [x] ✅ `server/mappers.ts` shape bridge: DB rows → exact demo shapes the screens consume (`Trainee`, `FollowUpCase`, `SkillGap`, dashboard metric strings, "Today, 09:42" date labels) so Phase 3 page swaps are import-swaps
- [x] ✅ Skill-gap playbook: barrier → action/owner mapping; severity from affected share (≥30% High, ≥15% Medium, else Watch); `FollowUpCase.priority` widened to P4
- [x] ✅ Error mapping: `runDb` wrapper — `PRECONDITION_FAILED` (412) / `NOT_FOUND`; zod rejects malformed case ids and outcome types with `BAD_REQUEST`; verified live (`outcomes.summary` → 412, `auth.me` → null)
- [x] ✅ Procedures stay `publicProcedure` during the demo phase (roles in Phase 5)
- [x] ✅ Tests: 24 passing — router caller tests, mapper unit tests, pure query-helper tests, auth tests
- [x] ✅ Router integration tests against the seeded Supabase DB (`routers.integration.test.ts`, 11 tests): reads + mutations verified live, re-seeds before/after, auto-skips without `DATABASE_URL`; suite now 35/35 passing. Seed gained `runSeed()` export + id-sequence resets (`case-3` stays stable across re-seeds)

---

## 🟢 Phase 3 — Move the pages onto tRPC — **DONE (2026-09-11)**

All seven screens now render from the live database; zero `@shared/demoData` imports remain in `client/src`. Verified visually in the browser (SkillGaps, CommandCentre, TraineeJourney, FollowUps) plus 35/35 tests passing.

- [x] ✅ SkillGaps → `outcomes.skillGaps` (stat cards now derive from real signal counts)
- [x] ✅ Cohorts → new `outcomes.cohorts` procedure (per-cohort SQL aggregates: completions, verified %, 90d retention, avg relevance, modal barrier, follow-up coverage via left-join subquery); trainee links resolved through `outcomes.trainees`; stat cards derived from data
- [x] ✅ CommandCentre → `outcomes.summary` extended with `outcomeMix`, `retentionSeries`, `wageSeries` in demo shapes; fabricated period-over-period deltas removed; retention chart axis rescaled to real 0–100% data; "working %" pie label computed from the mix
- [x] ✅ TraineeJourney → `outcomes.traineeJourney` with loading / NOT_FOUND / error states; consent toggle now calls `consent.withdraw` for real and invalidates the journey (re-consent correctly requires the trainee)
- [x] ✅ FollowUps → `followUps.queue` + `sendMessage` mutation with sonner toasts; new `followUps.activity` procedure replaces the fabricated message history with real `messageJobs` rows; stat cards + tab counts derived from the queue
- [x] ✅ MobileFollowUp → reads `?trainee=<slug>`, greets the real trainee, submits through `followUps.submitResponse` (option → outcomeType mapping, wage bands → DB vocabulary; consent opt-out honoured)
- [x] ✅ EmployerVerification → new `verification.submit` procedure: employer confirmation appends a **verified** outcome event + audit row; "No / not sure" downgrades evidence to pending without touching history; reads `?ref=<traineeRef>`
- [x] ✅ `shared/demoData.ts` is now used only by the seed script and server type imports

---

## 🟢 Phase 4 — Real flows and integrations — **DONE (2026-09-11)**

46/46 tests passing; send → webhook delivery verified live against the running server.

- [x] ✅ `MessagingProvider` adapter (`server/messaging/`): business logic only talks to the interface; **ConsoleProvider** logs + derives deterministic ids from idempotency keys
- [x] ✅ **WhatsApp Cloud API provider** (`whatsapp.ts`) behind `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` env flags; template messages only; provider selection automatic
- [x] ✅ **Signed webhook receiver** (`/api/webhooks/whatsapp`): GET subscription handshake + POST with `X-Hub-Signature-256` HMAC verification (or shared token fallback); handles delivery statuses (`messageJobs` updated) and inbound replies (maps sender by `trainees.contactPhone`, closes the outstanding task, opens a counsellor case — **message content is never persisted**)
- [x] ✅ **Scheduler** (`server/scheduler.ts`, 60s loop, `SCHEDULER_ENABLED` flag): promotes due tasks → message jobs via the provider, auto-reminds after 3 days of silence (max 2 attempts), escalates to a P2 counsellor case after two unanswered reminders, expires stale consent grants
- [x] ✅ **One-time verification links**: `verification.createLink` issues a signed single-use JWT whose `jti` is persisted in the new `oneTimeTokens` table; `verification.submit` consumes the token atomically (reuse/expiry/forgery → NOT_FOUND — a real bug the tests caught); TraineeJourney has a "Send employer verification link" action that copies the link; the public page now requires `?token=`
- [x] ✅ **Consent receipts**: withdrawal writes its own hash receipt + `NOTICE_VERSION` into the audit trail; expiry worker flips stale grants to `expired`
- Schema additions: `trainees.contactPhone` (delivery address, never rendered in UI) + `oneTimeTokens` table — migration `0001_brown_annihilus.sql` applied

---

## 🟢 Phase 5 — Hardening and polish — **DONE (2026-09-11)**

- [x] ✅ Auth enforced: all staff data/mutation procedures are `protectedProcedure` (anonymous → UNAUTHORIZED → client redirects to `/login`); `traineeJourney` deliberately stays public for the trainee-facing mobile flow. District scoping via `districtScope()`: admins/unscoped staff see everything, a scoped counsellor sees only their district across summary/cohorts/trainees/queue (a scoped filter cannot be widened by request params). `users.district` column added (migration `0002_daily_umar.sql`). Staff user + browser login verified end-to-end.
- [x] ✅ Code splitting: `React.lazy` per route with a shared Suspense fallback — production build emits per-screen chunks (Login 6KB, SkillGaps 10KB, Cohorts 11KB, FollowUps 15KB, TraineeJourney 19KB, dashboard 442KB incl. Recharts); the public flows no longer load the dashboard bundle. The remaining >500 kB warning is vendor-only.
- [x] ✅ Retention/privacy workers in the scheduler cycle: `enforceSingleActiveOutcome` (repairs duplicate active events into the supersede chain + audit), `purgeExpiredOneTimeTokens` (30-day retention), `auditCompletenessCheck` (terminal-state share of message jobs, stale non-terminal count, trainees lacking consent records — logged each cycle).
- [x] ✅ E2E persona journeys (`server/journeys.integration.test.ts`): Asha (verified self-employment with append-only income progression + employer confirmation), Imran (P1 job-loss case → counsellor outreach → trainee pulse moves him to apprenticeship), Sneha (employer-confirmed, low relevance → course review case), Ravi (pending evidence closed by a single-use employer verification link). Test infra hardening: `fileParallelism: false` (DB suites share one database), shared `testHelpers.ts`, db module mocked in no-DB unit tests (no more cross-worker env mutation). Suite: **95/95 passing**.

---

## 📌 Suggested commit sequence

- [x] ✅ 1. `chore: env, cross-env, migrations, seed script`
- [x] ✅ 2. `feat(db): domain query helpers`
- [x] ✅ 3. `feat(api): db-backed tRPC routers + tests`
- [x] ✅ 4. `feat(ui): pages on tRPC (per-screen commits)`
- [x] ✅ 5. `feat(messaging): provider adapter + scheduler + webhook`

## 🟢 Phase 6 — Employee System (from [RECOMMENDATION.md](RECOMMENDATION.md) Theme A) — **DONE (2026-09-12)**

- [x] ✅ **A1 · Employee profile & career record (2026-09-11)**: new `employees` table (1:1 with trainees, migration `0003_crazy_raider.sql`), auto-created by `createOutcomeEvent` when an employer verification lands on an employed outcome; seed adds records for Asha + Sneha. Passwordless portal links: staff-side `employee.createLink` issues a 30-day signed JWT (`/me?token=…`, stateless verification — deliberately not single-use so refreshes work); `employee.me` serves the profile (status, role, industry, skills from training records), the **wage history** from the append-only event chain, and a career timeline that excludes internal casework. New `/me` mobile-first page (lazy-loaded, token persisted to localStorage) with an income-progression chart — verified visually. Trainee journey page has a "Send employee career page link" action. Tests: 113/113 passing (employee-portal suite incl. auto-creation via employer verification, document vault, certificate shares, and rejection for unplaced trainees).
- [x] ✅ **A2 · Documents & certificates vault (2026-09-12)**: `employeeDocuments` table + consent-scoped uploads to Supabase Storage (kind, MIME-type & size validation, retention window), signed URL downloads, delete, shareable certificate links that expose only training info, and a `purgeExpiredEmployeeDocuments` retention worker wired into the scheduler cycle.
- [x] ✅ **A3 · Benefits & scheme eligibility tracker (2026-09-12)**: `benefitSchemes` table with auditable JSON eligibility rules and `employeeBenefits` (status pipeline `eligible → applied → approved → received`). Deterministic, explainable matcher (district, outcome type, course, wage-band midpoint, retention days) — every check returns `{ label, met }` so a worker sees *why*, with no black-box scoring. Eligibility is materialised on read (`/me` "Benefits for you"), employees apply with one tap, and staff run a claims register with status transitions. Migration `0007_romantic_firestar.sql`.
- [x] ✅ **A4 · Grievance & support desk (2026-09-12)**: `counsellorCases.kind` column (escalation / grievance / wage dispute / harassment / benefit / other) plus a `caseMessages` thread table. Employees raise a concern and converse with staff in one place (`/me` "Support & concerns"); staff work a district-scoped bench (list, thread, reply, assign, resolve). Migration `0006_eminent_ezekiel_stane.sql`.

## 🤔 Open decisions (defaults chosen; say the word to change)

- **Messaging**: Console/logger provider is active; set `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` in `.env` to switch to the WhatsApp Cloud API provider (webhook secret: `WHATSAPP_APP_SECRET`).
- **Auth UX**: email + password for now (default); magic-link/OTP is a small follow-up if preferred.
- **Beyond the plan**: ➡️ **See [RECOMMENDATION.md](RECOMMENDATION.md)** — the next-phase backlog (Employee System, employer module, analytics, i18n) with suggested sequencing for phases 6–9. Real personal-data ingestion still waits on the privacy review per TECH_STACK.md.
