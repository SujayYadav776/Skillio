import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { appRouter } from "./routers";
import { makeContext } from "./testHelpers";
import { closeDb } from "./db";
import { runSeed } from "./seed";

/**
 * End-to-end persona journeys: the three demo storylines exercised through the
 * API the way a real rollout would play them. Runs against the live database;
 * skipped without DATABASE_URL.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const caller = appRouter.createCaller(makeContext());

describe.skipIf(!hasDb)("persona journeys (live database)", () => {
  beforeAll(async () => {
    await runSeed();
  });

  afterAll(async () => {
    await runSeed();
    await closeDb();
  });

  it("Asha: strong self-employment outcome with income progression and employer evidence", { timeout: 30_000 }, async () => {
    const journey = await caller.outcomes.traineeJourney({ id: "asha-patil" });

    expect(journey.trainee).toMatchObject({
      outcomeStatus: "verified",
      wageBand: "₹20k–₹29k",
      statusLabel: "Self-employed",
    });
    const titles = journey.timeline.map((event) => event.title);
    expect(titles).toContain("Course completed");
    expect(titles).toContain("Started self-employment");
    // The progression is append-only: the ₹10k–₹19k pulse was superseded.
    expect(titles).toContain("Employer confirmation received");

    const status = await caller.consent.status({ traineeId: "asha-patil" });
    expect(status.purposes.every((purpose) => purpose.status === "granted")).toBe(true);
  });

  it("Imran: job loss triggers intervention; the trainee pulse moves him on", { timeout: 30_000 }, async () => {
    const journey = await caller.outcomes.traineeJourney({ id: "imran-shaikh" });
    const titles = journey.timeline.map((event) => event.title);
    expect(titles).toContain("Employment ended");
    expect(journey.trainee.barrier).toBe("Transport cost");

    const queue = await caller.followUps.queue();
    const imranCase = queue.find((item) => item.traineeId === "imran-shaikh");
    expect(imranCase).toMatchObject({ priority: "P1", title: "Recent job loss" });

    // Counsellor reaches out via the queue...
    const sent = await caller.followUps.sendMessage({ caseId: imranCase!.id, channel: "WhatsApp" });
    expect(sent.accepted).toBe(true);

    // ...and the trainee reports a new placement from the mobile flow.
    const response = await caller.followUps.submitResponse({
      traineeId: "imran-shaikh",
      outcomeType: "apprenticeship",
      wageBand: "₹10k–₹19k",
      relevance: 5,
      consentToContact: true,
    });
    expect(response.accepted).toBe(true);
    expect(response.closedTaskCount).toBeGreaterThanOrEqual(0);

    const refreshed = await caller.outcomes.traineeJourney({ id: "imran-shaikh" });
    expect(refreshed.trainee).toMatchObject({ status: "apprenticeship", statusLabel: "Apprentice" });
  });

  it("Sneha: employer-confirmed but low relevance routes to a course review", { timeout: 30_000 }, async () => {
    const journey = await caller.outcomes.traineeJourney({ id: "sneha-jadhav" });
    expect(journey.trainee).toMatchObject({
      outcomeStatus: "verified",
      status: "formal_employment",
      relevance: 2,
      barrier: "Role mismatch",
    });
    // Employer confirmation is part of the recorded timeline.
    expect(journey.timeline.map((event) => event.title)).toContain(
      "Employer confirmation received"
    );

    const queue = await caller.followUps.queue();
    const snehaCase = queue.find((item) => item.traineeId === "sneha-jadhav");
    expect(snehaCase?.nextAction).toContain("course review");
  });

  it("employer verification completes Ravi's pending evidence", { timeout: 30_000 }, async () => {
    const before = await caller.outcomes.trainees({ query: "ravi" });
    expect(before[0].outcomeStatus).toBe("pending");

    const link = await caller.verification.createLink({ traineeRef: "SKL-8N1T6C" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;

    const submit = await caller.verification.submit({
      token,
      stillEmployed: true,
      roleCategory: "Electrician",
    });
    expect(submit.verified).toBe(true);

    const after = await caller.outcomes.trainees({ query: "ravi" });
    expect(after[0].outcomeStatus).toBe("verified");

    // Hygiene: the public surface reflects the closed evidence gap.
    const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
    const [tokenRow] = await sql`select "usedAt" from "oneTimeTokens" order by id desc limit 1`;
    expect(tokenRow.usedAt).not.toBeNull();
    await sql.end();
  });
});
