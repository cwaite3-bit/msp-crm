ALTER TABLE "customers" ADD COLUMN "prospect_external_id" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "research" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "customers_prospect_external_id_unique" ON "customers" USING btree ("prospect_external_id");