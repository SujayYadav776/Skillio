CREATE TYPE "public"."case_priority" AS ENUM('P1', 'P2', 'P3', 'P4');--> statement-breakpoint
CREATE TYPE "public"."case_status" AS ENUM('open', 'assigned', 'resolved', 'snoozed');--> statement-breakpoint
CREATE TYPE "public"."consent_state" AS ENUM('granted', 'withdrawn', 'expired', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('active', 'withdrawn', 'pending');--> statement-breakpoint
CREATE TYPE "public"."follow_up_status" AS ENUM('scheduled', 'queued', 'sent', 'completed', 'declined', 'failed', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."message_channel" AS ENUM('whatsapp', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'accepted', 'delivered', 'read', 'failed', 'undelivered');--> statement-breakpoint
CREATE TYPE "public"."outcome_state" AS ENUM('reported', 'active', 'ended', 'disputed', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."outcome_status" AS ENUM('verified', 'self_reported', 'pending');--> statement-breakpoint
CREATE TYPE "public"."outcome_type" AS ENUM('formal_employment', 'self_employment', 'apprenticeship', 'seeking_work', 'not_working');--> statement-breakpoint
CREATE TYPE "public"."preferred_channel" AS ENUM('whatsapp', 'sms', 'call');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TABLE "auditEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"actorType" varchar(32) NOT NULL,
	"actorId" integer,
	"action" varchar(96) NOT NULL,
	"entityType" varchar(96) NOT NULL,
	"entityId" integer,
	"purposeCode" varchar(64),
	"requestId" varchar(96),
	"metadata" jsonb,
	"occurredAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consentGrants" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"purposeCode" varchar(64) NOT NULL,
	"status" "consent_state" NOT NULL,
	"noticeVersion" varchar(32) NOT NULL,
	"languageCode" varchar(16) NOT NULL,
	"channel" varchar(32) NOT NULL,
	"grantedAt" timestamp with time zone,
	"withdrawnAt" timestamp with time zone,
	"expiresAt" timestamp with time zone,
	"receiptHash" varchar(128) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "counsellorCases" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"priority" "case_priority" NOT NULL,
	"title" varchar(160) NOT NULL,
	"reason" text,
	"nextAction" varchar(240) NOT NULL,
	"channel" varchar(32) NOT NULL,
	"status" "case_status" DEFAULT 'open' NOT NULL,
	"assignedTo" varchar(120),
	"dueAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "followUpTasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"purposeCode" varchar(64) DEFAULT 'outcome_follow_up' NOT NULL,
	"checkpointCode" varchar(32) NOT NULL,
	"dueAt" timestamp with time zone NOT NULL,
	"preferredChannel" "preferred_channel" DEFAULT 'whatsapp' NOT NULL,
	"attemptNumber" integer DEFAULT 0 NOT NULL,
	"status" "follow_up_status" DEFAULT 'scheduled' NOT NULL,
	"assignedCounsellor" varchar(120),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messageJobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"followUpTaskId" integer NOT NULL,
	"traineeId" integer NOT NULL,
	"channel" "message_channel" NOT NULL,
	"templateCode" varchar(96) NOT NULL,
	"idempotencyKey" varchar(160) NOT NULL,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"providerMessageId" varchar(160),
	"attemptCount" integer DEFAULT 0 NOT NULL,
	"lastErrorCode" varchar(96),
	"scheduledAt" timestamp with time zone NOT NULL,
	"sentAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messageJobs_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "outcomeEvents" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"outcomeType" varchar(64) NOT NULL,
	"state" "outcome_state" DEFAULT 'reported' NOT NULL,
	"effectiveStartDate" timestamp with time zone,
	"effectiveEndDate" timestamp with time zone,
	"roleCategory" varchar(120),
	"industry" varchar(120),
	"wageBand" varchar(64),
	"relevanceRating" integer,
	"source" varchar(64) NOT NULL,
	"evidenceConfidence" numeric(4, 3) DEFAULT '0.500' NOT NULL,
	"supersedesEventId" integer,
	"createdBy" integer,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trainees" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeRef" varchar(32) NOT NULL,
	"slug" varchar(64) NOT NULL,
	"displayName" varchar(160) NOT NULL,
	"initials" varchar(4) NOT NULL,
	"district" varchar(96) NOT NULL,
	"provider" varchar(160) NOT NULL,
	"course" varchar(160) NOT NULL,
	"cohort" varchar(48) NOT NULL,
	"preferredLanguage" varchar(16) DEFAULT 'mr' NOT NULL,
	"outcomeType" "outcome_type" NOT NULL,
	"outcomeLabel" varchar(64) NOT NULL,
	"outcomeStatus" "outcome_status" DEFAULT 'self_reported' NOT NULL,
	"wageBand" varchar(64),
	"relevance" integer,
	"retentionDays" integer DEFAULT 0 NOT NULL,
	"barrier" varchar(128),
	"consentStatus" "consent_status" DEFAULT 'pending' NOT NULL,
	"lastUpdated" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trainees_traineeRef_unique" UNIQUE("traineeRef"),
	CONSTRAINT "trainees_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "trainingRecords" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"provider" varchar(160) NOT NULL,
	"course" varchar(160) NOT NULL,
	"cohort" varchar(48) NOT NULL,
	"enrolmentDate" timestamp with time zone,
	"completionDate" timestamp with time zone,
	"attendanceRate" numeric(5, 2),
	"assessmentScore" numeric(5, 2),
	"certificationStatus" varchar(32),
	"sourceSystem" varchar(96) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"openId" varchar(128) NOT NULL,
	"name" text,
	"email" varchar(320),
	"loginMethod" varchar(64),
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"lastSignedIn" timestamp with time zone DEFAULT now() NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_openId_unique" UNIQUE("openId")
);
--> statement-breakpoint
ALTER TABLE "consentGrants" ADD CONSTRAINT "consentGrants_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counsellorCases" ADD CONSTRAINT "counsellorCases_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followUpTasks" ADD CONSTRAINT "followUpTasks_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messageJobs" ADD CONSTRAINT "messageJobs_followUpTaskId_followUpTasks_id_fk" FOREIGN KEY ("followUpTaskId") REFERENCES "public"."followUpTasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messageJobs" ADD CONSTRAINT "messageJobs_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcomeEvents" ADD CONSTRAINT "outcomeEvents_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trainingRecords" ADD CONSTRAINT "trainingRecords_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_grants_trainee_idx" ON "consentGrants" USING btree ("traineeId");--> statement-breakpoint
CREATE INDEX "counsellor_cases_trainee_idx" ON "counsellorCases" USING btree ("traineeId");--> statement-breakpoint
CREATE INDEX "follow_up_tasks_trainee_idx" ON "followUpTasks" USING btree ("traineeId");--> statement-breakpoint
CREATE INDEX "message_jobs_task_idx" ON "messageJobs" USING btree ("followUpTaskId");--> statement-breakpoint
CREATE INDEX "outcome_events_trainee_idx" ON "outcomeEvents" USING btree ("traineeId");--> statement-breakpoint
CREATE INDEX "trainees_district_idx" ON "trainees" USING btree ("district");--> statement-breakpoint
CREATE INDEX "training_records_trainee_idx" ON "trainingRecords" USING btree ("traineeId");