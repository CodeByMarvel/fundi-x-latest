ALTER TABLE "providers" ADD COLUMN "skills" text[];--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "experience_years" integer;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "transport" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "base_lat" double precision;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "base_lng" double precision;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "base_description" text;--> statement-breakpoint
ALTER TABLE "providers" ADD COLUMN "travel_km" integer;