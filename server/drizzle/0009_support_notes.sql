CREATE TABLE "support_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"staff_id" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "support_notes" ADD CONSTRAINT "support_notes_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_notes_target_idx" ON "support_notes" USING btree ("target_type","target_id");