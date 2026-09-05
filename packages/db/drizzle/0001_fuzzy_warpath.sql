ALTER TABLE "call_attempts" ADD COLUMN "scored_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardrail_violations" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "guardrail_violations" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD COLUMN "options" text;--> statement-breakpoint
ALTER TABLE "guardrail_violations" ADD CONSTRAINT "guardrail_violations_reviewed_by_employees_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;