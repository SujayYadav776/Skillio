export type OutcomeType =
  | "formal_employment"
  | "self_employment"
  | "apprenticeship"
  | "seeking_work"
  | "not_working";

export type OutcomeStatus = "verified" | "self_reported" | "pending";

export type Trainee = {
  id: string;
  ref: string;
  name: string;
  initials: string;
  district: string;
  provider: string;
  course: string;
  cohort: string;
  language: "Marathi" | "Hindi" | "English";
  status: OutcomeType;
  statusLabel: string;
  statusColor: string;
  outcomeStatus: OutcomeStatus;
  wageBand: string;
  relevance: number;
  retentionDays: number;
  lastUpdated: string;
  barrier?: string;
  consent: "active" | "withdrawn" | "pending";
};

export type TimelineEvent = {
  id: string;
  date: string;
  title: string;
  description: string;
  kind: "training" | "outcome" | "verification" | "consent" | "support";
  tone: "teal" | "amber" | "rose" | "violet" | "slate";
};

export type FollowUpCase = {
  id: string;
  traineeId: string;
  priority: "P1" | "P2" | "P3" | "P4";
  title: string;
  reason: string;
  nextAction: string;
  channel: "WhatsApp" | "SMS" | "Call";
  due: string;
  assigned: string;
};

export type SkillGap = {
  id: string;
  skill: string;
  locations: string;
  affected: string;
  evidence: string;
  severity: "High" | "Medium" | "Watch";
  action: string;
  owner: string;
  /** Number of trainees behind the signal (omitted in static demo data). */
  affectedCount?: number;
};

export const districts = [
  "All districts",
  "Pune",
  "Nashik",
  "Nagpur",
  "Thane",
  "Chhatrapati Sambhajinagar",
];

export const trainees: Trainee[] = [
  {
    id: "asha-patil",
    ref: "SKL-7F4K2M",
    name: "Asha Patil",
    initials: "AP",
    district: "Pune",
    provider: "Udyogini Skills Centre",
    course: "Advanced Tailoring & Boutique",
    cohort: "PUN-TLR-24",
    language: "Marathi",
    status: "self_employment",
    statusLabel: "Self-employed",
    statusColor: "teal",
    outcomeStatus: "verified",
    wageBand: "₹20k–₹29k",
    relevance: 5,
    retentionDays: 214,
    lastUpdated: "Today, 09:42",
    barrier: "Market access",
    consent: "active",
  },
  {
    id: "imran-shaikh",
    ref: "SKL-1D8Q9P",
    name: "Imran Shaikh",
    initials: "IS",
    district: "Nashik",
    provider: "Maharashtra Electrical Academy",
    course: "Solar PV Technician",
    cohort: "NAS-SOL-24",
    language: "Hindi",
    status: "not_working",
    statusLabel: "Seeking work",
    statusColor: "rose",
    outcomeStatus: "self_reported",
    wageBand: "—",
    relevance: 4,
    retentionDays: 35,
    lastUpdated: "Yesterday, 16:10",
    barrier: "Transport cost",
    consent: "active",
  },
  {
    id: "sneha-jadhav",
    ref: "SKL-4M2V8A",
    name: "Sneha Jadhav",
    initials: "SJ",
    district: "Nagpur",
    provider: "Vidarbha Digital Futures",
    course: "Data Entry & Office Operations",
    cohort: "NAG-DIG-24",
    language: "Marathi",
    status: "formal_employment",
    statusLabel: "Employed",
    statusColor: "violet",
    outcomeStatus: "verified",
    wageBand: "₹10k–₹19k",
    relevance: 2,
    retentionDays: 96,
    lastUpdated: "12 Sep 2026",
    barrier: "Role mismatch",
    consent: "active",
  },
  {
    id: "ravi-more",
    ref: "SKL-8N1T6C",
    name: "Ravi More",
    initials: "RM",
    district: "Thane",
    provider: "Maharashtra Electrical Academy",
    course: "Industrial Wiring",
    cohort: "THN-ELE-24",
    language: "Marathi",
    status: "formal_employment",
    statusLabel: "Employed",
    statusColor: "teal",
    outcomeStatus: "pending",
    wageBand: "₹20k–₹29k",
    relevance: 4,
    retentionDays: 182,
    lastUpdated: "18 Aug 2026",
    barrier: "Stale follow-up",
    consent: "active",
  },
  {
    id: "meena-kale",
    ref: "SKL-3B6R5H",
    name: "Meena Kale",
    initials: "MK",
    district: "Chhatrapati Sambhajinagar",
    provider: "Udyogini Skills Centre",
    course: "Food Processing",
    cohort: "AUR-FOD-24",
    language: "Marathi",
    status: "apprenticeship",
    statusLabel: "Apprentice",
    statusColor: "amber",
    outcomeStatus: "self_reported",
    wageBand: "₹10k–₹19k",
    relevance: 4,
    retentionDays: 62,
    lastUpdated: "10 Sep 2026",
    consent: "active",
  },
  {
    id: "farhan-khan",
    ref: "SKL-9X5L3E",
    name: "Farhan Khan",
    initials: "FK",
    district: "Pune",
    provider: "Pune Mobility Institute",
    course: "EV Service Technician",
    cohort: "PUN-EV-24",
    language: "Hindi",
    status: "seeking_work",
    statusLabel: "Looking for work",
    statusColor: "rose",
    outcomeStatus: "self_reported",
    wageBand: "—",
    relevance: 3,
    retentionDays: 0,
    lastUpdated: "08 Sep 2026",
    barrier: "Interview readiness",
    consent: "active",
  },
];

export const timelineByTrainee: Record<string, TimelineEvent[]> = {
  "asha-patil": [
    { id: "a1", date: "15 Jan 2026", title: "Course completed", description: "Advanced Tailoring & Boutique · 92% attendance · certified", kind: "training", tone: "slate" },
    { id: "a2", date: "04 Feb 2026", title: "Started self-employment", description: "Opened a home-based tailoring service in Pune", kind: "outcome", tone: "teal" },
    { id: "a3", date: "12 Apr 2026", title: "First outcome pulse", description: "₹10k–₹19k monthly income · training relevance 5/5", kind: "outcome", tone: "violet" },
    { id: "a4", date: "18 Jul 2026", title: "Market access intervention", description: "Connected to a local women-led marketplace", kind: "support", tone: "amber" },
    { id: "a5", date: "Today", title: "Income progression confirmed", description: "Moved to ₹20k–₹29k band · 214 days active", kind: "verification", tone: "teal" },
  ],
  "imran-shaikh": [
    { id: "i1", date: "10 Jan 2026", title: "Course completed", description: "Solar PV Technician · 88% attendance · certified", kind: "training", tone: "slate" },
    { id: "i2", date: "22 Jan 2026", title: "Placed with SuryaGrid Services", description: "Solar installation assistant · ₹10k–₹19k", kind: "outcome", tone: "teal" },
    { id: "i3", date: "26 Feb 2026", title: "Employment ended", description: "Left after 35 days; transport cost reported as primary barrier", kind: "outcome", tone: "rose" },
    { id: "i4", date: "Yesterday", title: "Follow-up response received", description: "Would like a nearby employer referral", kind: "support", tone: "amber" },
  ],
  "sneha-jadhav": [
    { id: "s1", date: "01 Jun 2026", title: "Course completed", description: "Data Entry & Office Operations · 96% attendance", kind: "training", tone: "slate" },
    { id: "s2", date: "08 Jun 2026", title: "Placed with CityServe BPO", description: "Customer support associate · ₹10k–₹19k", kind: "outcome", tone: "violet" },
    { id: "s3", date: "12 Sep 2026", title: "Employer confirmation received", description: "Still employed; trainee reports role is not related to training", kind: "verification", tone: "amber" },
  ],
};

export const followUpCases: FollowUpCase[] = [
  { id: "case-1", traineeId: "imran-shaikh", priority: "P1", title: "Recent job loss", reason: "Employment ended after 35 days", nextAction: "Connect with nearby solar employers", channel: "WhatsApp", due: "Today", assigned: "Neha Kulkarni" },
  { id: "case-2", traineeId: "sneha-jadhav", priority: "P2", title: "Low training relevance", reason: "Reported relevance score of 2/5", nextAction: "Invite course review interview", channel: "Call", due: "Tomorrow", assigned: "Amit Deshmukh" },
  { id: "case-3", traineeId: "ravi-more", priority: "P2", title: "Verification pending", reason: "No update in 182 days", nextAction: "Send employer verification link", channel: "SMS", due: "Today", assigned: "Neha Kulkarni" },
  { id: "case-4", traineeId: "farhan-khan", priority: "P3", title: "Interview support requested", reason: "Looking for work; interview readiness barrier", nextAction: "Book mock interview slot", channel: "WhatsApp", due: "16 Sep", assigned: "Meera Joshi" },
];

export const skillGaps: SkillGap[] = [
  { id: "gap-1", skill: "Digital diagnostics", locations: "Pune · Nashik", affected: "34% of recent solar trainees", evidence: "18 trainee + 7 employer signals", severity: "High", action: "Add a 12-hour practical module", owner: "Curriculum team" },
  { id: "gap-2", skill: "Interview readiness", locations: "Pune · Nagpur", affected: "27% of job-seeking trainees", evidence: "43 follow-up responses", severity: "Medium", action: "Launch employer-led mock interviews", owner: "District officers" },
  { id: "gap-3", skill: "Market access", locations: "Pune · Aurangabad", affected: "21% of self-employed trainees", evidence: "31 trainee signals", severity: "Watch", action: "Connect to local marketplaces", owner: "Enterprise cell" },
];

export const dashboardMetrics = {
  activeTrainees: "12,486",
  verifiedEmployment: "68.4%",
  retention90: "61.8%",
  wageProgression: "+18.2%",
  freshness: 81,
  responseRate: "74.2%",
};

export const districtPerformance = [
  { district: "Pune", completion: 2380, verified: 74, retention: 68, change: "+6.4%" },
  { district: "Nashik", completion: 1840, verified: 69, retention: 63, change: "+2.1%" },
  { district: "Nagpur", completion: 2100, verified: 64, retention: 58, change: "-1.2%" },
  { district: "Thane", completion: 1960, verified: 71, retention: 65, change: "+4.8%" },
  { district: "Chhatrapati Sambhajinagar", completion: 1520, verified: 61, retention: 55, change: "+1.3%" },
];

export const outcomeMix = [
  { label: "Formal employment", value: 48, color: "#0f766e" },
  { label: "Self-employment", value: 16, color: "#c28b32" },
  { label: "Apprenticeship", value: 11, color: "#7c3aed" },
  { label: "Seeking work", value: 15, color: "#e06b5f" },
  { label: "Unknown", value: 10, color: "#94a3b8" },
];

export const retentionSeries = [
  { label: "30 days", value: 92 },
  { label: "90 days", value: 76 },
  { label: "180 days", value: 68 },
  { label: "365 days", value: 61 },
];

export const wageSeries = [
  { label: "At completion", value: 11.2 },
  { label: "90 days", value: 12.8 },
  { label: "180 days", value: 14.1 },
  { label: "Current", value: 15.7 },
];

export function getTrainee(id: string | undefined) {
  return trainees.find((trainee) => trainee.id === id) ?? trainees[0];
}

export function getTimeline(id: string | undefined) {
  return timelineByTrainee[id ?? ""] ?? [
    { id: "fallback-1", date: "18 Aug 2026", title: "Outcome record imported", description: "A new longitudinal record is ready for follow-up", kind: "outcome", tone: "slate" },
  ];
}
