import { describe, expect, it } from "vitest";
import { buildTimeline, outcomeLabelFor, wageBandMidpoint } from "./queries";

describe("wageBandMidpoint", () => {
  it("averages the band endpoints", () => {
    expect(wageBandMidpoint("₹10k–₹19k")).toBe(14.5);
    expect(wageBandMidpoint("₹20k–₹29k")).toBe(24.5);
  });

  it("handles open-ended bands", () => {
    expect(wageBandMidpoint("₹30k+")).toBe(30);
  });

  it("returns null for missing or non-numeric bands", () => {
    expect(wageBandMidpoint(null)).toBeNull();
    expect(wageBandMidpoint("—")).toBeNull();
    expect(wageBandMidpoint(undefined)).toBeNull();
  });
});

describe("outcomeLabelFor", () => {
  it("labels every outcome type", () => {
    expect(outcomeLabelFor("formal_employment")).toBe("Employed");
    expect(outcomeLabelFor("self_employment")).toBe("Self-employed");
    expect(outcomeLabelFor("apprenticeship")).toBe("Apprentice");
    expect(outcomeLabelFor("seeking_work")).toBe("Looking for work");
    expect(outcomeLabelFor("not_working")).toBe("Seeking work");
  });
});

describe("buildTimeline", () => {
  const jan = (day: number) => new Date(2026, 0, day);
  const feb = (day: number) => new Date(2026, 1, day);
  const jul = (day: number) => new Date(2026, 6, day);

  it("orders training, outcomes, and support events chronologically", () => {
    const timeline = buildTimeline({
      trainingRecords: [
        {
          course: "Solar PV Technician",
          attendanceRate: "88.00",
          certificationStatus: "certified",
          completionDate: jan(10),
        },
      ],
      outcomeEvents: [
        {
          id: 2,
          outcomeType: "not_working",
          state: "active",
          effectiveStartDate: jul(1),
          effectiveEndDate: null,
          roleCategory: null,
          industry: null,
          wageBand: null,
          source: "trainee_mobile",
        },
        {
          id: 1,
          outcomeType: "formal_employment",
          state: "ended",
          effectiveStartDate: jan(22),
          effectiveEndDate: feb(26),
          roleCategory: "Solar installation assistant",
          industry: "Renewable energy",
          wageBand: "₹10k–₹19k",
          source: "trainee_mobile",
        },
      ],
      counsellorCases: [
        { title: "Recent job loss", reason: "Employment ended", createdAt: jul(5) },
      ],
    });

    expect(timeline.map((event) => event.title)).toEqual([
      "Course completed",
      "Started formal employment",
      "Employment ended",
      "Not working",
      "Recent job loss",
    ]);
    expect(timeline[0].kind).toBe("training");
    expect(timeline[1].tone).toBe("violet");
    expect(timeline[2].tone).toBe("rose");
    expect(timeline[4].kind).toBe("support");
  });

  it("marks employer-verified events as verifications", () => {
    const timeline = buildTimeline({
      trainingRecords: [],
      outcomeEvents: [
        {
          id: 7,
          outcomeType: "formal_employment",
          state: "active",
          effectiveStartDate: jul(1),
          effectiveEndDate: null,
          roleCategory: "Customer support associate",
          industry: "BPO",
          wageBand: "₹10k–₹19k",
          source: "employer_verification",
        },
      ],
      counsellorCases: [],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0].kind).toBe("verification");
    expect(timeline[0].tone).toBe("teal");
    expect(timeline[0].title).toBe("Employer confirmation received");
  });

  it("skips training records without a completion date", () => {
    const timeline = buildTimeline({
      trainingRecords: [
        {
          course: "Data Entry",
          attendanceRate: "96.00",
          certificationStatus: "certified",
          completionDate: null,
        },
      ],
      outcomeEvents: [],
      counsellorCases: [],
    });

    expect(timeline).toHaveLength(0);
  });
});
