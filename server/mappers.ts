import { format } from "date-fns";
import type { FollowUpCase, SkillGap, Trainee } from "@shared/demoData";
import type { Trainee as DbTrainee } from "../drizzle/schema";
import type { DashboardSummary, ProviderScorecardRow } from "./queries";

const OUTCOME_MIX_META: Record<string, { label: string; color: string }> = {
  formal_employment: { label: "Formal employment", color: "#0f766e" },
  self_employment: { label: "Self-employment", color: "#c28b32" },
  apprenticeship: { label: "Apprenticeship", color: "#7c3aed" },
  seeking_work: { label: "Seeking work", color: "#e06b5f" },
  not_working: { label: "Not working", color: "#94a3b8" },
};

export function toOutcomeMix(
  rows: Array<{ outcomeType: string; count: number }>
): Array<{ label: string; value: number; color: string }> {
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return rows.map((row) => {
    const meta = OUTCOME_MIX_META[row.outcomeType] ?? {
      label: row.outcomeType,
      color: "#94a3b8",
    };
    return {
      label: meta.label,
      color: meta.color,
      value: total > 0 ? Math.round((row.count / total) * 100) : 0,
    };
  });
}

export function toRetentionSeries(
  series: DashboardSummary["retentionSeries"]
): Array<{ label: string; value: number }> {
  return series.map((point) => ({
    label: point.label,
    value: Math.round(point.value * 100),
  }));
}

export function toWageSeries(
  series: DashboardSummary["wageSeries"]
): Array<{ label: string; value: number | null }> {
  return series.map((point) => ({ label: point.label, value: point.value }));
}

// ---------------------------------------------------------------------------
// Relative date labels (demo vocabulary the screens already render)
// ---------------------------------------------------------------------------

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** Whole days from `from` to `to` (positive when `to` is later). */
function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / 86_400_000);
}

export function formatRelativeTimestamp(date: Date, now = new Date()): string {
  const daysAgo = daysBetween(date, now);
  if (daysAgo <= 0) return `Today, ${format(date, "HH:mm")}`;
  if (daysAgo === 1) return `Yesterday, ${format(date, "HH:mm")}`;
  return format(date, "d MMM yyyy");
}

export function formatDueLabel(dueAt: Date | null, now = new Date()): string {
  if (!dueAt) return "—";
  const daysUntil = daysBetween(now, dueAt);
  if (daysUntil <= 0) return "Today";
  if (daysUntil === 1) return "Tomorrow";
  return format(dueAt, "d MMM");
}

// ---------------------------------------------------------------------------
// Trainee list item (demo Trainee shape)
// ---------------------------------------------------------------------------

const LANGUAGE_LABELS: Record<string, Trainee["language"]> = {
  mr: "Marathi",
  hi: "Hindi",
  en: "English",
};

const STATUS_COLORS: Record<string, Trainee["statusColor"]> = {
  formal_employment: "violet",
  self_employment: "teal",
  apprenticeship: "amber",
  seeking_work: "rose",
  not_working: "rose",
};

export function toTraineeListItem(row: DbTrainee, now = new Date()): Trainee {
  return {
    id: row.slug,
    ref: row.traineeRef,
    name: row.displayName,
    initials: row.initials,
    district: row.district,
    provider: row.provider,
    course: row.course,
    cohort: row.cohort,
    language: LANGUAGE_LABELS[row.preferredLanguage] ?? "Marathi",
    status: row.outcomeType,
    statusLabel: row.outcomeLabel,
    statusColor: STATUS_COLORS[row.outcomeType] ?? "slate",
    outcomeStatus: row.outcomeStatus,
    wageBand: row.wageBand ?? "—",
    relevance: row.relevance ?? 0,
    retentionDays: row.retentionDays,
    lastUpdated: formatRelativeTimestamp(row.lastUpdated, now),
    barrier: row.barrier ?? undefined,
    consent: row.consentStatus,
  };
}

// ---------------------------------------------------------------------------
// Dashboard summary (demo metrics/district shapes)
// ---------------------------------------------------------------------------

const pct = (share: number) => `${(share * 100).toFixed(1)}%`;

const changeLabel = (value: number | null) =>
  value === null ? "—" : `${value >= 0 ? "+" : ""}${(value * 100).toFixed(1)}%`;

export function toDashboardMetrics(summary: DashboardSummary) {
  return {
    activeTrainees: summary.activeTrainees.toLocaleString("en-IN"),
    verifiedEmployment: pct(summary.verifiedEmploymentShare),
    retention90: pct(summary.retention90Share),
    wageProgression: changeLabel(summary.wageProgressionShare),
    freshness: Math.round(summary.freshnessShare * 100),
    responseRate: pct(summary.responseRate),
  };
}

export function toDistrictPerformance(
  districts: DashboardSummary["districts"]
): Array<{ district: string; completion: number; verified: number; retention: number; change: string }> {
  return districts.map((row) => ({
    district: row.district,
    completion: row.completions,
    verified: Math.round(row.verifiedShare * 100),
    retention: Math.round(row.retentionShare * 100),
    change: changeLabel(row.wageChange),
  }));
}

// ---------------------------------------------------------------------------
// Follow-up queue (demo FollowUpCase shape)
// ---------------------------------------------------------------------------

const CHANNEL_LABELS: Record<string, FollowUpCase["channel"]> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  call: "Call",
};

type FollowUpQueueRow = {
  id: number;
  traineeSlug: string;
  priority: FollowUpCase["priority"];
  title: string;
  reason: string | null;
  nextAction: string;
  channel: string;
  assignedTo: string | null;
  dueAt: Date | null;
};

export function toFollowUpCase(row: FollowUpQueueRow, now = new Date()): FollowUpCase {
  return {
    id: `case-${row.id}`,
    traineeId: row.traineeSlug,
    priority: row.priority,
    title: row.title,
    reason: row.reason ?? "",
    nextAction: row.nextAction,
    channel: CHANNEL_LABELS[row.channel.toLowerCase()] ?? "WhatsApp",
    due: formatDueLabel(row.dueAt, now),
    assigned: row.assignedTo ?? "Unassigned",
  };
}

// ---------------------------------------------------------------------------
// Skill gaps (demo SkillGap shape; barrier → intervention playbook)
// ---------------------------------------------------------------------------

const GAP_PLAYBOOK: Record<string, { action: string; owner: string }> = {
  "Digital diagnostics": { action: "Add a 12-hour practical module", owner: "Curriculum team" },
  "Interview readiness": { action: "Launch employer-led mock interviews", owner: "District officers" },
  "Market access": { action: "Connect to local marketplaces", owner: "Enterprise cell" },
};

export type SkillGapRow = {
  barrier: string | null;
  districts: string[];
  affected: number;
  seeking: number;
  total: number;
};

export function buildSkillGaps(rows: SkillGapRow[]): SkillGap[] {
  return rows.map((row, index) => {
    const barrier = row.barrier ?? "Unknown";
    const share = row.total > 0 ? row.affected / row.total : 0;
    const severity: SkillGap["severity"] =
      share >= 0.3 ? "High" : share >= 0.15 ? "Medium" : "Watch";
    const playbook = GAP_PLAYBOOK[barrier] ?? {
      action: "Review barrier in the next district review",
      owner: "District officers",
    };
    return {
      id: `gap-${index + 1}`,
      skill: barrier,
      locations: row.districts.join(" · "),
      affected: row.total > 0 ? `${Math.round(share * 100)}% of trainees` : "No signals",
      evidence: `${row.affected} trainee signals · ${row.seeking} seeking work`,
      severity,
      action: playbook.action,
      owner: playbook.owner,
      affectedCount: row.affected,
    };
  });
}

// ---------------------------------------------------------------------------
// Cohort performance (Cohorts explorer table)
// ---------------------------------------------------------------------------

export type CohortRow = {
  cohort: string;
  provider: string;
  course: string;
  district: string;
  completed: number;
  verified: number;
  employed: number;
  retained90: number;
  relevance: number | null;
  barrier: string | null;
  covered: number;
};

export function toCohortPerformance(rows: CohortRow[]) {
  return rows.map((row) => {
    const pct = (part: number) =>
      row.completed > 0 ? Math.round((part / row.completed) * 100) : 0;
    const playbook = row.barrier
      ? (GAP_PLAYBOOK[row.barrier] ?? {
          action: "Review barrier in the next district review",
        })
      : { action: "Maintain follow-up cadence" };
    return {
      cohort: row.cohort,
      provider: row.provider,
      course: row.course,
      district: row.district,
      completed: row.completed,
      coverage: pct(row.covered),
      verified: pct(row.verified),
      retention: pct(row.retained90),
      relevance: row.relevance !== null ? Math.round(row.relevance * 10) / 10 : 0,
      barrier: row.barrier ?? "No signals",
      action: playbook.action,
    };
  });
}

// ---------------------------------------------------------------------------
// Message activity (FollowUps screen)
// ---------------------------------------------------------------------------

export type MessageJobRow = {
  id: number;
  channel: "whatsapp" | "sms";
  templateCode: string;
  status: "queued" | "accepted" | "delivered" | "read" | "failed" | "undelivered";
  providerMessageId: string | null;
  scheduledAt: Date;
  traineeRef: string;
};

const ACTIVITY_TONES: Record<MessageJobRow["status"], "teal" | "amber" | "rose"> = {
  queued: "amber",
  accepted: "teal",
  delivered: "teal",
  read: "teal",
  failed: "rose",
  undelivered: "rose",
};

export function toMessageActivity(rows: MessageJobRow[]) {
  return rows.map((row) => ({
    id: row.id,
    channel: row.channel,
    status: row.status,
    templateCode: row.templateCode,
    traineeRef: row.traineeRef,
    date: format(row.scheduledAt, "d MMM · HH:mm"),
    tone: ACTIVITY_TONES[row.status],
  }));
}

// ---------------------------------------------------------------------------
// Evidence summary (TraineeJourney "Evidence confidence" card)
// ---------------------------------------------------------------------------

const EMPLOYED_OUTCOMES = ["formal_employment", "self_employment", "apprenticeship"];

export type EvidenceSummaryRow = {
  outcomeType: string;
  outcomeStatus: "verified" | "self_reported" | "pending";
  evidenceConfidence: string | null;
  source: string;
  supersedesEventId: number | null;
};

export type EvidenceSummary = {
  confidence: number;
  percent: number;
  label: string;
  tone: "teal" | "amber" | "neutral";
  signals: Array<{ label: string; state: "confirmed" | "pending"; detail: string }>;
};

/**
 * Turns the append-only outcome chain into an explainable evidence readout.
 * Confidence is the event's own stored value (never a UI constant), and every
 * contributing signal is shown with the fact that produced it.
 */
export function buildEvidenceSummary(input: {
  outcomeStatus: "verified" | "self_reported" | "pending";
  lastUpdated: Date;
  outcomeEvents: EvidenceSummaryRow[];
  now?: Date;
}): EvidenceSummary {
  const now = input.now ?? new Date();
  const chain = [...input.outcomeEvents];
  const active = chain.filter((event) => event.supersedesEventId !== null || chain.length === 1).pop() ?? chain[chain.length - 1];
  const confidence = active?.evidenceConfidence ? Number(active.evidenceConfidence) : 0.5;
  const employerConfirmed = chain.some((event) => event.source === "employer_verification");
  const hasSelfReport = chain.some((event) => event.source === "trainee_mobile");
  const hasConflict = chain.length > 1 && !employerConfirmed;
  const daysSinceUpdate = Math.max(
    0,
    Math.round((now.getTime() - input.lastUpdated.getTime()) / 86_400_000)
  );

  return {
    confidence,
    percent: Math.round(confidence * 100),
    label: input.outcomeStatus.replace("_", " "),
    tone:
      input.outcomeStatus === "verified" ? "teal" : input.outcomeStatus === "pending" ? "amber" : "neutral",
    signals: [
      {
        label: "Self-report captured",
        state: hasSelfReport ? "confirmed" : "pending",
        detail: hasSelfReport ? "Trainee pulse recorded" : "No trainee pulse on record",
      },
      {
        label: "Employer confirmation",
        state: employerConfirmed ? "confirmed" : "pending",
        detail: employerConfirmed
          ? "Verified through a signed employer link"
          : "Awaiting employer verification",
      },
      {
        label: "Evidence freshness",
        state: daysSinceUpdate <= 90 ? "confirmed" : "pending",
        detail: daysSinceUpdate === 0 ? "Updated today" : `Updated ${daysSinceUpdate} days ago`,
      },
      ...(hasConflict
        ? [
            {
              label: "Superseded pulses",
              state: "pending" as const,
              detail: `${chain.length - 1} earlier pulse(s) remain in the append-only chain`,
            },
          ]
        : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Next best action (TraineeJourney recommendation card)
// ---------------------------------------------------------------------------

export type NextBestAction = {
  title: string;
  rationale: string;
  owner: string;
};

/**
 * Rule-based recommendation derived from the barrier signal, outcome state and
 * evidence level. Deterministic and explainable — no black-box ranking.
 */
export function nextBestActionFor(input: {
  outcomeType: string;
  outcomeStatus: "verified" | "self_reported" | "pending";
  barrier: string | null;
  relevance: number | null;
  retentionDays: number;
  hasOpenCase: boolean;
}): NextBestAction {
  if (input.outcomeType === "not_working" || input.outcomeType === "seeking_work") {
    return {
      title: "Re-engage and match to open roles",
      rationale: "The trainee is not currently in work, so placement support has the highest expected value.",
      owner: "Placement cell",
    };
  }
  if (input.barrier === "Transport cost") {
    return {
      title: "Connect to nearby employers and transport support",
      rationale: "Transport cost was reported as the binding barrier on the latest pulse.",
      owner: "District officers",
    };
  }
  if (input.barrier === "Role mismatch") {
    return {
      title: "Invite the trainee to a course relevance interview",
      rationale: "The reported role does not match the completed course, so relevance needs review.",
      owner: "Curriculum team",
    };
  }
  if (input.relevance !== null && input.relevance <= 2) {
    return {
      title: "Offer upskilling in the adjacent trade",
      rationale: `The trainee rated role relevance ${input.relevance}/5, which predicts early exit.`,
      owner: "Curriculum team",
    };
  }
  // An evidence gap outranks a nice-to-have: an unverified claim is a
  // data-quality problem the dashboard depends on.
  if (input.outcomeStatus === "pending") {
    return {
      title: "Send an employer verification link",
      rationale: "The reported outcome still lacks employer evidence.",
      owner: "Counsellor",
    };
  }
  if (input.retentionDays >= 90 && input.relevance !== null && input.relevance >= 4) {
    return {
      title: "Invite the trainee to mentor new graduates",
      rationale: `${input.retentionDays} days of retention with relevance ${input.relevance}/5 makes them a credible peer mentor.`,
      owner: "Alumni cell",
    };
  }
  return {
    title: input.hasOpenCase ? "Continue the open counsellor case" : "Keep the standard follow-up cadence",
    rationale: input.hasOpenCase
      ? "An open case already owns this trainee, so no second action is needed."
      : "Outcome is stable and evidence is current; the next checkpoint is sufficient.",
    owner: "Counsellor",
  };
}

// ---------------------------------------------------------------------------
// Attrition-risk flags (explainable watchlist)
// ---------------------------------------------------------------------------

export type RiskFlag = {
  code: string;
  label: string;
  detail: string;
  weight: number;
  severity: "high" | "medium" | "watch";
};

export function buildRiskFlags(input: {
  outcomeType: string;
  relevance: number | null;
  retentionDays: number;
  barrier: string | null;
  daysSinceUpdate: number;
  unansweredReminders: number;
  previousWageMidpoint: number | null;
  currentWageMidpoint: number | null;
}) {
  const flags: RiskFlag[] = [];
  const employed = EMPLOYED_OUTCOMES.includes(input.outcomeType);

  if (input.relevance !== null && input.relevance <= 2) {
    flags.push({
      code: "low_relevance",
      label: "Low role relevance",
      detail: `Rated ${input.relevance}/5 — roles below 3 historically exit early.`,
      weight: 3,
      severity: "high",
    });
  }
  if (employed && input.retentionDays < 90) {
    flags.push({
      code: "early_tenure",
      label: "Within the 90-day risk window",
      detail: `Only ${input.retentionDays} days of tenure so far.`,
      weight: 2,
      severity: "medium",
    });
  }
  if (input.barrier) {
    flags.push({
      code: "barrier_reported",
      label: "Open barrier signal",
      detail: `${input.barrier} reported on the latest pulse.`,
      weight: 2,
      severity: "medium",
    });
  }
  if (input.unansweredReminders >= 2) {
    flags.push({
      code: "silent_after_reminders",
      label: "Silent after reminders",
      detail: `${input.unansweredReminders} reminders sent with no reply.`,
      weight: 2,
      severity: "medium",
    });
  }
  if (input.daysSinceUpdate > 120) {
    flags.push({
      code: "stale_evidence",
      label: "Evidence is stale",
      detail: `No update for ${input.daysSinceUpdate} days.`,
      weight: 1,
      severity: "watch",
    });
  }
  if (
    input.previousWageMidpoint !== null &&
    input.currentWageMidpoint !== null &&
    input.currentWageMidpoint < input.previousWageMidpoint
  ) {
    flags.push({
      code: "wage_decline",
      label: "Wage band declined",
      detail: `Median band moved from ₹${input.previousWageMidpoint}k to ₹${input.currentWageMidpoint}k.`,
      weight: 3,
      severity: "high",
    });
  }

  const score = flags.reduce((sum, flag) => sum + flag.weight, 0);
  return {
    flags,
    score,
    level: score >= 5 ? ("high" as const) : score >= 3 ? ("medium" as const) : ("watch" as const),
  };
}

// ---------------------------------------------------------------------------
// Provider scorecards (public accountability page)
// ---------------------------------------------------------------------------

const MIN_PUBLISHABLE_SAMPLE = 10;

export function toProviderScorecard(row: ProviderScorecardRow) {
  const publishable = row.completed >= MIN_PUBLISHABLE_SAMPLE;
  return {
    provider: row.provider,
    slug: row.provider
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    completed: row.completed,
    published: publishable,
    suppressionNote: publishable
      ? null
      : `Cohort below ${MIN_PUBLISHABLE_SAMPLE} completions — figures suppressed for privacy.`,
    verified: publishable ? Math.round(row.verified * 100) : null,
    retention: publishable ? Math.round(row.retention * 100) : null,
    relevance: publishable && row.relevance !== null ? Math.round(row.relevance * 10) / 10 : null,
    districts: row.districts,
  };
}
