ALTER TABLE "companies" ADD COLUMN "maos_company_id" text;
--> statement-breakpoint
ALTER TABLE "goals" ADD COLUMN "maos_system_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "companies_maos_company_id_idx" ON "companies" USING btree ("maos_company_id");
