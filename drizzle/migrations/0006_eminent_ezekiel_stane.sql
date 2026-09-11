CREATE TYPE "public"."benefit_status" AS ENUM('eligible', 'applied', 'approved', 'received');--> statement-breakpoint
CREATE TYPE "public"."case_kind" AS ENUM('escalation', 'grievance', 'wage_dispute', 'harassment', 'benefit', 'other');--> statement-breakpoint
CREATE TYPE "public"."case_message_author" AS ENUM('staff', 'employee', 'system');--> statement-breakpoint
CREATE TABLE "benefitSchemes" (
	"id" serial PRIMARY KEY NOT NULL,
	"code" varchar(64) NOT NULL,
	"title" varchar(200) NOT NULL,
	"description" text,
	"agency" varchar(160) NOT NULL,
	"district" varchar(96),
	"eligibilityRules" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "benefitSchemes_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "caseMessages" (
	"id" serial PRIMARY KEY NOT NULL,
	"caseId" integer NOT NULL,
	"author" "case_message_author" NOT NULL,
	"authorName" varchar(160),
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employeeBenefits" (
	"id" serial PRIMARY KEY NOT NULL,
	"employeeId" integer NOT NULL,
	"schemeId" integer NOT NULL,
	"status" "benefit_status" DEFAULT 'eligible' NOT NULL,
	"matchedAt" timestamp with time zone,
	"appliedAt" timestamp with time zone,
	"decidedAt" timestamp with time zone,
	"notes" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "counsellorCases" ADD COLUMN "kind" "case_kind" DEFAULT 'escalation' NOT NULL;--> statement-breakpoint
ALTER TABLE "caseMessages" ADD CONSTRAINT "caseMessages_caseId_counsellorCases_id_fk" FOREIGN KEY ("caseId") REFERENCES "public"."counsellorCases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employeeBenefits" ADD CONSTRAINT "employeeBenefits_employeeId_employees_id_fk" FOREIGN KEY ("employeeId") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employeeBenefits" ADD CONSTRAINT "employeeBenefits_schemeId_benefitSchemes_id_fk" FOREIGN KEY ("schemeId") REFERENCES "public"."benefitSchemes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "case_messages_case_idx" ON "caseMessages" USING btree ("caseId");--> statement-breakpoint
CREATE INDEX "employee_benefits_employee_idx" ON "employeeBenefits" USING btree ("employeeId");--> statement-breakpoint
CREATE INDEX "employee_benefits_scheme_idx" ON "employeeBenefits" USING btree ("schemeId");