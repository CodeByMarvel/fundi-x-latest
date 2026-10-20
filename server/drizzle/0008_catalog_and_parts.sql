CREATE TABLE "catalog_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog" jsonb NOT NULL,
	"summary" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "parts_amount" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_versions" ADD CONSTRAINT "catalog_versions_created_by_staff_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_versions_created_idx" ON "catalog_versions" USING btree ("created_at");