ALTER TABLE "providers" ADD COLUMN "rating_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "rating_count" integer DEFAULT 0 NOT NULL;