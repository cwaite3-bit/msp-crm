CREATE TYPE "public"."billing_frequency" AS ENUM('MONTHLY', 'ANNUAL');--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "billing_frequency" "billing_frequency" DEFAULT 'MONTHLY' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "photo_url" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "title" text;