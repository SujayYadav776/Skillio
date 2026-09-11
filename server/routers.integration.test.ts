import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { appRouter } from "./routers";
import { makeContext, makeUser } from "./testHelpers";
import { closeDb } from "./db";
import { runSeed } from "./seed";
import { escalateUnansweredFollowUps, promoteDueFollowUps } from "./scheduler";

// Integration tests run against the seeded Supabase database and are skipped
// automatically when no DATABASE_URL is configured.
const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("routers integration (live database)", () => {
  const caller = appRouter.createCaller(makeContext());

  beforeAll(async () => {
    // Deterministic fixture state: fresh seed with stable ids.
    await runSeed();
  }, 60_000);

  afterAll(async () => {
    // Leave the demo database pristine for the app.
    await runSeed();
    await closeDb();
  }, 60_000);

  describe("reads", () => {
    it("outcomes.summary aggregates the six seeded trainees", async () => {
      const summary = await caller.outcomes.summary();
      expect(summary.metrics.activeTrainees).toBe("6");
      expect(summary.metrics.verifiedEmployment).toMatch(/%$/);
      expect(summary.districts).toHaveLength(5);
      // Pune has two trainees; districts sort by completions descending.
      expect(summary.districts[0].district).toBe("Pune");
      expect(summary.districts[0].completion).toBe(2);
    });

    it("outcomes.trainees filters by district and query", async () => {
      const pune = await caller.outcomes.trainees({ district: "Pune" });
      expect(pune).toHaveLength(2);

      const asha = await caller.outcomes.trainees({ query: "asha" });
      expect(asha).toHaveLength(1);
      expect(asha[0]).toMatchObject({
        id: "asha-patil",
        name: "Asha Patil",
        statusLabel: "Self-employed",
        outcomeStatus: "verified",
      });
    });

    it("outcomes.traineeJourney builds Imran's timeline from event chains", async () => {
      const journey = await caller.outcomes.traineeJourney({ id: "imran-shaikh" });
      expect(journey.trainee).toMatchObject({
        id: "imran-shaikh",
        status: "not_working",
        barrier: "Transport cost",
      });
      const titles = journey.timeline.map((event) => event.title);
      // A "ended" employment row emits both the placement and the end milestone.
      expect(titles).toContain("Course completed");
      expect(titles).toContain("Started formal employment");
      expect(titles).toContain("Employment ended");
      expect(titles).toContain("Recent job loss");
    });

    it("outcomes.traineeJourney returns NOT_FOUND for unknown slugs", async () => {
      await expect(
        caller.outcomes.traineeJourney({ id: "nobody-here" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("outcomes.skillGaps maps seeded barriers", async () => {
      const gaps = await caller.outcomes.skillGaps();
      const skills = gaps.map((gap) => gap.skill);
      expect(skills).toContain("Market access");
      expect(skills).toContain("Transport cost");
      for (const gap of gaps) {
        expect(gap.affected).toMatch(/% of trainees$/);
        expect(["High", "Medium", "Watch"]).toContain(gap.severity);
      }
    });

    it("followUps.queue returns the seeded cases in priority order", async () => {
      const queue = await caller.followUps.queue();
      expect(queue).toHaveLength(4);
      expect(queue[0]).toMatchObject({ priority: "P1", traineeId: "imran-shaikh" });
    });

    it("consent.status lists the trainee's granted purposes", async () => {
      const status = await caller.consent.status({ traineeId: "asha-patil" });
      expect(status.purposes).toHaveLength(2);
      for (const purpose of status.purposes) {
        expect(purpose.status).toBe("granted");
      }
    });
  });

  describe("mutations", () => {
    it("followUps.sendMessage records an idempotent message job and marks the task sent", async () => {
      const first = await caller.followUps.sendMessage({
        caseId: "case-3",
        channel: "SMS",
      });
      expect(first).toMatchObject({ accepted: true, caseId: "case-3", duplicate: false });
      expect(first.providerMessageId).toMatch(/^sim_/);

      const again = await caller.followUps.sendMessage({
        caseId: "case-3",
        channel: "SMS",
      });
      expect(again.duplicate).toBe(true);
    });

    it("followUps.sendMessage rejects malformed case ids", async () => {
      await expect(
        caller.followUps.sendMessage({ caseId: "case-lol", channel: "SMS" })
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("followUps.submitResponse appends an outcome event and honours withdrawn consent", { timeout: 30_000 }, async () => {
      const result = await caller.followUps.submitResponse({
        traineeId: "farhan-khan",
        outcomeType: "formal_employment",
        wageBand: "₹10k–₹19k",
        relevance: 4,
        consentToContact: false,
      });
      expect(result.accepted).toBe(true);
      expect(result.nextFollowUpScheduled).toBe(false);
      // Farhan had one scheduled placement-support task; no consent means cancelled.
      expect(result.cancelledTaskCount).toBeGreaterThanOrEqual(1);

      const refreshed = await caller.outcomes.trainees({ query: "farhan" });
      expect(refreshed[0]).toMatchObject({
        status: "formal_employment",
        statusLabel: "Employed",
        consent: "withdrawn",
      });
    });

    it("consent.withdraw updates grants, cancels matching tasks, and writes an audit row", async () => {
      const result = await caller.consent.withdraw({
        traineeId: "asha-patil",
        purposeCode: "outcome_follow_up",
      });
      // Router returns the demo shape; grant detail stays in the query layer.
      expect(result).toMatchObject({
        accepted: true,
        traineeId: "asha-patil",
        purposeCode: "outcome_follow_up",
      });
      expect(typeof result.auditEventId).toBe("number");

      const status = await caller.consent.status({ traineeId: "asha-patil" });
      const followUp = status.purposes.find((p) => p.purposeCode === "outcome_follow_up");
      expect(followUp?.status).toBe("withdrawn");
    });
  });

  describe("phase 4 flows", () => {
    // Isolate from the mutation tests above: fresh seed, stable ids.
    beforeAll(async () => {
      await runSeed();
    }, 60_000);

    it("employer verification link is single-use and appends a verified event", { timeout: 30_000 }, async () => {
      const link = await caller.verification.createLink({ traineeRef: "SKL-8N1T6C" });
      expect(link.accepted).toBe(true);
      expect(link.url).toContain("/verify/employer?ref=SKL-8N1T6C&token=");

      const token = new URLSearchParams(link.url.split("?")[1]).get("token");
      expect(token).toBeTruthy();

      const submit = await caller.verification.submit({
        token: token!,
        stillEmployed: true,
        roleCategory: "Electrician",
        wageBand: "₹20k–₹29k",
      });
      expect(submit).toMatchObject({ verified: true, traineeRef: "SKL-8N1T6C" });
      expect(typeof submit.outcomeEventId).toBe("number");

      const refreshed = await caller.outcomes.trainees({ query: "ravi" });
      expect(refreshed[0]).toMatchObject({ outcomeStatus: "verified" });

      // A consumed token can never be used again.
      await expect(
        caller.verification.submit({ token: token!, stillEmployed: true })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });

      await expect(
        caller.verification.submit({ token: "forged-token", stillEmployed: true })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("staff procedures reject anonymous callers with UNAUTHORIZED", async () => {
      const anonymous = appRouter.createCaller(makeContext(null));
      await expect(anonymous.followUps.queue()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(anonymous.outcomes.summary()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      // The by-slug trainee read is staff-only now; capability links power the
      // public mobile/verification flows instead of an open journey read.
      await expect(
        anonymous.outcomes.traineeJourney({ id: "asha-patil" })
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("district-scoped staff only see their own district", async () => {
      const scoped = appRouter.createCaller(makeContext(makeUser({ role: "user", district: "Pune" })));

      const trainees = await scoped.outcomes.trainees({});
      expect(trainees).toHaveLength(2);
      expect(trainees.every((t) => t.district === "Pune")).toBe(true);

      // A scoped counsellor cannot widen the filter back out.
      const widened = await scoped.outcomes.trainees({ district: "Nashik" });
      expect(widened.every((t) => t.district === "Pune")).toBe(true);

      const queue = await scoped.followUps.queue();
      // Only Farhan's Pune case (case-4) survives the scope.
      expect(queue.map((item) => item.id)).toEqual(["case-4"]);

      const summary = await scoped.outcomes.summary();
      expect(summary.districts.map((row) => row.district)).toEqual(["Pune"]);

      const cohorts = await scoped.outcomes.cohorts();
      expect(cohorts.every((row) => row.district === "Pune")).toBe(true);
    });

    it("scheduler promotes due tasks through the messaging provider", { timeout: 30_000 }, async () => {
      // Force all scheduled tasks due; the call-channel task stays human-owned.
      const promotion = await promoteDueFollowUps(new Date("2026-09-20T10:00:00"));
      expect(promotion.promoted).toBeGreaterThanOrEqual(1);

      const queue = await caller.followUps.queue();
      // Nothing broke; the queue still resolves and cases remain sorted.
      expect(queue.length).toBeGreaterThanOrEqual(4);
    });

    it("scheduler escalates unanswered reminders into counsellor cases", { timeout: 30_000 }, async () => {
      // Escalation deduplicates against open cases; the seed opens cases for the
      // same trainees, so resolve them to exercise the escalation rule itself.
      const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
      await sql`update "counsellorCases" set status='resolved' where status='open'`;
      await sql.end();

      // Second attempt for the auto-promoted task, then force the grace window past.
      await promoteDueFollowUps(new Date("2026-09-21T10:00:00"));
      const escalation = await escalateUnansweredFollowUps(new Date("2026-10-01T10:00:00"));
      expect(escalation.escalated).toBeGreaterThanOrEqual(1);

      const queue = await caller.followUps.queue();
      expect(queue.some((item) => item.title === "No response after two reminders")).toBe(true);
    });
  });
});
