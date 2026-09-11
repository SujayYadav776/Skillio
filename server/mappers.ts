import { format } from "date-fns";
import type { FollowUpCase, SkillGap, Trainee } from "@shared/demoData";
import type { Trainee as DbTrainee } from "../drizzle/schema";
import type { DashboardSummary } from "./queries";

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
