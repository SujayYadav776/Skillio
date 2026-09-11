import { describe, expect, it } from "vitest";
import { canonicalEntryHash, type PassportEntryInput } from "./passport";

function entry(overrides: Partial<PassportEntryInput> = {}): PassportEntryInput {
  return {
    kind: "training",
    title: "CNC Machining",
    subtitle: "Pune Skill Institute · cohort 2026-A",
    startDate: new Date("2026-01-10T00:00:00.000Z"),
    endDate: new Date("2026-04-10T00:00:00.000Z"),
    district: "Pune",
    roleCategory: null,
    industry: null,
    wageBand: null,
    evidenceLevel: "verified",
    source: "training_register",
    sourceId: 1,
    displayOrder: 0,
    ...overrides,
  };
}

describe("canonicalEntryHash", () => {
  it("is 64 hex characters", () => {
    expect(canonicalEntryHash([entry()])).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores ordering and display position", () => {
    const a = entry({ sourceId: 1, displayOrder: 0 });
    const b = entry({ title: "Welding", sourceId: 2, displayOrder: 1 });
    expect(canonicalEntryHash([a, b])).toBe(canonicalEntryHash([b, a]));
    expect(canonicalEntryHash([a, b])).toBe(
      canonicalEntryHash([{ ...b, displayOrder: 9 }, { ...a, displayOrder: 4 }])
    );
  });

  it("changes when a claim's content changes", () => {
    const original = canonicalEntryHash([entry()]);
    expect(canonicalEntryHash([entry({ title: "Welding" })])).not.toBe(original);
    expect(canonicalEntryHash([entry({ evidenceLevel: "self_reported" })])).not.toBe(original);
    expect(canonicalEntryHash([entry({ endDate: null })])).not.toBe(original);
  });

  it("is stable for an empty passport", () => {
    expect(canonicalEntryHash([])).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalEntryHash([])).toBe(canonicalEntryHash([]));
  });
});
