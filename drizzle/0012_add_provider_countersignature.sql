ALTER TYPE "public"."quote_event_type" ADD VALUE 'MSA_COUNTERSIGNED';--> statement-breakpoint
ALTER TYPE "public"."quote_event_type" ADD VALUE 'ADDENDUM_COUNTERSIGNED';--> statement-breakpoint
ALTER TABLE "msa_documents" ADD COLUMN "provider_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD COLUMN "provider_signed_by_name" text;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD COLUMN "provider_signed_by_title" text;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD COLUMN "provider_signed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD COLUMN "provider_signature_image_url" text;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD COLUMN "provider_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD COLUMN "provider_signed_by_name" text;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD COLUMN "provider_signed_by_title" text;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD COLUMN "provider_signed_by_user_id" text;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD COLUMN "provider_signature_image_url" text;--> statement-breakpoint
ALTER TABLE "msa_documents" ADD CONSTRAINT "msa_documents_provider_signed_by_user_id_users_id_fk" FOREIGN KEY ("provider_signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_addendums" ADD CONSTRAINT "quote_addendums_provider_signed_by_user_id_users_id_fk" FOREIGN KEY ("provider_signed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;