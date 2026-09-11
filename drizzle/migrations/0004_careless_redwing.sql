CREATE TYPE "public"."document_kind" AS ENUM('certificate', 'payslip', 'id_document', 'other');--> statement-breakpoint
CREATE TABLE "employeeDocuments" (
	"id" serial PRIMARY KEY NOT NULL,
	"employeeId" integer NOT NULL,
	"kind" "document_kind" NOT NULL,
	"title" varchar(160) NOT NULL,
	"storagePath" varchar(320) NOT NULL,
	"mimeType" varchar(96) NOT NULL,
	"sizeBytes" integer NOT NULL,
	"consentPurposeCode" varchar(64) DEFAULT 'document_storage' NOT NULL,
	"retentionUntil" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "employeeDocuments" ADD CONSTRAINT "employeeDocuments_employeeId_employees_id_fk" FOREIGN KEY ("employeeId") REFERENCES "public"."employees"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "employee_documents_employee_idx" ON "employeeDocuments" USING btree ("employeeId");