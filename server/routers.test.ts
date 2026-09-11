import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import { districtScope } from "./routers";
import { makeContext, makeUser } from "./testHelpers";

// The db module is mocked so these tests exercise the router contract without a
// database and without mutating process.env (which is shared across workers).
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  closeDb: vi.fn(async () => {}),
  upsertUser: vi.fn(async () => {}),
  getUserByOpenId: vi.fn(async () => undefined),
}));

const caller = appRouter.createCaller(makeContext());

describe("auth router", () => {
  it("reports no user without a session", async () => {
    const anonymous = appRouter.createCaller(makeContext(null));
    expect(await anonymous.auth.me()).toBeNull();
  });

  it("logout reports success", async () => {
    expect(await caller.auth.logout()).toEqual({ success: true });
  });
});

describe("staff procedures reject anonymous callers", () => {
  const anonymous = appRouter.createCaller(makeContext(null));

  it("outcomes.summary fails with UNAUTHORIZED", async () => {
    await expect(anonymous.outcomes.summary()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("followUps.queue fails with UNAUTHORIZED", async () => {
    await expect(anonymous.followUps.queue()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("consent.withdraw fails with UNAUTHORIZED", async () => {
    await expect(
      anonymous.consent.withdraw({ traineeId: "asha-patil", purposeCode: "outcome_follow_up" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("traineeJourney is no longer reachable by slug", async () => {
    // The public by-slug read was closed: the register must not be enumerable.
    await expect(
      anonymous.outcomes.traineeJourney({ id: "asha-patil" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("outcomes.watchlist fails with UNAUTHORIZED", async () => {
    await expect(anonymous.outcomes.watchlist()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("exchange.refer fails with UNAUTHORIZED", async () => {
    await expect(
      anonymous.exchange.refer({ traineeRef: "SK-0001", postingId: 1 })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("passport.revoke fails with UNAUTHORIZED", async () => {
    await expect(
      anonymous.passport.revoke({ traineeRef: "SK-0001", reason: "test" })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });
});

describe("capability-gated public surfaces", () => {
  const anonymous = appRouter.createCaller(makeContext(null));

  it("a forged pulse link is rejected without touching the database", async () => {
    await expect(
      anonymous.outcomes.traineePulse({ token: "not-a-real-token" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a forged pulse submission is rejected", async () => {
    await expect(
      anonymous.followUps.submitPulseResponse({
        token: "not-a-real-token",
        outcomeType: "formal_employment",
        consentToContact: true,
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("the passport view and scorecards stay public", async () => {
    // Public by design; the missing database is surfaced instead of a 401.
    await expect(
      anonymous.passport.view({ publicId: "unknown" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(anonymous.scorecards.list()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
});

describe("database-backed procedures without a configured database", () => {
  it("outcomes.summary fails with PRECONDITION_FAILED", async () => {
    await expect(caller.outcomes.summary()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("outcomes.traineeJourney fails with PRECONDITION_FAILED", async () => {
    await expect(caller.outcomes.traineeJourney({ id: "asha-patil" })).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("followUps.queue fails with PRECONDITION_FAILED", async () => {
    await expect(caller.followUps.queue()).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });

  it("followUps.sendMessage rejects malformed case ids with BAD_REQUEST", async () => {
    await expect(
      caller.followUps.sendMessage({ caseId: "not-a-number", channel: "WhatsApp" })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("followUps.submitResponse rejects unknown outcome types with BAD_REQUEST", async () => {
    await expect(
      caller.followUps.submitResponse({
        traineeId: "asha-patil",
        outcomeType: "winning_the_lottery" as never,
        consentToContact: true,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("consent.withdraw fails with PRECONDITION_FAILED", async () => {
    await expect(
      caller.consent.withdraw({ traineeId: "asha-patil", purposeCode: "outcome_follow_up" })
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("districtScope policy", () => {
  it("admins and missing users are unscoped", () => {
    expect(districtScope(makeUser({ role: "admin", district: "Pune" }))).toBeNull();
    expect(districtScope(null)).toBeNull();
  });

  it("scoped staff are limited to their district", () => {
    expect(districtScope(makeUser({ role: "user", district: "Pune" }))).toBe("Pune");
  });

  it("unscoped staff users see everything", () => {
    expect(districtScope(makeUser({ role: "user", district: null }))).toBeNull();
  });
});
