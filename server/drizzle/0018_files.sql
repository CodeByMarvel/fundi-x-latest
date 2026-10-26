CREATE TABLE "files" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"purpose" text NOT NULL,
	"kind" text NOT NULL,
	"job_id" text,
	"key" text NOT NULL,
	"content_type" text NOT NULL,
	"declared_bytes" integer NOT NULL,
	"bytes" integer,
	"status" text NOT NULL,
	"status_reason" text,
	"created_at" timestamp with time zone NOT NULL,
	"link_expires_at" timestamp with time zone NOT NULL,
	"confirmed_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "files_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "files_owner_idx" ON "files" USING btree ("owner_id","purpose");--> statement-breakpoint
CREATE INDEX "files_job_idx" ON "files" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "files_status_idx" ON "files" USING btree ("status","created_at");