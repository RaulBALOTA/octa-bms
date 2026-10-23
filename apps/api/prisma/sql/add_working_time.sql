-- Working time module: schedules, attendance, project hours, timesheets, capacity plan, PMO connector.
-- Additive only. Generated with prisma migrate diff against the previous schema.
BEGIN;
-- CreateEnum
CREATE TYPE "TimeRecordKind" AS ENUM ('OFFICE', 'HOME_OFFICE', 'ON_SITE', 'BUSINESS_TRIP');
-- CreateEnum
CREATE TYPE "TimeEntrySource" AS ENUM ('BMS', 'PMO');
-- CreateEnum
CREATE TYPE "TimesheetStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');
-- CreateTable
CREATE TABLE "work_schedules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dailyMinutes" INTEGER[],
    "coreStart" TEXT,
    "coreEnd" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "work_schedules_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "employee_work_schedules" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employee_work_schedules_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "time_records" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3),
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "kind" "TimeRecordKind" NOT NULL DEFAULT 'OFFICE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "time_records_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "project_time_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT,
    "taskRef" TEXT,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "source" "TimeEntrySource" NOT NULL DEFAULT 'BMS',
    "externalId" TEXT,
    "syncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "project_time_entries_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "timesheets" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "status" "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
    "targetMinutes" INTEGER NOT NULL DEFAULT 0,
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "projectMinutes" INTEGER NOT NULL DEFAULT 0,
    "violations" JSONB,
    "submittedAt" TIMESTAMP(3),
    "submittedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "timesheets_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "time_allocations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "projectCode" TEXT NOT NULL,
    "projectName" TEXT,
    "weekStart" DATE NOT NULL,
    "plannedMinutes" INTEGER NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "time_allocations_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "pmo_projects" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pmo_projects_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "pmo_sync_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "windowFrom" DATE,
    "fetched" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "removed" INTEGER NOT NULL DEFAULT 0,
    "skipped" INTEGER NOT NULL DEFAULT 0,
    "unmatched" JSONB,
    "error" TEXT,
    "triggeredById" TEXT,
    CONSTRAINT "pmo_sync_runs_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "work_schedules_companyId_code_key" ON "work_schedules"("companyId", "code");
-- CreateIndex
CREATE INDEX "employee_work_schedules_employeeId_validFrom_idx" ON "employee_work_schedules"("employeeId", "validFrom");
-- CreateIndex
CREATE INDEX "time_records_companyId_date_idx" ON "time_records"("companyId", "date");
-- CreateIndex
CREATE INDEX "time_records_employeeId_date_idx" ON "time_records"("employeeId", "date");
-- CreateIndex
CREATE INDEX "project_time_entries_companyId_date_idx" ON "project_time_entries"("companyId", "date");
-- CreateIndex
CREATE INDEX "project_time_entries_employeeId_date_idx" ON "project_time_entries"("employeeId", "date");
-- CreateIndex
CREATE INDEX "project_time_entries_companyId_projectCode_idx" ON "project_time_entries"("companyId", "projectCode");
-- CreateIndex
CREATE UNIQUE INDEX "project_time_entries_companyId_source_externalId_key" ON "project_time_entries"("companyId", "source", "externalId");
-- CreateIndex
CREATE INDEX "timesheets_companyId_status_idx" ON "timesheets"("companyId", "status");
-- CreateIndex
CREATE UNIQUE INDEX "timesheets_employeeId_weekStart_key" ON "timesheets"("employeeId", "weekStart");
-- CreateIndex
CREATE INDEX "time_allocations_companyId_weekStart_idx" ON "time_allocations"("companyId", "weekStart");
-- CreateIndex
CREATE UNIQUE INDEX "time_allocations_employeeId_projectCode_weekStart_key" ON "time_allocations"("employeeId", "projectCode", "weekStart");
-- CreateIndex
CREATE INDEX "pmo_projects_companyId_code_idx" ON "pmo_projects"("companyId", "code");
-- CreateIndex
CREATE UNIQUE INDEX "pmo_projects_companyId_externalId_key" ON "pmo_projects"("companyId", "externalId");
-- CreateIndex
CREATE INDEX "pmo_sync_runs_companyId_startedAt_idx" ON "pmo_sync_runs"("companyId", "startedAt");
-- AddForeignKey
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "employee_work_schedules" ADD CONSTRAINT "employee_work_schedules_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "employee_work_schedules" ADD CONSTRAINT "employee_work_schedules_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "work_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "time_records" ADD CONSTRAINT "time_records_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "project_time_entries" ADD CONSTRAINT "project_time_entries_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "timesheets" ADD CONSTRAINT "timesheets_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "time_allocations" ADD CONSTRAINT "time_allocations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "time_allocations" ADD CONSTRAINT "time_allocations_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "pmo_projects" ADD CONSTRAINT "pmo_projects_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "pmo_sync_runs" ADD CONSTRAINT "pmo_sync_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
COMMIT;
