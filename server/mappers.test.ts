import { describe, expect, it } from "vitest";
import type { Trainee as DbTrainee } from "../drizzle/schema";
import {
  buildEvidenceSummary,
  buildRiskFlags,
  buildSkillGaps,
  formatDueLabel,
  formatRelativeTimestamp,
  nextBestActionFor,
  toDashboardMetrics,
  toFollowUpCase,
  toProviderScorecard,
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

describe("buildEvidenceSummary", () => {
  const base = {
    outcomeStatus: "verified" as const,
    lastUpdated: NOW,
    outcomeEvents: [],
    now: NOW,
  };

  it("reads confidence from the stored event, never from a UI constant", () => {
    const summary = buildEvidenceSummary({
      ...base,
      outcomeEvents: [
        {
          outcomeType: "formal_employment",
          outcomeStatus: "verified",
          evidenceConfidence: "0.910",
          source: "employer_verification",
          supersedesEventId: null,
        },
      ],
    });
    expect(summary.percent).toBe(91);
    expect(summary.tone).toBe("teal");
  });

  it("marks a pending self-report and flags the superseded chain", () => {
    const summary = buildEvidenceSummary({
      ...base,
      outcomeStatus: "pending",
      outcomeEvents: [
        {
          outcomeType: "seeking_work",
          outcomeStatus: "pending",
          evidenceConfidence: "0.500",
          source: "trainee_mobile",
          supersedesEventId: null,
        },
        {
          outcomeType: "formal_employment",
          outcomeStatus: "pending",
          evidenceConfidence: "0.640",
          source: "trainee_mobile",
          supersedesEventId: 1,
        },
      ],
    });
    expect(summary.tone).toBe("amber");
    // No employer verification anywhere in the chain.
    expect(summary.signals.find((s) => s.label === "Employer confirmation")?.state).toBe("pending");
    expect(summary.signals.some((s) => s.label === "Superseded pulses")).toBe(true);
  });
});

describe("nextBestActionFor", () => {
  const base = {
    outcomeType: "formal_employment",
    outcomeStatus: "verified" as const,
    barrier: null,
    relevance: 5,
    retentionDays: 200,
    hasOpenCase: false,
  };

  it("prioritises placement support when the trainee is out of work", () => {
    expect(nextBestActionFor({ ...base, outcomeType: "seeking_work" }).owner).toBe("Placement cell");
  });

  it("routes the reported barrier to its owner", () => {
    expect(nextBestActionFor({ ...base, barrier: "Transport cost" }).owner).toBe("District officers");
    expect(nextBestActionFor({ ...base, barrier: "Role mismatch" }).owner).toBe("Curriculum team");
  });

  it("suggests upskilling on low relevance", () => {
    expect(nextBestActionFor({ ...base, relevance: 2 }).title).toContain("upskilling");
  });

  it("suggests mentorship for a long, relevant tenure", () => {
    expect(nextBestActionFor({ ...base, retentionDays: 120 }).owner).toBe("Alumni cell");
  });

  it("asks for employer evidence when the outcome is pending", () => {
    expect(nextBestActionFor({ ...base, outcomeStatus: "pending" }).title).toContain("verification link");
  });
});

describe("buildRiskFlags", () => {
  const base = {
    outcomeType: "formal_employment",
    relevance: 5,
    retentionDays: 200,
    barrier: null,
    daysSinceUpdate: 10,
    unansweredReminders: 0,
    previousWageMidpoint: 14.5,
    currentWageMidpoint: 14.5,
  };

  it("raises nothing for a healthy, current outcome", () => {
    expect(buildRiskFlags(base).flags).toEqual([]);
    expect(buildRiskFlags(base).level).toBe("watch");
  });

  it("names the fact behind every flag", () => {
    const risk = buildRiskFlags({
      ...base,
      relevance: 1,
      retentionDays: 30,
      barrier: "Transport cost",
      unansweredReminders: 2,
    });
    expect(risk.level).toBe("high");
    for (const flag of risk.flags) {
      expect(flag.detail.length).toBeGreaterThan(0);
      expect(flag.weight).toBeGreaterThan(0);
    }
    expect(risk.flags.map((f) => f.code)).toContain("silent_after_reminders");
  });

  it("detects a wage band decline", () => {
    const risk = buildRiskFlags({ ...base, previousWageMidpoint: 20, currentWageMidpoint: 12 });
    expect(risk.flags.map((f) => f.code)).toContain("wage_decline");
    expect(risk.score).toBeGreaterThanOrEqual(3);
  });
});

describe("toProviderScorecard", () => {
  it("suppresses figures below the privacy threshold", () => {
    const card = toProviderScorecard({
      provider: "Pune Skill Institute",
      districts: ["Pune"],
      completed: 4,
      verified: 0.5,
      retention: 0.5,
      relevance: 4,
    });
    expect(card.published).toBe(false);
    expect(card.verified).toBeNull();
    expect(card.suppressionNote).toContain("suppressed");
    expect(card.slug).toBe("pune-skill-institute");
  });

  it("publishes rounded figures at or above the threshold", () => {
    const card = toProviderScorecard({
      provider: "Nashik ITI",
      districts: ["Nashik", "Pune"],
      completed: 24,
      verified: 0.625,
      retention: 0.5,
      relevance: 3.94,
    });
    expect(card.published).toBe(true);
    expect(card.verified).toBe(63);
    expect(card.retention).toBe(50);
    expect(card.relevance).toBe(3.9);
    expect(card.suppressionNote).toBeNull();
  });
});
