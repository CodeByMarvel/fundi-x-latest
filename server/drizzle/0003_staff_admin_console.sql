CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_id" text,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"ip" text,
	"request_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"role" text NOT NULL,
	"status" text NOT NULL,
	"google_subject" text,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "staff_email_unique" UNIQUE("email"),
	CONSTRAINT "staff_google_subject_unique" UNIQUE("google_subject")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"staff_id" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "settings" DROP CONSTRAINT "settings_updated_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_staff_id_staff_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_log_target_idx" ON "audit_log" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "staff_sessions_staff_idx" ON "staff_sessions" USING btree ("staff_id");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_staff_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;