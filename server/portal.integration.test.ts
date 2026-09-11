import "dotenv/config";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { makeContext, makeUser } from "./testHelpers";
import { closeDb } from "./db";
import { runSeed } from "./seed";

/**
 * A3 (benefits) + A4 (grievance desk): portal eligibility, applications,
 * employee-opened grievances with a staff workbench, and district scoping.
 */
const hasDb = Boolean(process.env.DATABASE_URL);

const caller = appRouter.createCaller(makeContext());
const puneScope = appRouter.createCaller(makeContext(makeUser({ role: "user", district: "Pune" })));

describe.skipIf(!hasDb)("benefits & support desk (live database)", () => {
  beforeAll(async () => {
    await runSeed();
  }, 60_000);

  afterAll(async () => {
    await runSeed();
    await closeDb();
  }, 60_000);

  it("benefits: the portal shows eligibility with explainable checks", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;

    const portal = await caller.benefits.mine({ token });
    const byCode = new Map(portal.items.map((item) => [item.code, item]));

    // Asha: Pune, self-employed, ₹20k–₹29k, 214 days in work. Eligible schemes
    // are materialised with status "eligible" on read.
    expect(byCode.get("POST_PLACE_90")).toMatchObject({ eligible: true, status: "eligible" });
    expect(byCode.get("TAILOR_TOOL_PUNE")).toMatchObject({ eligible: true });
    expect(byCode.get("UPSKILL_WAIVER")).toMatchObject({ eligible: true });
    expect(byCode.get("APPRENTICE_TRANSIT")).toMatchObject({ eligible: false });

    const transit = byCode.get("APPRENTICE_TRANSIT")!;
    expect(transit.checks.every((check) => !check.met)).toBe(true);
  });

  it("benefits: applying marks the claim and a staff status update closes it", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const portal = await caller.benefits.mine({ token });
    const scheme = portal.items.find((item) => item.code === "POST_PLACE_90")!;

    const applied = await caller.benefits.applyToScheme({ token, schemeId: scheme.schemeId });
    expect(applied).toMatchObject({ accepted: true, status: "applied" });

    const afterApply = await caller.benefits.mine({ token });
    expect(afterApply.items.find((item) => item.code === "POST_PLACE_90")).toMatchObject({
      status: "applied",
      eligible: true,
    });

    const claims = await caller.benefits.claims({ status: "applied" });
    const claim = claims.find((row) => row.traineeRef === "SKL-7F4K2M")!;
    expect(claim.schemeCode).toBe("POST_PLACE_90");

    const decided = await caller.benefits.setStatus({
      benefitId: claim.id,
      status: "approved",
      notes: "Verified placement documents",
    });
    expect(decided.status).toBe("approved");
  });

  it("benefits: applying to an ineligible scheme is rejected", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;
    const portal = await caller.benefits.mine({ token });
    const transit = portal.items.find((item) => item.code === "APPRENTICE_TRANSIT")!;
    await expect(caller.benefits.applyToScheme({ token, schemeId: transit.schemeId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  it("support desk: an employee opens a grievance and staff resolve it", { timeout: 30_000 }, async () => {
    const link = await caller.employee.createLink({ traineeRef: "SKL-7F4K2M" });
    const token = new URLSearchParams(link.url.split("?")[1]).get("token")!;

    const opened = await caller.grievance.open({
      token,
      kind: "wage_dispute",
      subject: "Payment short by two days",
      body: "The boutique paid me for 28 days instead of 30 for the festival order.",
    });
    expect(opened).toMatchObject({ accepted: true, kind: "wage_dispute" });

    const mine = await caller.grievance.mine({ token });
    const mineCase = mine.find((row) => row.id === opened.caseId)!;
    expect(mineCase).toMatchObject({ kind: "wage_dispute", status: "open" });

    // The employee can see their own thread.
    const thread = await caller.grievance.myCase({ token, caseId: opened.caseId });
    expect(thread.traineeName).toBe("Asha Patil");
    expect(thread.messages).toHaveLength(1);
    expect(thread.messages[0]).toMatchObject({ author: "employee" });

    // Staff reply, and the employee sees it.
    await caller.cases.reply({ caseId: opened.caseId, body: "Escalated to the employer's HR contact." });
    const afterReply = await caller.grievance.myCase({ token, caseId: opened.caseId });
    expect(afterReply.messages).toHaveLength(2);
    expect(afterReply.messages[1]).toMatchObject({ author: "staff" });

    await caller.cases.assign({ caseId: opened.caseId, assignedTo: "Counsellor Priya" });
    await caller.cases.resolve({ caseId: opened.caseId, note: "Employer settled the balance." });

    const resolved = await caller.grievance.myCase({ token, caseId: opened.caseId });
    expect(resolved.status).toBe("resolved");
  });

  it("support desk: district scoping and auth are enforced", { timeout: 30_000 }, async () => {
    const anonymous = appRouter.createCaller(makeContext(null));
    await expect(anonymous.cases.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(anonymous.benefits.schemes()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    // A forged portal token cannot open a grievance. Either rate-limiting or
    // token validation rejects it — both are a rejection (never a success).
    await expect(
      anonymous.grievance.open({
        token: "forged-token",
        kind: "grievance",
        subject: "nope",
        body: "nope",
      })
    ).rejects.toMatchObject({ code: expect.stringMatching(/^(NOT_FOUND|TOO_MANY_REQUESTS)$/) });

    // Pune-scoped staff only see Pune cases.
    const puneCases = await puneScope.cases.list({ status: "open" });
    expect(puneCases.every((row) => row.district === "Pune")).toBe(true);
  });
});