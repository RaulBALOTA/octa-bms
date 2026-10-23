BEGIN;
ALTER TABLE "job_openings" ADD COLUMN "departmentId" TEXT, ADD COLUMN "officeId" TEXT;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "job_openings" ADD CONSTRAINT "job_openings_officeId_fkey" FOREIGN KEY ("officeId") REFERENCES "offices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Link legacy names only when there is one unambiguous active company record.
UPDATE "job_openings" j SET "departmentId" = (SELECT MIN(d."id") FROM "departments" d WHERE d."companyId" = j."companyId" AND d."name" = j."departmentName" AND d."deletedAt" IS NULL AND d."isActive" = true HAVING COUNT(*) = 1);
UPDATE "job_openings" j SET "officeId" = (SELECT MIN(o."id") FROM "offices" o WHERE o."companyId" = j."companyId" AND o."name" = j."officeName" AND o."deletedAt" IS NULL AND o."isActive" = true HAVING COUNT(*) = 1);

CREATE TABLE "staffing_budget_scenarios" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "year" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "fiscalYearStart" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "plan" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "staffing_budget_scenarios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staffing_budget_scenarios_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "staffing_budget_scenarios_companyId_year_idx" ON "staffing_budget_scenarios"("companyId", "year");
CREATE TABLE "staffing_budget_revisions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scenarioId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "plan" JSONB NOT NULL,
  "result" JSONB NOT NULL,
  "note" TEXT,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staffing_budget_revisions_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "staffing_budget_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "staffing_budget_revisions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staffing_budget_revisions_scenarioId_version_key" ON "staffing_budget_revisions"("scenarioId", "version");
COMMIT;
