CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"job_id" text,
	"payment_id" text,
	"refund_id" text,
	"release_id" text,
	"transfer_id" text,
	"description" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"entry_id" text NOT NULL,
	"account" text NOT NULL,
	"amount" bigint NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_lines" ADD CONSTRAINT "ledger_lines_entry_id_ledger_entries_id_fk" FOREIGN KEY ("entry_id") REFERENCES "public"."ledger_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ledger_entries_job_idx" ON "ledger_entries" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "ledger_lines_account_idx" ON "ledger_lines" USING btree ("account");--> statement-breakpoint
CREATE INDEX "ledger_lines_entry_idx" ON "ledger_lines" USING btree ("entry_id");