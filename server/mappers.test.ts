import { describe, expect, it } from "vitest";
import type { Trainee as DbTrainee } from "../drizzle/schema";
import {
  buildSkillGaps,
  formatDueLabel,
  formatRelativeTimestamp,
  toDashboardMetrics,
  toFollowUpCase,
  toTraineeListItem,
} from "./mappers";
import type { DashboardSummary } from "./queries";

const NOW = new Date(2026, 8, 11, 12, 0); // 11 Sep 2026 noon

function makeTrainee(overrides: Partial<DbTrainee> = {}): DbTrainee {
  return {
    id: 1,
    traineeRef: "SKL-7F4K2M",
    slug: "asha-patil",
    displayName: "Asha Patil",
    initials: "AP",
    district: "Pune",
    provider: "Udyogini Skills Centre",
    course: "Advanced Tailoring & Boutique",
    cohort: "PUN-TLR-24",
    preferredLanguage: "mr",
    outcomeType: "self_employment",
    outcomeLabel: "Self-employed",
    outcomeStatus: "verified",
    wageBand: "₹20k–₹29k",
    relevance: 5,
    retentionDays: 214,
    barrier: "Market access",
    consentStatus: "active",
    lastUpdated: new Date(2026, 8, 11, 9, 42),
    createdAt: new Date(2025, 9, 1),
    ...overrides,
  };
}

describe("formatRelativeTimestamp", () => {
  it("labels today, yesterday, and older dates", () => {
    expect(formatRelativeTimestamp(new Date(2026, 8, 11, 9, 42), NOW)).toBe("Today, 09:42");
    expect(formatRelativeTimestamp(new Date(2026, 8, 10, 16, 10), NOW)).toBe("Yesterday, 16:10");
    expect(formatRelativeTimestamp(new Date(2026, 7, 18, 10, 0), NOW)).toBe("18 Aug 2026");
  });
});

describe("formatDueLabel", () => {
  it("labels due dates relative to today", () => {
    expect(formatDueLabel(new Date(2026, 8, 11), NOW)).toBe("Today");
    expect(formatDueLabel(new Date(2026, 8, 12), NOW)).toBe("Tomorrow");
    expect(formatDueLabel(new Date(2026, 8, 16), NOW)).toBe("16 Sep");
    expect(formatDueLabel(null, NOW)).toBe("—");
  });
});

describe("toTraineeListItem", () => {
  it("maps a database row into the screen-facing shape", () => {
    const item = toTraineeListItem(makeTrainee(), NOW);
    expect(item).toMatchObject({
      id: "asha-patil",
      ref: "SKL-7F4K2M",
      name: "Asha Patil",
      language: "Marathi",
      status: "self_employment",
      statusLabel: "Self-employed",
      statusColor: "teal",
      outcomeStatus: "verified",
      wageBand: "₹20k–₹29k",
      barrier: "Market access",
      consent: "active",
      lastUpdated: "Today, 09:42",
    });
  });

  it("fills presentation defaults for sparse rows", () => {
    const item = toTraineeListItem(
      makeTrainee({
        slug: "farhan-khan",
        displayName: "Farhan Khan",
        preferredLanguage: "hi",
        outcomeType: "seeking_work",
        outcomeLabel: "Looking for work",
        wageBand: null,
        relevance: null,
        barrier: null,
      }),
      NOW
    );
    expect(item.language).toBe("Hindi");
    expect(item.statusColor).toBe("rose");
    expect(item.wageBand).toBe("—");
    expect(item.relevance).toBe(0);
    expect(item.barrier).toBeUndefined();
  });
});

describe("toFollowUpCase", () => {
  it("maps queue rows with channel and due labels", () => {
    const item = toFollowUpCase(
      {
        id: 1,
        traineeSlug: "imran-shaikh",
        priority: "P1",
        title: "Recent job loss",
        reason: "Employment ended after 35 days",
        nextAction: "Connect with nearby solar employers",
        channel: "whatsapp",
        assignedTo: "Neha Kulkarni",
        dueAt: new Date(2026, 8, 11, 17, 0),
      },
      NOW
    );
    expect(item).toEqual({
      id: "case-1",
      traineeId: "imran-shaikh",
      priority: "P1",
      title: "Recent job loss",
      reason: "Employment ended after 35 days",
      nextAction: "Connect with nearby solar employers",
      channel: "WhatsApp",
      due: "Today",
      assigned: "Neha Kulkarni",
    });
  });

  it("defaults unassigned counsellors and unknown channels", () => {
    const item = toFollowUpCase(
      {
        id: 9,
        traineeSlug: "ravi-more",
        priority: "P4",
        title: "Check-in",
        reason: null,
        nextAction: "Call trainee",
        channel: "telepathy",
        assignedTo: null,
        dueAt: null,
      },
      NOW
    );
    expect(item.assigned).toBe("Unassigned");
    expect(item.channel).toBe("WhatsApp");
    expect(item.due).toBe("—");
    expect(item.reason).toBe("");
  });
});

describe("buildSkillGaps", () => {
  it("assigns severity from the affected share and maps the playbook", () => {
    const gaps = buildSkillGaps([
      { barrier: "Interview readiness", districts: ["Pune", "Nagpur"], affected: 3, seeking: 3, total: 10 },
      { barrier: "Market access", districts: ["Pune"], affected: 2, seeking: 0, total: 10 },
      { barrier: "Transport cost", districts: ["Nashik"], affected: 1, seeking: 1, total: 10 },
    ]);

    expect(gaps[0].severity).toBe("High");
    expect(gaps[0].action).toBe("Launch employer-led mock interviews");
    expect(gaps[0].locations).toBe("Pune · Nagpur");
    expect(gaps[1].severity).toBe("Medium");
    expect(gaps[2].severity).toBe("Watch");
    expect(gaps[2].action).toBe("Review barrier in the next district review");
  });
});

describe("toDashboardMetrics", () => {
  it("formats shares as demo-style strings", () => {
    const summary = {
      activeTrainees: 6,
      verifiedEmploymentShare: 0.684,
      retention90Share: 0.618,
      wageProgressionShare: 0.182,
      freshnessShare: 0.81,
      responseRate: 0.742,
    } as DashboardSummary;

    expect(toDashboardMetrics(summary)).toEqual({
      activeTrainees: "6",
      verifiedEmployment: "68.4%",
      retention90: "61.8%",
      wageProgression: "+18.2%",
      freshness: 81,
      responseRate: "74.2%",
    });
  });
});
