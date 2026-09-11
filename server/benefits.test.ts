import { describe, expect, it, vi } from "vitest";
import { evaluateBenefitEligibility } from "./benefits";

// No database is touched by the matcher, but the module imports ./queries.
vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  closeDb: vi.fn(async () => {}),
  upsertUser: vi.fn(async () => {}),
  getUserByOpenId: vi.fn(async () => undefined),
}));

const base = {
  traineeId: 1,
  district: "Pune",
  outcomeType: "self_employment",
  wageMidpoint: 24.5,
  retentionDays: 214,
  courses: ["Advanced Tailoring & Boutique"],
};

describe("benefit eligibility matcher", () => {
  it("an empty rule set matches everyone", () => {
    const result = evaluateBenefitEligibility(base, {});
    expect(result.eligible).toBe(true);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ met: true });
  });

  it("district scope excludes other districts", () => {
    const result = evaluateBenefitEligibility(base, { districts: ["Nashik"] });
    expect(result.eligible).toBe(false);
    expect(result.checks[0]).toMatchObject({ met: false });
  });

  it("outcome type must align", () => {
    expect(evaluateBenefitEligibility(base, { outcomeTypes: ["apprenticeship"] }).eligible).toBe(false);
    expect(evaluateBenefitEligibility(base, { outcomeTypes: ["self_employment"] }).eligible).toBe(true);
  });

  it("course matching is case-insensitive and partial", () => {
    expect(evaluateBenefitEligibility(base, { requiredCourses: ["tailoring"] }).eligible).toBe(true);
    expect(evaluateBenefitEligibility(base, { requiredCourses: ["Welding"] }).eligible).toBe(false);
  });

  it("wage threshold rejects a missing or lower band", () => {
    expect(evaluateBenefitEligibility(base, { minWageMidpoint: 20 }).eligible).toBe(true);
    expect(evaluateBenefitEligibility({ ...base, wageMidpoint: 14.5 }, { minWageMidpoint: 20 }).eligible).toBe(false);
    expect(evaluateBenefitEligibility({ ...base, wageMidpoint: null }, { minWageMidpoint: 20 }).eligible).toBe(false);
  });

  it("retention window is enforced", () => {
    expect(evaluateBenefitEligibility(base, { minRetentionDays: 180 }).eligible).toBe(true);
    expect(evaluateBenefitEligibility({ ...base, retentionDays: 35 }, { minRetentionDays: 180 }).eligible).toBe(false);
  });

  it("all failing checks are reported at once, in rule order", () => {
    const result = evaluateBenefitEligibility(
      { ...base, district: "Nashik", wageMidpoint: null },
      { districts: ["Pune"], minWageMidpoint: 20 }
    );
    expect(result.eligible).toBe(false);
    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((check) => !check.met)).toBe(true);
  });
});