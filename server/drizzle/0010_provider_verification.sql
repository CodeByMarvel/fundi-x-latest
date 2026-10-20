ALTER TABLE "providers" ADD COLUMN "verification_note" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "verified_by" text;