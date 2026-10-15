CREATE TABLE "job_matching" (
	"job_id" text PRIMARY KEY NOT NULL,
	"ring" integer NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "h3_cell" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "location_zone" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "lat" double precision;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "lng" double precision;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "h3_cell" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "location_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "job_matching" ADD CONSTRAINT "job_matching_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_location_zone_idx" ON "jobs" USING btree ("location_zone");--> statement-breakpoint
CREATE INDEX "providers_h3_cell_idx" ON "providers" USING btree ("h3_cell");