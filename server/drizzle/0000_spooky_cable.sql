CREATE TABLE "charges" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"purpose" text NOT NULL,
	"amount" bigint NOT NULL,
	"description" text NOT NULL,
	"quote_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_events" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"from_status" text,
	"to_status" text NOT NULL,
	"actor" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_id" text NOT NULL,
	"provider_id" text,
	"offered_provider_id" text,
	"status" text NOT NULL,
	"pricing_mode" text NOT NULL,
	"base_quote_id" text,
	"request" jsonb NOT NULL,
	"extra" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"purpose" text NOT NULL,
	"quote_id" text,
	"method" text NOT NULL,
	"phone" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"failure_reason" text,
	"receipt_number" text,
	"checkout_request_id" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quotes" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"kind" text NOT NULL,
	"issued_by" text NOT NULL,
	"provider_id" text,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"items" jsonb NOT NULL,
	"total" bigint NOT NULL,
	"note" text,
	"reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"amount" bigint NOT NULL,
	"reason" text NOT NULL,
	"status" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "releases" (
	"id" text PRIMARY KEY NOT NULL,
	"job_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"lines" jsonb NOT NULL,
	"gross" bigint NOT NULL,
	"commission" bigint NOT NULL,
	"net" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reliability_events" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_id" text NOT NULL,
	"job_id" text NOT NULL,
	"type" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_events" ADD CONSTRAINT "job_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quotes" ADD CONSTRAINT "quotes_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reliability_events" ADD CONSTRAINT "reliability_events_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "charges_job_idx" ON "charges" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "job_events_job_idx" ON "job_events" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_customer_idx" ON "jobs" USING btree ("customer_id");--> statement-breakpoint
CREATE INDEX "jobs_provider_idx" ON "jobs" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_job_idx" ON "payments" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_checkout_request_idx" ON "payments" USING btree ("checkout_request_id");--> statement-breakpoint
CREATE INDEX "quotes_job_idx" ON "quotes" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "refunds_job_idx" ON "refunds" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "releases_provider_idx" ON "releases" USING btree ("provider_id");--> statement-breakpoint
CREATE INDEX "reliability_provider_idx" ON "reliability_events" USING btree ("provider_id");