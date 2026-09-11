# Skillio starter app

## Technology stack

| Layer | Choice | Why it is used |
|---|---|---|
| Frontend | React 19 + TypeScript | Typed component model and fast iteration |
| Build tooling | Vite 7 | Fast development server and production bundling |
| Styling | Tailwind CSS 4 + CSS variables | Consistent responsive visual system |
| UI primitives | shadcn/ui-style Radix components | Accessible buttons, cards, tooltips, menus, and form primitives |
| Icons | `lucide-react` | Consistent lightweight interface icons |
| Routing | Wouter | Small typed-feeling client router suitable for the starter app |
| Data visualisation | Recharts | Retention, wage, outcome-mix, and comparison charts |
| Server | Express 4 | Managed server process supplied by the full-stack scaffold |
| API contract | tRPC 11 | End-to-end typed procedures without hand-written REST clients |
| Database ORM | Drizzle ORM | Typed schema and migrations |
| Database | MySQL/TiDB through the managed project database | Persistent operational data |
| Authentication | Manus OAuth scaffold | Staff authentication and session handling |
| File/object storage | S3-compatible storage scaffold | Future evidence uploads; do not store file bytes in SQL |
| Validation | Zod | Request and form validation |
| Tests | Vitest | Server and domain-level tests |
| Deployment | Managed WebDev HTTPS hosting | Preview and production deployment without custom infrastructure |
| Messaging boundary | Provider-neutral adapter | Keeps WhatsApp Cloud API or an approved aggregator separate from business logic |

### Current data mode

The seven screens render from the live Supabase database via tRPC (Phase 3+). The judge/persona experiences are run against the deterministic seed in `server/seed.ts` (six personas), so no real personal data or external messaging credentials are required. Synthetic data is labelled in the navigation shell.

### Production integrations to add later

1. Replace the demo data queries with Drizzle-backed query helpers.
2. Connect the `MessagingProvider` boundary to an approved WhatsApp Business Platform provider and an SMS provider.
3. Add a provider-signed webhook receiver for inbound messages and delivery events.
4. Add a durable scheduler and job worker using the platform’s periodic-job support.
5. Add managed secrets, consent receipts, encryption, retention workers, and district-scoped role policies.

---

## Directory structure

```text
skillio/
├── client/
│   ├── index.html                         # Page title and font setup
│   └── src/
│       ├── App.tsx                         # Route map and shell selection
│       ├── index.css                       # Tailwind tokens and global styles
│       ├── main.tsx                        # React entry point
│       ├── components/
│       │   ├── SkillioShell.tsx            # Dark-teal sidebar, header, reusable page chrome
│       │   ├── DashboardLayout.tsx         # Scaffolded authenticated dashboard shell
│       │   └── ui/                         # Scaffolded shadcn/Radix primitives
│       ├── pages/
│       │   ├── CommandCentre.tsx           # Screen 1: State Outcome Command Centre
│       │   ├── Cohorts.tsx                  # Screen 2: Cohort and provider explorer
│       │   ├── TraineeJourney.tsx           # Screen 3: Longitudinal trainee journey
│       │   ├── FollowUps.tsx                # Screen 4: Counsellor work queue
│       │   ├── MobileFollowUp.tsx           # Screen 5: Mobile trainee response flow
│       │   ├── EmployerVerification.tsx     # Screen 6: Employer confirmation flow
│       │   ├── SkillGaps.tsx                # Extension: skill-gap intervention board
│       │   └── NotFound.tsx                 # Fallback route
│       └── lib/
│           ├── trpc.ts                     # Generated tRPC client binding
│           └── utils.ts                    # Shared class-name utilities
├── drizzle/
│   ├── schema.ts                           # MySQL/TiDB operational schema
│   ├── migrations/                         # Generated migration history
│   └── 0001_worthless_shockwave.sql        # Applied initial Skillio migration
├── server/
│   ├── routers.ts                           # Typed tRPC procedures
│   ├── db.ts                                # Drizzle connection and query helpers
│   ├── auth.logout.test.ts                  # Existing authentication test
│   └── _core/                               # Managed server/auth/runtime infrastructure
├── shared/
│   ├── demoData.ts                          # Synthetic demo domain, metrics, personas, and charts
│   ├── types.ts                             # Shared scaffold types
│   └── const.ts                             # Shared scaffold constants
├── TECH_STACK.md                            # This document
├── package.json                             # Scripts and dependencies
└── drizzle.config.ts                        # Drizzle configuration
```

---

## Six core screens

| Screen | Route | Main interaction |
|---|---|---|
| Command centre | `/` | Filter state pulse; inspect retention, wages, outcome mix, skill gaps, and district performance |
| Cohort explorer | `/cohorts` | Search and filter cohorts; compare coverage, verified work, retention, relevance, and next action |
| Trainee journey | `/trainees/:id` | Inspect append-only timeline, evidence confidence, consent, and recommended intervention |
| Follow-up queue | `/follow-ups` | Filter cases; send a simulated WhatsApp/SMS action; open the trainee journey |
| Mobile follow-up | `/follow-up/mobile` | Complete a three-step employment, wage, relevance, and consent flow without admin navigation |
| Employer verification | `/verify/employer` | Verify a single outcome using minimal information and a one-time-style public surface |

The `/skill-gaps` route is an additional judge-facing extension that demonstrates how barriers become course and intervention decisions.

---

## Database model included in the starter

The Drizzle schema includes:

- `users` for scaffolded staff authentication;
- `trainees` for pseudonymous operational profiles;
- `consentGrants` for purpose-specific consent state;
- `trainingRecords` for course and certification history;
- `outcomeEvents` for append-only employment and wage history;
- `followUpTasks` for scheduled and assisted follow-ups;
- `messageJobs` for WhatsApp/SMS provider-neutral delivery state;
- `counsellorCases` for human escalation;
- `auditEvents` for access and consent actions.

The initial migration has been generated and applied. It contains no real trainee data.

---

## tRPC starter procedures

`server/routers.ts` currently exposes these demo-ready procedures:

```text
outcomes.summary
outcomes.skillGaps
outcomes.trainees
outcomes.traineeJourney
followUps.queue
followUps.sendDemoMessage
followUps.submitResponse
consent.status
consent.withdraw
```

The frontend currently uses local synthetic data to guarantee a deterministic judging experience. Replace those imports with `trpc.*.useQuery()` and `trpc.*.useMutation()` one screen at a time after the demo experience is accepted.

---

## Local development commands

```bash
cd /home/ubuntu/skillio
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm drizzle-kit generate
pnpm db:rls        # optional: enable Row-Level Security (defence-in-depth)
```

The current project has passed `pnpm check`, `pnpm test` (113/113), and `pnpm build`. The production build splits per-screen and vendor chunks (React, charts, tRPC, UI, vendor), so no chunk trips the >500 kB advisory.

---

## Demo routes

| Route | Purpose |
|---|---|
| `/` | State dashboard |
| `/cohorts` | Cohort comparison |
| `/trainees/asha-patil` | Strong positive outcome journey |
| `/trainees/imran-shaikh` | Job-loss and barrier intervention journey |
| `/trainees/sneha-jadhav` | Low relevance and employer-confirmed journey |
| `/follow-ups` | Assisted escalation and message operations |
| `/follow-up/mobile` | Trainee mobile response flow |
| `/verify/employer` | Employer verification flow |
| `/skill-gaps` | Skill-gap-to-action board |

---

## Next implementation priorities

### Before a judge demo

Keep the current deterministic synthetic-data mode. Seed the exact persona paths above. Demonstrate the dashboard, Imran’s job-loss intervention, one mobile response, employer verification, and consent withdrawal.

### After the judge demo

Move shared domain logic into Drizzle query helpers, switch the six screens to tRPC, add a real consent receipt table and a webhook event table, then implement the provider adapter and scheduler. Do not connect real personal data until the privacy review, retention policy, role boundaries, and incident-response process are approved.
