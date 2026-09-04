CREATE TYPE "public"."attempt_outcome" AS ENUM('answered_complete', 'answered_incomplete', 'no_answer', 'voicemail', 'busy', 'failed', 'abusive', 'minor_answered', 'opt_out');--> statement-breakpoint
CREATE TYPE "public"."call_language" AS ENUM('pt', 'en');--> statement-breakpoint
CREATE TYPE "public"."criterion_type" AS ENUM('boolean', 'numeric', 'enum', 'free_text');--> statement-breakpoint
CREATE TYPE "public"."employee_role" AS ENUM('agent', 'admin');--> statement-breakpoint
CREATE TYPE "public"."lead_status" AS ENUM('new', 'calling', 'waiting_retry', 'no_answer_final', 'qualified', 'disqualified', 'opt_out');--> statement-breakpoint
CREATE TYPE "public"."scoring_status" AS ENUM('pending', 'running', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "call_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"outcome" "attempt_outcome",
	"ended_reason" text,
	"twilio_call_sid" text,
	"scoring_status" "scoring_status" DEFAULT 'pending' NOT NULL,
	"transcript" jsonb,
	"transcript_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "criteria_audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"criteria_id" uuid,
	"changed_by" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"role" "employee_role" DEFAULT 'agent' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "employees_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "guardrail_violations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_attempt_id" uuid NOT NULL,
	"guardrail" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "intake_rate_limits" (
	"ip_hash" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "intake_rate_limits_ip_hash_window_start_pk" PRIMARY KEY("ip_hash","window_start")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"ddd" varchar(2) NOT NULL,
	"timezone" text NOT NULL,
	"preferred_call_language" "call_language" DEFAULT 'pt' NOT NULL,
	"status" "lead_status" DEFAULT 'new' NOT NULL,
	"score" integer,
	"qualification_reason" text,
	"icebreaker" text,
	"source" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"next_call_at" timestamp with time zone,
	"opt_out_at" timestamp with time zone,
	"workflow_run_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_answers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"call_attempt_id" uuid NOT NULL,
	"criteria_id" uuid NOT NULL,
	"extracted_value" text,
	"normalized_value" jsonb,
	"confidence" numeric(4, 3),
	"evidence" text,
	"passed" boolean,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qualification_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"question_pt" text NOT NULL,
	"question_en" text NOT NULL,
	"type" "criterion_type" NOT NULL,
	"expected_value" text,
	"weight" integer NOT NULL,
	"blocking" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "call_attempts" ADD CONSTRAINT "call_attempts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_audit_log" ADD CONSTRAINT "criteria_audit_log_criteria_id_qualification_criteria_id_fk" FOREIGN KEY ("criteria_id") REFERENCES "public"."qualification_criteria"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "criteria_audit_log" ADD CONSTRAINT "criteria_audit_log_changed_by_employees_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guardrail_violations" ADD CONSTRAINT "guardrail_violations_call_attempt_id_call_attempts_id_fk" FOREIGN KEY ("call_attempt_id") REFERENCES "public"."call_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_call_attempt_id_call_attempts_id_fk" FOREIGN KEY ("call_attempt_id") REFERENCES "public"."call_attempts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_answers" ADD CONSTRAINT "qualification_answers_criteria_id_qualification_criteria_id_fk" FOREIGN KEY ("criteria_id") REFERENCES "public"."qualification_criteria"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qualification_criteria" ADD CONSTRAINT "qualification_criteria_updated_by_employees_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_employees_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."employees"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempts_lead_attempt_unique" ON "call_attempts" USING btree ("lead_id","attempt_number");--> statement-breakpoint
CREATE UNIQUE INDEX "call_attempts_twilio_sid_unique" ON "call_attempts" USING btree ("twilio_call_sid");--> statement-breakpoint
CREATE INDEX "call_attempts_transcript_expires_idx" ON "call_attempts" USING btree ("transcript_expires_at");--> statement-breakpoint
CREATE INDEX "criteria_audit_log_changed_at_idx" ON "criteria_audit_log" USING btree ("changed_at");--> statement-breakpoint
CREATE INDEX "guardrail_violations_attempt_idx" ON "guardrail_violations" USING btree ("call_attempt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "leads_phone_unique" ON "leads" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_next_call_at_idx" ON "leads" USING btree ("next_call_at");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_answers_attempt_criteria_unique" ON "qualification_answers" USING btree ("call_attempt_id","criteria_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qualification_criteria_key_unique" ON "qualification_criteria" USING btree ("key");--> statement-breakpoint
CREATE INDEX "qualification_criteria_active_idx" ON "qualification_criteria" USING btree ("active");