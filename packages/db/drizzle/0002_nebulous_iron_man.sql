ALTER TABLE "call_attempts" ADD COLUMN "requested_callback_raw" text;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "requested_callback_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "telephony_seconds" integer;--> statement-breakpoint
ALTER TABLE "call_attempts" ADD COLUMN "realtime_seconds" integer;