BEGIN;

CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'BUDGETED', 'FILLED');

CREATE TABLE "position_plans" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "positionId" TEXT NOT NULL,
  "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "position_plans_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "position_plans_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "position_plans_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "positions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "position_plans_vacancy_status_check" CHECK ("status" IN ('OPEN', 'BUDGETED'))
);
CREATE UNIQUE INDEX "position_plans_companyId_positionId_key" ON "position_plans"("companyId", "positionId");

CREATE TABLE "org_chart_versions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "note" TEXT,
  "snapshot" JSONB NOT NULL,
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "org_chart_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "org_chart_versions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "org_chart_versions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "org_chart_versions_companyId_version_key" ON "org_chart_versions"("companyId", "version");

COMMIT;
