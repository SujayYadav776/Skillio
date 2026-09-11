CREATE TABLE "oneTimeTokens" (
	"id" serial PRIMARY KEY NOT NULL,
	"jti" varchar(64) NOT NULL,
	"purpose" varchar(64) NOT NULL,
	"traineeId" integer,
	"expiresAt" timestamp with time zone NOT NULL,
	"usedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oneTimeTokens_jti_unique" UNIQUE("jti")
);
--> statement-breakpoint
ALTER TABLE "trainees" ADD COLUMN "contactPhone" varchar(32);--> statement-breakpoint
ALTER TABLE "oneTimeTokens" ADD CONSTRAINT "oneTimeTokens_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;