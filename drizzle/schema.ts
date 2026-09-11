import {
  pgTable,
  pgEnum,
  serial,
  integer,
  varchar,
  text,
  timestamp,
  numeric,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const outcomeTypeEnum = pgEnum("outcome_type", [
  "formal_employment",
  "self_employment",
  "apprenticeship",
  "seeking_work",
  "not_working",
]);
export const outcomeStatusEnum = pgEnum("outcome_status", ["verified", "self_reported", "pending"]);
export const consentStatusEnum = pgEnum("consent_status", ["active", "withdrawn", "pending"]);
export const consentStateEnum = pgEnum("consent_state", ["granted", "withdrawn", "expired", "superseded"]);
export const outcomeStateEnum = pgEnum("outcome_state", [
  "reported",
  "active",
  "ended",
  "disputed",
  "superseded",
]);
export const preferredChannelEnum = pgEnum("preferred_channel", ["whatsapp", "sms", "call"]);
export const followUpStatusEnum = pgEnum("follow_up_status", [
  "scheduled",
  "queued",
  "sent",
  "completed",
  "declined",
  "failed",
  "expired",
  "cancelled",
]);
export const messageChannelEnum = pgEnum("message_channel", ["whatsapp", "sms"]);
export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  "accepted",
  "delivered",
  "read",
  "failed",
  "undelivered",
]);
export const casePriorityEnum = pgEnum("case_priority", ["P1", "P2", "P3", "P4"]);
export const caseStatusEnum = pgEnum("case_status", ["open", "assigned", "resolved", "snoozed"]);
export const documentKindEnum = pgEnum("document_kind", [
  "certificate",
  "payslip",
  "id_document",
  "other",
]);

// openId stores the Supabase auth user id (uuid).
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: userRoleEnum("role").default("user").notNull(),
  // Staff district scope; null means all districts (admins / unscoped staff).
  district: varchar("district", { length: 96 }),
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull(),
});

export const trainees = pgTable(
  "trainees",
  {
    id: serial("id").primaryKey(),
    traineeRef: varchar("traineeRef", { length: 32 }).notNull().unique(),
    slug: varchar("slug", { length: 64 }).notNull().unique(),
    displayName: varchar("displayName", { length: 160 }).notNull(),
    initials: varchar("initials", { length: 4 }).notNull(),
    district: varchar("district", { length: 96 }).notNull(),
    provider: varchar("provider", { length: 160 }).notNull(),
    course: varchar("course", { length: 160 }).notNull(),
    cohort: varchar("cohort", { length: 48 }).notNull(),
    preferredLanguage: varchar("preferredLanguage", { length: 16 }).default("mr").notNull(),
    outcomeType: outcomeTypeEnum("outcomeType").notNull(),
    outcomeLabel: varchar("outcomeLabel", { length: 64 }).notNull(),
    outcomeStatus: outcomeStatusEnum("outcomeStatus").default("self_reported").notNull(),
    wageBand: varchar("wageBand", { length: 64 }),
    relevance: integer("relevance"),
    retentionDays: integer("retentionDays").default(0).notNull(),
    barrier: varchar("barrier", { length: 128 }),
    // Channel address used only for messaging delivery; never rendered in the UI.
    contactPhone: varchar("contactPhone", { length: 32 }),
    consentStatus: consentStatusEnum("consentStatus").default("pending").notNull(),
    lastUpdated: timestamp("lastUpdated", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("trainees_district_idx").on(table.district)]
);

export const consentGrants = pgTable(
  "consentGrants",
  {
    id: serial("id").primaryKey(),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    purposeCode: varchar("purposeCode", { length: 64 }).notNull(),
    status: consentStateEnum("status").notNull(),
    noticeVersion: varchar("noticeVersion", { length: 32 }).notNull(),
    languageCode: varchar("languageCode", { length: 16 }).notNull(),
    channel: varchar("channel", { length: 32 }).notNull(),
    grantedAt: timestamp("grantedAt", { withTimezone: true }),
    withdrawnAt: timestamp("withdrawnAt", { withTimezone: true }),
    expiresAt: timestamp("expiresAt", { withTimezone: true }),
    receiptHash: varchar("receiptHash", { length: 128 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("consent_grants_trainee_idx").on(table.traineeId)]
);

export const trainingRecords = pgTable(
  "trainingRecords",
  {
    id: serial("id").primaryKey(),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    provider: varchar("provider", { length: 160 }).notNull(),
    course: varchar("course", { length: 160 }).notNull(),
    cohort: varchar("cohort", { length: 48 }).notNull(),
    enrolmentDate: timestamp("enrolmentDate", { withTimezone: true }),
    completionDate: timestamp("completionDate", { withTimezone: true }),
    attendanceRate: numeric("attendanceRate", { precision: 5, scale: 2 }),
    assessmentScore: numeric("assessmentScore", { precision: 5, scale: 2 }),
    certificationStatus: varchar("certificationStatus", { length: 32 }),
    sourceSystem: varchar("sourceSystem", { length: 96 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("training_records_trainee_idx").on(table.traineeId)]
);

export const outcomeEvents = pgTable(
  "outcomeEvents",
  {
    id: serial("id").primaryKey(),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    outcomeType: varchar("outcomeType", { length: 64 }).notNull(),
    state: outcomeStateEnum("state").default("reported").notNull(),
    effectiveStartDate: timestamp("effectiveStartDate", { withTimezone: true }),
    effectiveEndDate: timestamp("effectiveEndDate", { withTimezone: true }),
    roleCategory: varchar("roleCategory", { length: 120 }),
    industry: varchar("industry", { length: 120 }),
    wageBand: varchar("wageBand", { length: 64 }),
    relevanceRating: integer("relevanceRating"),
    source: varchar("source", { length: 64 }).notNull(),
    evidenceConfidence: numeric("evidenceConfidence", { precision: 4, scale: 3 })
      .default("0.500")
      .notNull(),
    supersedesEventId: integer("supersedesEventId"),
    createdBy: integer("createdBy"),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("outcome_events_trainee_idx").on(table.traineeId)]
);

export const followUpTasks = pgTable(
  "followUpTasks",
  {
    id: serial("id").primaryKey(),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    purposeCode: varchar("purposeCode", { length: 64 }).default("outcome_follow_up").notNull(),
    checkpointCode: varchar("checkpointCode", { length: 32 }).notNull(),
    dueAt: timestamp("dueAt", { withTimezone: true }).notNull(),
    preferredChannel: preferredChannelEnum("preferredChannel").default("whatsapp").notNull(),
    attemptNumber: integer("attemptNumber").default(0).notNull(),
    status: followUpStatusEnum("status").default("scheduled").notNull(),
    assignedCounsellor: varchar("assignedCounsellor", { length: 120 }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("follow_up_tasks_trainee_idx").on(table.traineeId)]
);

export const messageJobs = pgTable(
  "messageJobs",
  {
    id: serial("id").primaryKey(),
    followUpTaskId: integer("followUpTaskId")
      .notNull()
      .references(() => followUpTasks.id, { onDelete: "cascade" }),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    channel: messageChannelEnum("channel").notNull(),
    templateCode: varchar("templateCode", { length: 96 }).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 160 }).notNull().unique(),
    status: messageStatusEnum("status").default("queued").notNull(),
    providerMessageId: varchar("providerMessageId", { length: 160 }),
    attemptCount: integer("attemptCount").default(0).notNull(),
    lastErrorCode: varchar("lastErrorCode", { length: 96 }),
    scheduledAt: timestamp("scheduledAt", { withTimezone: true }).notNull(),
    sentAt: timestamp("sentAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("message_jobs_task_idx").on(table.followUpTaskId)]
);

export const counsellorCases = pgTable(
  "counsellorCases",
  {
    id: serial("id").primaryKey(),
    traineeId: integer("traineeId")
      .notNull()
      .references(() => trainees.id, { onDelete: "cascade" }),
    priority: casePriorityEnum("priority").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    reason: text("reason"),
    nextAction: varchar("nextAction", { length: 240 }).notNull(),
    channel: varchar("channel", { length: 32 }).notNull(),
    status: caseStatusEnum("status").default("open").notNull(),
    assignedTo: varchar("assignedTo", { length: 120 }),
    dueAt: timestamp("dueAt", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("counsellor_cases_trainee_idx").on(table.traineeId)]
);

export const auditEvents = pgTable("auditEvents", {
  id: serial("id").primaryKey(),
  actorType: varchar("actorType", { length: 32 }).notNull(),
  actorId: integer("actorId"),
  action: varchar("action", { length: 96 }).notNull(),
  entityType: varchar("entityType", { length: 96 }).notNull(),
  entityId: integer("entityId"),
  purposeCode: varchar("purposeCode", { length: 64 }),
  requestId: varchar("requestId", { length: 96 }),
  metadata: jsonb("metadata"),
  occurredAt: timestamp("occurredAt", { withTimezone: true }).defaultNow().notNull(),
});

// Single-use link tokens (employer verification, mobile pulses). Consumption
// is persisted so a link can never be used twice, even across processes.
export const oneTimeTokens = pgTable("oneTimeTokens", {
  id: serial("id").primaryKey(),
  jti: varchar("jti", { length: 64 }).notNull().unique(),
  purpose: varchar("purpose", { length: 64 }).notNull(),
  traineeId: integer("traineeId").references(() => trainees.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  usedAt: timestamp("usedAt", { withTimezone: true }),
  createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
});

// Employee portal: 1:1 with a trainee, created when a verified employment
// outcome exists. Current role/employer/wage derive from the active
// outcomeEvent — nothing is denormalised until a real need appears.
export const employees = pgTable("employees", {
  id: serial("id").primaryKey(),
  traineeId: integer("traineeId")
    .notNull()
    .unique()
    .references(() => trainees.id, { onDelete: "cascade" }),
  linkedAt: timestamp("linkedAt", { withTimezone: true }).defaultNow().notNull(),
});

// Employee document vault. Files live in a private Supabase Storage bucket;
// rows reference the object and carry their own consent scope + retention.
export const employeeDocuments = pgTable(
  "employeeDocuments",
  {
    id: serial("id").primaryKey(),
    employeeId: integer("employeeId")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: documentKindEnum("kind").notNull(),
    title: varchar("title", { length: 160 }).notNull(),
    storagePath: varchar("storagePath", { length: 320 }).notNull(),
    mimeType: varchar("mimeType", { length: 96 }).notNull(),
    sizeBytes: integer("sizeBytes").notNull(),
    consentPurposeCode: varchar("consentPurposeCode", { length: 64 })
      .default("document_storage")
      .notNull(),
    // Certificates keep until deleted; other kinds expire (retention worker).
    retentionUntil: timestamp("retentionUntil", { withTimezone: true }),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("employee_documents_employee_idx").on(table.employeeId)]
);

export type Employee = typeof employees.$inferSelect;
export type EmployeeDocument = typeof employeeDocuments.$inferSelect;

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Trainee = typeof trainees.$inferSelect;
export type OutcomeEvent = typeof outcomeEvents.$inferSelect;
