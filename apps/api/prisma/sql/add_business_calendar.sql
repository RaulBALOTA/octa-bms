-- Additive calendar migration. Run once; no existing business tables are rewritten.
BEGIN;

-- CreateEnum
CREATE TYPE "CalendarDomain" AS ENUM ('CORPORATE', 'FINANCE', 'SALES', 'HR', 'OPERATIONS', 'MEETING', 'COMMITMENT');

-- CreateEnum
CREATE TYPE "CalendarKind" AS ENUM ('APPOINTMENT', 'DEADLINE', 'OBLIGATION', 'MILESTONE', 'DECISION', 'FORECAST', 'FOLLOW_UP');

-- CreateEnum
CREATE TYPE "CalendarStatus" AS ENUM ('DRAFT', 'OPEN', 'IN_PROGRESS', 'AWAITING', 'AT_RISK', 'COMPLETED', 'CANCELED');

-- CreateEnum
CREATE TYPE "CalendarSensitivity" AS ENUM ('PUBLIC_INTERNAL', 'TEAM', 'RESTRICTED', 'PRIVATE');

-- CreateTable
CREATE TABLE "business_calendar_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "domain" "CalendarDomain" NOT NULL,
    "kind" "CalendarKind" NOT NULL,
    "status" "CalendarStatus" NOT NULL DEFAULT 'OPEN',
    "sensitivity" "CalendarSensitivity" NOT NULL DEFAULT 'PUBLIC_INTERNAL',
    "priority" INTEGER NOT NULL DEFAULT 1,
    "ownerUserId" TEXT,
    "createdById" TEXT NOT NULL,
    "timezoneIana" TEXT NOT NULL DEFAULT 'Europe/Berlin',
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "dateOnly" TEXT,
    "endDateOnly" TEXT,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "hardDueDate" TEXT,
    "internalTargetDate" TEXT,
    "forecastDate" TEXT,
    "hardDueAt" TIMESTAMP(3),
    "completionEvidenceRequired" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "sourceKind" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceUrl" TEXT,
    "businessEntityType" TEXT,
    "businessEntityId" TEXT,
    "recurrenceFrequency" TEXT,
    "recurrenceInterval" INTEGER NOT NULL DEFAULT 1,
    "recurrenceUntil" TEXT,
    "recurrenceAnchor" TEXT,
    "recurrenceSeriesId" TEXT,
    "originalOccurrenceKey" TEXT,
    "occurrenceNumber" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "business_calendar_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendar_checklist_items" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "business_calendar_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendar_evidence" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_calendar_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendar_access_grants" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "canEdit" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "business_calendar_access_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendar_history" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_calendar_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_domain_status_idx" ON "business_calendar_items"("companyId", "domain", "status");

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_ownerUserId_idx" ON "business_calendar_items"("companyId", "ownerUserId");

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_dateOnly_idx" ON "business_calendar_items"("companyId", "dateOnly");

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_hardDueDate_idx" ON "business_calendar_items"("companyId", "hardDueDate");

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_startsAt_idx" ON "business_calendar_items"("companyId", "startsAt");

-- CreateIndex
CREATE INDEX "business_calendar_items_companyId_hardDueAt_idx" ON "business_calendar_items"("companyId", "hardDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "business_calendar_items_companyId_recurrenceSeriesId_origin_key" ON "business_calendar_items"("companyId", "recurrenceSeriesId", "originalOccurrenceKey");

-- CreateIndex
CREATE INDEX "business_calendar_checklist_items_itemId_idx" ON "business_calendar_checklist_items"("itemId");

-- CreateIndex
CREATE INDEX "business_calendar_evidence_itemId_idx" ON "business_calendar_evidence"("itemId");

-- CreateIndex
CREATE UNIQUE INDEX "business_calendar_access_grants_itemId_userId_key" ON "business_calendar_access_grants"("itemId", "userId");

-- CreateIndex
CREATE INDEX "business_calendar_history_itemId_createdAt_idx" ON "business_calendar_history"("itemId", "createdAt");

-- AddForeignKey
ALTER TABLE "business_calendar_items" ADD CONSTRAINT "business_calendar_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendar_items" ADD CONSTRAINT "business_calendar_items_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendar_checklist_items" ADD CONSTRAINT "business_calendar_checklist_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "business_calendar_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendar_evidence" ADD CONSTRAINT "business_calendar_evidence_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "business_calendar_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendar_access_grants" ADD CONSTRAINT "business_calendar_access_grants_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "business_calendar_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_calendar_history" ADD CONSTRAINT "business_calendar_history_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "business_calendar_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;

