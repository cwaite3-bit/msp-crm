CREATE TYPE "public"."addendum_status" AS ENUM('DRAFT', 'SENT', 'SIGNED', 'DECLINED');--> statement-breakpoint
ALTER TYPE "public"."quote_event_type" ADD VALUE 'ADDENDUM_SIGNED';--> statement-breakpoint
ALTER TYPE "public"."quote_event_type" ADD VALUE 'ADDENDUM_DECLINED';--> statement-breakpoint
CREATE TABLE "quote_addendum_line_items" (
	"id" text PRIMARY KEY NOT NULL,
	"addendum_id" text NOT NULL,
	"product_id" text,
	"category_name" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"unit_label" text NOT NULL,
	"billing_type" "billing_type" NOT NULL,
	"quantity" numeric(12, 2) DEFAULT '1' NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_addendums" (
	"id" text PRIMARY KEY NOT NULL,
	"quote_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" "addendum_status" DEFAULT 'DRAFT' NOT NULL,
	"note" text,
	"created_by_id" text NOT NULL,
	"content" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"signing_token" text NOT NULL,
	"sent_at" timestamp,
	"sent_to_email" text,
	"signed_at" timestamp,
	"signed_by_name" text,
	"signed_by_title" text,
	"signed_ip" text,
	"signature_image_url" text,
	"declined_at" timestamp,
	"quickbooks_invoice_id" text,
	"quickbooks_synced_at" timestamp,
	"quickbooks_sync_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "quote_addendums_signing_token_unique" UNIQUE("signing_token")
);
--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD COLUMN "addendum_id" text;--> statement-breakpoint
ALTER TABLE "quote_addendum_line_items" ADD CONSTRAINT "quote_addendum_line_items_addendum_id_quote_addendums_id_fk" FOREIGN KEY ("addendum_id") REFERENCES "public"."quote_addendums"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_addendum_line_items" ADD CONSTRAINT "quote_addendum_line_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD CONSTRAINT "quote_addendums_quote_id_quotes_id_fk" FOREIGN KEY ("quote_id") REFERENCES "public"."quotes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD CONSTRAINT "quote_addendums_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_addendum_line_items_addendum_idx" ON "quote_addendum_line_items" USING btree ("addendum_id");--> statement-breakpoint
CREATE INDEX "quote_addendums_quote_idx" ON "quote_addendums" USING btree ("quote_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quote_addendums_quote_number_idx" ON "quote_addendums" USING btree ("quote_id","number");--> statement-breakpoint
ALTER TABLE "quote_line_items" ADD CONSTRAINT "quote_line_items_addendum_id_quote_addendums_id_fk" FOREIGN KEY ("addendum_id") REFERENCES "public"."quote_addendums"("id") ON DELETE set null ON UPDATE no action;