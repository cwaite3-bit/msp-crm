CREATE TABLE "prospect_sweep_areas" (
	"sweep_id" text NOT NULL,
	"index" integer NOT NULL,
	"plan" jsonb NOT NULL,
	"place_hint" text,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"error" text,
	"found_count" integer DEFAULT 0 NOT NULL,
	"model" text,
	"usage" jsonb,
	"started_at" timestamp,
	"finished_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "prospect_sweep_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"sweep_id" text NOT NULL,
	"area_index" integer NOT NULL,
	"key" text NOT NULL,
	"record" jsonb NOT NULL,
	"email_provider" jsonb,
	"lat" numeric(9, 6),
	"lng" numeric(9, 6),
	"distance_miles" numeric(6, 2),
	"direction" text,
	"geocode_status" text NOT NULL,
	"in_ring" boolean DEFAULT false NOT NULL,
	"model" text,
	"imported_customer_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospect_sweeps" (
	"id" text PRIMARY KEY NOT NULL,
	"center_address" text NOT NULL,
	"center_matched" text,
	"center_quality" text NOT NULL,
	"center_lat" numeric(9, 6) NOT NULL,
	"center_lng" numeric(9, 6) NOT NULL,
	"inner_miles" numeric(5, 1) NOT NULL,
	"outer_miles" numeric(5, 1) NOT NULL,
	"options" jsonb NOT NULL,
	"imported_count" integer DEFAULT 0 NOT NULL,
	"imported_at" timestamp,
	"created_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prospect_sweep_areas" ADD CONSTRAINT "prospect_sweep_areas_sweep_id_prospect_sweeps_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "public"."prospect_sweeps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_sweep_candidates" ADD CONSTRAINT "prospect_sweep_candidates_sweep_id_prospect_sweeps_id_fk" FOREIGN KEY ("sweep_id") REFERENCES "public"."prospect_sweeps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_sweep_candidates" ADD CONSTRAINT "prospect_sweep_candidates_imported_customer_id_customers_id_fk" FOREIGN KEY ("imported_customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prospect_sweeps" ADD CONSTRAINT "prospect_sweeps_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_sweep_areas_pk" ON "prospect_sweep_areas" USING btree ("sweep_id","index");--> statement-breakpoint
CREATE UNIQUE INDEX "prospect_sweep_candidates_key_unique" ON "prospect_sweep_candidates" USING btree ("sweep_id","key");--> statement-breakpoint
CREATE INDEX "prospect_sweep_candidates_sweep_idx" ON "prospect_sweep_candidates" USING btree ("sweep_id");--> statement-breakpoint
CREATE INDEX "prospect_sweeps_created_idx" ON "prospect_sweeps" USING btree ("created_at");