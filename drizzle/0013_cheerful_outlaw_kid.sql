CREATE TYPE "public"."prospect_stage" AS ENUM('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST');--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "stage" "prospect_stage";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "estimated_monthly_value" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "next_follow_up_at" timestamp;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "lost_reason" text;