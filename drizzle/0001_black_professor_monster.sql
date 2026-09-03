CREATE TABLE "app_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "risk_factors" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "add_on_selections" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "checklist" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "recommended_tier" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "risk_adjustment_pct" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "plan_fit_status" text;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "manager_approval_required" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "gross_margin_pct" numeric(6, 4);--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "margin_status" text;