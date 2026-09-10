CREATE TYPE "public"."msa_document_status" AS ENUM('DRAFT', 'SENT', 'SIGNED');--> statement-breakpoint
CREATE TABLE "msa_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"status" "msa_document_status" DEFAULT 'DRAFT' NOT NULL,
	"content" jsonb NOT NULL,
	"signing_token" text NOT NULL,
	"sent_at" timestamp,
	"sent_to_email" text,
	"signed_at" timestamp,
	"signed_by_name" text,
	"signed_by_title" text,
	"signed_ip" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "msa_documents_signing_token_unique" UNIQUE("signing_token")
);
--> statement-breakpoint
CREATE TABLE "slas" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"coverage_hours" text DEFAULT 'Business Hours' NOT NULL,
	"critical_response_minutes" integer DEFAULT 30 NOT NULL,
	"high_response_minutes" integer DEFAULT 60 NOT NULL,
	"medium_response_minutes" integer DEFAULT 240 NOT NULL,
	"low_response_minutes" integer DEFAULT 480 NOT NULL,
	"critical_resolution_hours" integer DEFAULT 4 NOT NULL,
	"high_resolution_hours" integer DEFAULT 8 NOT NULL,
	"medium_resolution_hours" integer DEFAULT 24 NOT NULL,
	"low_resolution_hours" integer DEFAULT 40 NOT NULL,
	"uptime_guarantee_pct" numeric(5, 2) DEFAULT '99.90' NOT NULL,
	"escalation_process" text,
	"exclusions" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quotes" ADD COLUMN "sla_id" text;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD CONSTRAINT "msa_documents_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "msa_documents_quote_idx" ON "msa_documents" USING btree ("quote_id");--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_sla_id_slas_id_fk" FOREIGN KEY ("sla_id") REFERENCES "public"."slas"("id") ON DELETE set null ON UPDATE no action;