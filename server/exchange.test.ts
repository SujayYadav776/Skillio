import { describe, expect, it } from "vitest";
import { scoreMatch } from "./exchange";

const trainee = {
  district: "Pune",
  course: "CNC Machining",
  wageBand: "₹10k–₹19k",
  barrier: null,
  relevance: 4,
  outcomeType: "seeking_work",
};

describe("scoreMatch", () => {
  it("rewards a same-district, same-trade posting that holds the wage band", () => {
    const match = scoreMatch(trainee, {
      district: "Pune",
      courseTags: ["CNC Machining"],
      wageBand: "₹20k–₹29k",
      roleCategory: "CNC Operator",
    });
    expect(match.score).toBe(100);
    expect(match.factors.map((factor) => factor.label)).toEqual(
      expect.arrayContaining(["Same district", "Course match", "No wage step down", "No open barrier"])
    );
  });

  it("penalises relocation and a different trade", () => {
    const match = scoreMatch(trainee, {
      district: "Nagpur",
      courseTags: ["Welding"],
      wageBand: "₹20k–₹29k",
      roleCategory: "Welder",
    });
    expect(match.score).toBeLessThan(50);
    expect(match.factors.map((factor) => factor.label)).toContain("Different trade");
  });

  it("distinguishes a minor from a significant wage step down", () => {
    // ₹11k–₹13k sits within 20% of the trainee's ₹14.5k mid-point; ₹<10k does not.
    const minor = scoreMatch(trainee, {
      district: "Pune",
      courseTags: ["CNC Machining"],
      wageBand: "₹11k–₹13k",
      roleCategory: "CNC Operator",
    });
    const severe = scoreMatch(trainee, {
      district: "Pune",
      courseTags: ["CNC Machining"],
      wageBand: "₹<10k",
      roleCategory: "Helper",
    });
    expect(minor.score).toBeGreaterThan(severe.score);
  });

  it("notes a barrier as a blocking factor", () => {
    const match = scoreMatch({ ...trainee, barrier: "Transport cost" }, {
      district: "Pune",
      courseTags: ["CNC Machining"],
      wageBand: "₹20k–₹29k",
      roleCategory: "CNC Operator",
    });
    const barrier = match.factors.find((factor) => factor.label === "Barrier present");
    expect(barrier?.points).toBe(0);
    expect(barrier?.detail).toContain("Transport cost");
  });

  it("is deterministic and never exceeds the cap", () => {
    const posting = {
      district: "Pune",
      courseTags: ["CNC Machining", "CNC Operator", "Machining"],
      wageBand: "₹30k+",
      roleCategory: "CNC Operator",
    };
    const first = scoreMatch(trainee, posting);
    const second = scoreMatch(trainee, posting);
    expect(first).toEqual(second);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.score).toBeGreaterThan(0);
  });

  it("explains an untagged posting instead of scoring it as a mismatch", () => {
    const match = scoreMatch(trainee, {
      district: "Pune",
      courseTags: [],
      wageBand: "₹20k–₹29k",
      roleCategory: "Trainee",
    });
    expect(match.factors.map((factor) => factor.label)).toContain("No course tags on the posting");
  });
});
