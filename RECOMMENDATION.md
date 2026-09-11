# Skillio — Feature Recommendations

> 📅 2026-09-11 · Based on the completed build (ROADMAP.md phases 0–5, 49/49 items, 59/59 tests)
> 🎯 Purpose: what to build next, ordered by value — with the **complete Employee System** as the headline recommendation

---

## 📊 Where Skillio stands today

| Capability | Status |
|---|---|
| Live Supabase Postgres (9+ tables), tRPC API, React 19 + Vite UI | ✅ Built |
| Staff screens: state dashboard, cohorts, trainee journeys, follow-up queue, skill-gap board | ✅ Built |
| Trainee touchpoints: mobile outcome pulse, employer verification (one-time signed links) | ✅ Built |
| Messaging: provider-neutral adapter, console + WhatsApp Cloud API providers, signed webhooks | ✅ Built |
| Automation: scheduler (due-task promotion, reminders, escalation, consent expiry, hygiene workers) | ✅ Built |
| Governance: auth + district scoping, append-only outcome events, consent receipts, audit trail | ✅ Built |

**The gap:** Skillio currently sees a person only as a *trainee being tracked*. Once someone is placed, the system's relationship with them is a series of pulses. The biggest untapped value — and the core of this document — is treating that person as an **employee with a living career record**.

---

# 🧑‍💼 Theme A — The Complete Employee System (headline recommendation)

**Idea:** every placed trainee becomes an *employee* with a durable, consent-gated profile that grows with their career — not a row in an outcome report. This turns Skillio from a monitoring tool into a career platform, which also makes trainees *want* to respond to follow-ups.

### A1. Employee profile & career record — ✅ **BUILT (2026-09-11, see ROADMAP Phase 6)**
- New `employees` domain: 1:1 with a trainee, auto-created when an employer verification lands on an employed outcome.
- Record: current employer, role category, wage band history (already in `outcomeEvents` — surfaced as a **wage progression chart** on the employee profile), skills from completed courses, district, preferred language.
- Screens: `/me` (employee home), career timeline (reuses `buildTimeline`), wage-growth chart.
- API: `employee.createLink` (staff) + `employee.me` — the portal link is a 30-day signed JWT used directly as the session (stateless verification; deliberately not single-use so page refreshes work).

### A2. Documents & certificates vault
- Store completion certificates, payslips (optional), ID-linked scheme documents in Supabase Storage (the S3-compatible storage scaffold already exists in `server/_core/storageProxy.ts`).
- Table: `employeeDocuments` (employeeId, kind, storagePath, uploadedAt, consentPurposeCode, retentionUntil).
- Rule: nothing is stored without a purpose-specific consent row; the retention worker already exists in the scheduler — extend it to purge expired documents.
- Killer feature for the audience: **"always available certificate"** — trainees lose paper certificates constantly; a WhatsApp-shareable verified certificate link is immediately loved.

### A3. Benefits & scheme eligibility tracker
- A curated catalogue of government/private skilling benefits (e.g. post-placement support schemes, tool subsidies, transport allowances).
- Table: `schemes` (code, title, eligibilityRules jsonb, district scope, agency) + `employeeBenefits` (status: eligible / applied / approved / received).
- Match engine v1: simple rule checks against the employee record (district, outcome type, wage band, course) — no ML needed; the rule JSON keeps it auditable.
- This is the single strongest "why should I keep responding to Skillio" hook for trainees: **respond → discover benefits**.

### A4. Grievance & support desk
- Employees raise issues (wage dispute, workplace safety, harassment, contract mismatch) from `/me` or by replying "HELP" to a WhatsApp pulse.
- Reuse `counsellorCases` (add a `kind` column: follow_up | grievance) and the existing P1–P4 priority + assignment flow. Wage-dispute grievances referencing a verified employer should auto-escalate to P1.
- Audit-friendly by construction; add a `caseEvents` thread for status history so employees can see "received → assigned → resolved".

### A5. Job marketplace & internal referrals
- Employers in the verification flow already exist implicitly — promote them to an `employers` registry (name, industry, district, verified contact, open roles).
- `jobPostings` (employerId, roleCategory, district, wageBand, courseTags) + `jobApplications` (employeeId, postingId, status pipeline).
- Matching v1: roleCategory + district + course tags against the skill-gap board's playbook — when the curriculum team adds a module (skill-gap action), graduates of it get matched to waiting postings.
- The trainee journey's "Next best action" engine gets a real action: **apply to a matched job**.

### A6. Upskilling recommendations
- Connect the skill-gap board (barrier → intervention) to employees: an employee whose relevance score is low, or who was superseded to `not_working`, gets recommended specific short modules from `courses` (new catalogue table).
- Track `upskillingEnrolments` and feed completion back into outcome events — closes the loop the dashboard visualises.

### A7. Alumni community & peer mentorship
- Lightweight: alumni directory (opt-in, pseudonymous by default), "mentor available" flag from successful employees (retentionDays > 180 + relevance ≥ 4), and a monthly automated digest.
- The scheduler already sends templated messages — add a `monthly_digest` template job.

### A8. Employee mobile experience (PWA)
- The mobile follow-up wizard proves the pattern: full-screen, 3 steps, low-data. Extend it into a PWA shell (`/me`) with install support, offline-tolerant forms, and WhatsApp deep links.
- i18n: the UI is English-only today; Marathi/Hindi strings for the employee-facing screens are essential for this audience (the schema already carries `preferredLanguage`).

### 🧱 Data & API skeleton for Theme A

```text
employees (id, traineeId unique, currentEmployerId?, status, joinedAt)
employers (id, name, industry, district, verifiedAt)
employeeDocuments (id, employeeId, kind, storagePath, retentionUntil)
schemes (id, code, title, eligibilityRules jsonb, district)
employeeBenefits (id, employeeId, schemeId, status, appliedAt)
jobPostings (id, employerId, roleCategory, district, wageBand, courseTags jsonb, open)
jobApplications (id, employeeId, postingId, status, appliedAt)
grievances → counsellorCases + caseEvents (kind column + thread)
courses (id, title, provider, durationHours, skills jsonb)
upskillingEnrolments (id, employeeId, courseId, status)
```
Auth pattern: reuse the one-time token machinery (`oneTimeTokens`, purpose `employee_login`) for passwordless magic links; add a `checkConstraint` that every document/benefit row references an active consent grant.

---

# 🏢 Theme B — Employer & Placement module

- **Employer portal** (`/employer`): verify outcomes (already built), post jobs, confirm continued employment in one click instead of the manual link flow, see their own placement stats.
- **Placement matching workflow** for counsellors: a queue view of "job seekers × open postings" with one-click referral generation (WhatsApp message with the posting link through the existing messaging adapter).
- **Employer NPS / 6-month check-in**: the scheduler can run employer-side pulses the same way it runs trainee pulses — evidence quality on the dashboard goes up.

# 📚 Theme C — Programme & curriculum operations

- **Intervention tracking**: the skill-gap board's "Assign intervention" button currently only changes local state — persist it (`interventions` table: gap, action, owner, status, dueAt) and feed completion into the dashboard.
- **Provider scorecards**: providers exist as strings; make a `providers` table and give them a public scorecard page (completion, verified %, retention, relevance — all already computed per district/cohort).
- **Course catalogue + attendance ingestion**: replace `sourceSystem: provider_import` strings with a real provider upload flow (CSV import endpoint + validation).

# 📈 Theme D — Analytics & reporting

- **Export brief** (the button exists but is a no-op): server-rendered PDF/CSV of the dashboard, district-scoped, with freshness stamps — quick win using the data already in `outcomes.summary`.
- **Scheduled digests**: WhatsApp/email weekly brief to district officers (scheduler + messaging adapter make this ~1 day of work).
- **Attrition-risk scoring (v1, explainable)**: rule-based risk flags from existing fields (relevance ≤ 2, retentionDays < 90, barrier present, no response to 2 reminders) — displayed with the evidence, consistent with the "no black-box ranking" promise already on the skill-gap board.
- **Cohort comparison deep-dive**: side-by-side cohort picker with significance warnings (sample size < 10 is already suppressed).

# 💬 Theme E — Messaging & engagement

- **Marathi/Hindi WhatsApp templates** (the provider sends English template codes today) — template name mapping per `preferredLanguage`.
- **Structured replies**: inbound WhatsApp replies currently open a generic case; add keyword routing ("1" = still working, "2" = left job, "HELP" = grievance) → writes structured outcome events without the mobile form.
- **Voice/IVR fallback** for low-literacy users (aggregator support; the provider-neutral interface takes a third implementation).
- **Consent-aware re-engagement**: employees with withdrawn consent get a postal/field-visit task instead of messages (the scheduler already cancels message tasks for them — route them to a work queue instead).

# 🛠 Theme F — Platform & engineering hardening

| Item | Why | Effort |
|---|---|---|
| Postgres RLS policies on all tables | Defence-in-depth under Supabase; API scoping alone isn't enough once the employee portal exists | M |
| PII encryption at rest for `contactPhone` (pgcrypto or app-layer) | Phone numbers are the only PII stored; encryption simplifies the privacy review | S |
| Vendor chunk splitting (`manualChunks`) | Removes the last >500 kB bundle warning | S |
| Playwright E2E on the built app | The 59 tests are API-level; the browser journeys deserve UI tests against `pnpm build && pnpm start` | M |
| Rate limiting on public endpoints (`traineeJourney`, webhooks, verification submit) | Public surface hardening before real traffic | S |
| Observability: request logging + error tracking | Scheduler and webhooks currently only log to console | S |
| Backup/restore drill + point-in-time recovery check | Supabase free tier has no PITR; document the dump/restore runbook | S |
| UI i18n (Marathi/Hindi) for employee-facing screens | Adoption prerequisite for Theme A | M |

---

## 🗺 Suggested sequencing

| Phase | Theme | Headline outcome |
|---|---|---|
| **6** | A1–A4 + F(RLS, encryption) | Employee portal: profile, certificates, benefits, grievances |
| **7** | B + A5–A6 | Employer portal + job matching + upskilling loop |
| **8** | D + E | Reporting exports, digests, multilingual messaging |
| **9** | A7–A8 + C | Alumni community, PWA, programme ops |

## ⚖️ Prioritisation logic (why this order)

1. **Employee system first** — it multiplies everything else: response rates (benefits hook), data quality (self-service updates), and mission impact (career support, not surveillance).
2. **Employer module second** — job matching needs the employee profile to exist; employers already touch the system through verification.
3. **Analytics third** — exports and digests monetise/polish what exists but don't unlock new behaviour.
4. **Guardrails travel with features**: every employee-facing feature lands with its consent purpose code, retention rule, and RLS policy — the infrastructure for all three already exists.

## ⚠️ Guardrails that must not slip

- No real personal data until the privacy review signs off (TECH_STACK.md) — Themes A/B are designed to be built and demoed on synthetic data first.
- Inbound message content stays unpersisted (current rule) — keyword routing parses and discards, storing only the structured result.
- Every document, benefit, and job application is consent-purpose-scoped and purgeable by the retention worker.
- District scoping extends to the new tables from day one — a Pune counsellor must never see a Nagpur employee's grievance.
