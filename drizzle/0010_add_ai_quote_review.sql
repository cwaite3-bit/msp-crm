ALTER TABLE "quotes" ADD COLUMN "ai_review_text" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "ai_review_generated_at" timestamp;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "ai_review_input_hash" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "ai_review_model" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "ai_review_error" text;