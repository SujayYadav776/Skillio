CREATE TABLE "employees" (
	"id" serial PRIMARY KEY NOT NULL,
	"traineeId" integer NOT NULL,
	"linkedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_traineeId_unique" UNIQUE("traineeId")
);
--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_traineeId_trainees_id_fk" FOREIGN KEY ("traineeId") REFERENCES "public"."trainees"("id") ON DELETE cascade ON UPDATE no action;