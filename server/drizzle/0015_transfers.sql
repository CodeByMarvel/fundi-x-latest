CREATE TABLE "transfers" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"job_id" text NOT NULL,
	"release_id" text,
	"refund_id" text,
	"recipient_id" text NOT NULL,
	"phone" text NOT NULL,
	"amount" bigint NOT NULL,
	"status" text NOT NULL,
	"conversation_id" text,
	"receipt_number" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfers_status_idx" ON "transfers" USING btree ("status","next_attempt_at");--> statement-breakpoint
CREATE INDEX "transfers_job_idx" ON "transfers" USING btree ("job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_conversation_idx" ON "transfers" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_release_idx" ON "transfers" USING btree ("release_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transfers_refund_idx" ON "transfers" USING btree ("refund_id");