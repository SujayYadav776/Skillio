CREATE TYPE "public"."employer_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."evidence_level" AS ENUM('self_reported', 'employer_confirmed', 'verified');--> statement-breakpoint
CREATE TYPE "public"."job_application_status" AS ENUM('matched', 'referred', 'applied', 'interviewing', 'placed', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TYPE "public"."job_posting_status" AS ENUM('open', 'closed', 'filled');--> statement-breakpoint
CREATE TYPE "public"."passport_entry_kind" AS ENUM('training', 'employment', 'skill');--> statement-breakpoint
CREATE TYPE "public"."passport_share_scope" AS ENUM('summary', 'full');--> statement-breakpoint
CREATE TYPE "public"."passport_status" AS ENUM('draft', 'published', 'revoked');--> statement-breakpoint
CREATE TABLE "employers" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(160) NOT NULL,
	"slug" varchar(160) NOT NULL,
	"industry" varchar(120),
	"district" varchar(96),
	"status" "employer_status" DEFAULT 'active' NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employers_name_unique" UNIQUE("name"),
	CONSTRAINT "employers_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "jobApplications" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"postingId" integer NOT NULL,
	"status" "job_application_status" DEFAULT 'matched' NOT NULL,
	"referredBy" varchar(120),
	"matchScore" integer DEFAULT 0 NOT NULL,
	"matchFactors" jsonb,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobPostings" (
	"id" serial PRIMARY KEY NOT NULL,
	"employerId" integer NOT NULL,
	"title" varchar(160) NOT NULL,
	"roleCategory" varchar(120) NOT NULL,
	"district" varchar(96) NOT NULL,
	"wageBand" varchar(64),
	"courseTags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"status" "job_posting_status" DEFAULT 'open' NOT NULL,
	"closesAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passportEntries" (
	"id" serial PRIMARY KEY NOT NULL,
	"passportId" integer NOT NULL,
	"kind" "passport_entry_kind" NOT NULL,
	"title" varchar(160) NOT NULL,
	"subtitle" varchar(200),
	"startDate" timestamp with time zone,
	"endDate" timestamp with time zone,
	"district" varchar(96),
	"roleCategory" varchar(120),
	"industry" varchar(120),
	"wageBand" varchar(64),
	"evidenceLevel" "evidence_level" NOT NULL,
	"source" varchar(64) NOT NULL,
	"sourceId" integer,
	"displayOrder" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passportShares" (
	"id" serial PRIMARY KEY NOT NULL,
	"passportId" integer NOT NULL,
	"jti" varchar(64) NOT NULL,
	"recipientLabel" varchar(120),
	"scope" "passport_share_scope" DEFAULT 'summary' NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"viewCount" integer DEFAULT 0 NOT NULL,
	"lastViewedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passportShares_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
CREATE TABLE "passports" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"publicId" varchar(24) NOT NULL,
	"status" "passport_status" DEFAULT 'draft' NOT NULL,
	"headlineRole" varchar(120),
	"headlineIndustry" varchar(120),
	"district" varchar(96),
	"verifiedTenureDays" integer DEFAULT 0 NOT NULL,
	"shareWageBands" boolean DEFAULT false NOT NULL,
	"shareEmployerNames" boolean DEFAULT false NOT NULL,
	"contentHash" varchar(64),
	"publishedAt" timestamp with time zone,
	"revokedAt" timestamp with time zone,
	"revokeReason" varchar(200),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passports_traineeId_unique" UNIQUE("traineeId"),
	CONSTRAINT "passports_publicId_unique" UNIQUE("publicId")
);
--> statement-breakpoint
ALTER TABLE "jobApplications" ADD CONSTRAINT "jobApplications_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobApplications" ADD CONSTRAINT "jobApplications_postingId_jobPostings_id_fk" FOREIGN KEY ("postingId") REFERENCES "public"."jobPostings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobPostings" ADD CONSTRAINT "jobPostings_employerId_employers_id_fk" FOREIGN KEY ("employerId") REFERENCES "public"."employers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passportEntries" ADD CONSTRAINT "passportEntries_passportId_passports_id_fk" FOREIGN KEY ("passportId") REFERENCES "public"."passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passportShares" ADD CONSTRAINT "passportShares_passportId_passports_id_fk" FOREIGN KEY ("passportId") REFERENCES "public"."passports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passports" ADD CONSTRAINT "passports_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employers_district_idx" ON "employers" USING btree ("district");--> statement-breakpoint
CREATE INDEX "job_applications_trainee_idx" ON "jobApplications" USING btree ("traineeId");--> statement-breakpoint
CREATE INDEX "job_applications_posting_idx" ON "jobApplications" USING btree ("postingId");--> statement-breakpoint
CREATE INDEX "job_postings_status_idx" ON "jobPostings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "passport_entries_passport_idx" ON "passportEntries" USING btree ("passportId");--> statement-breakpoint
CREATE INDEX "passport_shares_passport_idx" ON "passportShares" USING btree ("passportId");--> statement-breakpoint
CREATE INDEX "passports_status_idx" ON "passports" USING btree ("status");