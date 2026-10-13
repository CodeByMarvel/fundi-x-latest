CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"fingerprint" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" jsonb,
	"job_id" text,
	"last_request_id" text,
	"count" integer DEFAULT 1 NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"resolution_note" text
);
--> statement-breakpoint
ALTER TABLE "audit_log" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolved_by_staff_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_open_fingerprint_idx" ON "incidents" USING btree ("fingerprint") WHERE "incidents"."status" = 'OPEN';--> statement-breakpoint
CREATE INDEX "incidents_last_seen_idx" ON "incidents" USING btree ("last_seen_at");