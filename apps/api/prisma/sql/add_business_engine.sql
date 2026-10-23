-- OCTA Business Engine — additive schema (docs/business-engine/03_DOMAIN_MODEL.md).
-- Creates engine_* tables and the nullable skills.parentId column. No existing data is changed.
BEGIN;
-- AlterTable
ALTER TABLE "skills" ADD COLUMN     "parentId" TEXT;

-- CreateTable
CREATE TABLE "engine_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "config" JSONB NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_settings_revisions" (
    "id" TEXT NOT NULL,
    "settingsId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_settings_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_services" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "parentId" TEXT,
    "lifecycle" TEXT NOT NULL DEFAULT 'PROPOSED',
    "ownerEmployeeId" TEXT,
    "targetSegments" TEXT[],
    "projectTypes" TEXT[],
    "contractModel" TEXT,
    "revenueModel" TEXT NOT NULL DEFAULT 'TIME_AND_MATERIALS',
    "deliveryModel" TEXT NOT NULL DEFAULT 'INTERNAL',
    "externalDeliveryAllowed" BOOLEAN NOT NULL DEFAULT true,
    "typicalDurationWeeks" INTEGER,
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "targetHourlyRate" DECIMAL(12,2),
    "targetMarginPct" DECIMAL(6,2),
    "workingCapitalProfile" TEXT,
    "commercialRisk" INTEGER,
    "technicalRisk" INTEGER,
    "contractualRisk" INTEGER,
    "strategicImportance" INTEGER,
    "repeatability" INTEGER,
    "scalability" INTEGER,
    "crossSelling" INTEGER,
    "referenceValue" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engine_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_service_requirements" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "skillId" TEXT,
    "role" TEXT NOT NULL,
    "seniority" TEXT NOT NULL DEFAULT 'PROFESSIONAL',
    "typicalHours" DECIMAL(10,2) NOT NULL,
    "internalSharePct" DECIMAL(5,2) NOT NULL DEFAULT 100,
    "costRate" DECIMAL(12,2),
    "externalRate" DECIMAL(12,2),
    "billRate" DECIMAL(12,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "engine_service_requirements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_service_lifecycle_events" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "fromState" TEXT,
    "toState" TEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_service_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_service_versions" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_service_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_service_scores" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "total" DECIMAL(6,2) NOT NULL,
    "confidence" DECIMAL(5,4) NOT NULL,
    "configVersion" INTEGER NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_service_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_packages" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engine_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_package_items" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "hoursFactor" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "feeOverride" DECIMAL(18,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "engine_package_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_resources" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "employeeId" TEXT,
    "partnerId" TEXT,
    "displayName" TEXT NOT NULL,
    "weeklyHours" DECIMAL(5,2) NOT NULL,
    "maxAllocationPct" DECIMAL(5,2) NOT NULL DEFAULT 90,
    "nonProjectPct" DECIMAL(5,2) NOT NULL DEFAULT 15,
    "activeFrom" TIMESTAMP(3),
    "activeTo" TIMESTAMP(3),
    "location" TEXT,
    "remoteEligible" BOOLEAN NOT NULL DEFAULT true,
    "languages" TEXT[],
    "restrictions" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engine_resources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_resource_rates" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "costRate" DECIMAL(12,2) NOT NULL,
    "billRate" DECIMAL(12,2),
    "monthlyFixedCost" DECIMAL(18,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_resource_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_resource_skills" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,

    CONSTRAINT "engine_resource_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_resource_absences" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "fraction" DECIMAL(4,3) NOT NULL DEFAULT 1,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_resource_absences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_assignments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "contractId" TEXT,
    "opportunityId" TEXT,
    "externalProjectRef" TEXT,
    "serviceId" TEXT NOT NULL,
    "packageId" TEXT,
    "title" TEXT NOT NULL,
    "scope" TEXT,
    "deliverables" TEXT,
    "responsibleEmployeeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "feeModel" TEXT NOT NULL,
    "fixedFee" DECIMAL(18,2),
    "hourlyRate" DECIMAL(12,2),
    "dailyRate" DECIMAL(12,2),
    "hoursPerDay" DECIMAL(4,2),
    "monthlyRetainer" DECIMAL(18,2),
    "capexBasis" DECIMAL(18,2),
    "capexBasisDefinition" TEXT,
    "capexPercent" DECIMAL(6,3),
    "billing" TEXT NOT NULL DEFAULT 'MONTHLY',
    "paymentTermDays" INTEGER,
    "vatRatePct" DECIMAL(5,2),
    "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
    "travelCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "softwareCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "otherCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "subcontractFixedCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "probabilityOverride" INTEGER,
    "probabilityNote" TEXT,
    "exclusiveGroup" TEXT,
    "shiftableWeeks" INTEGER NOT NULL DEFAULT 0,
    "actualHours" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "actualCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "actualRevenue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "percentComplete" DECIMAL(5,2),
    "actualsAsOf" TIMESTAMP(3),
    "risks" TEXT,
    "assumptions" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engine_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_demands" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "skillId" TEXT,
    "role" TEXT NOT NULL,
    "seniority" TEXT NOT NULL DEFAULT 'PROFESSIONAL',
    "hours" DECIMAL(10,2) NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "resourceId" TEXT,
    "sourcing" TEXT NOT NULL DEFAULT 'INTERNAL',
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "costRate" DECIMAL(12,2),
    "externalRate" DECIMAL(12,2),
    "location" TEXT,
    "actualHours" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "remainingHours" DECIMAL(10,2),
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "overrideNote" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "engine_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_milestones" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "isInvoiced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "engine_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_adjustments" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SCOPE_CHANGE',
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_forecast_versions" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "engineVersion" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_forecast_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_scenarios" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "mode" TEXT NOT NULL DEFAULT 'EXPECTED',
    "operations" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "copiedFromId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "engine_scenarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_scenario_runs" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "scenarioVersion" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'DETERMINISTIC',
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "engineVersion" TEXT NOT NULL,
    "seed" INTEGER,
    "parameters" JSONB,
    "inputSnapshot" JSONB NOT NULL,
    "operations" JSONB NOT NULL,
    "result" JSONB,
    "error" TEXT,
    "runtimeMs" INTEGER,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "engine_scenario_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_optimization_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "configuration" JSONB NOT NULL,
    "inputSnapshot" JSONB NOT NULL,
    "result" JSONB,
    "objectiveValue" DECIMAL(20,2),
    "bound" DECIMAL(20,2),
    "gapPct" DECIMAL(9,4),
    "runtimeMs" INTEGER,
    "engineVersion" TEXT NOT NULL,
    "error" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "engine_optimization_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_alerts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "metric" JSONB,
    "ownerUserId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "resolution" TEXT,

    CONSTRAINT "engine_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_actions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "alertId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "ownerUserId" TEXT,
    "dueDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_recommendations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "proposedAction" TEXT NOT NULL,
    "estimatedBenefit" TEXT,
    "assumptions" TEXT,
    "confidence" TEXT NOT NULL,
    "risks" TEXT,
    "responsibleRole" TEXT,
    "priority" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "refs" JSONB,
    "aiModel" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_decisions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "context" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "recommendationId" TEXT,
    "scenarioId" TEXT,
    "optimizationRunId" TEXT,
    "expectedImpact" JSONB,
    "actualOutcome" TEXT,
    "outcomeRecordedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_decision_events" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_decision_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_recalibrations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "currentValue" DECIMAL(14,2) NOT NULL,
    "proposedValue" DECIMAL(14,2) NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "statistics" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "engine_recalibrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "engine_settings_companyId_key" ON "engine_settings"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "engine_settings_revisions_settingsId_version_key" ON "engine_settings_revisions"("settingsId", "version");

-- CreateIndex
CREATE INDEX "engine_services_companyId_category_idx" ON "engine_services"("companyId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "engine_services_companyId_code_key" ON "engine_services"("companyId", "code");

-- CreateIndex
CREATE INDEX "engine_service_requirements_serviceId_idx" ON "engine_service_requirements"("serviceId");

-- CreateIndex
CREATE INDEX "engine_service_lifecycle_events_serviceId_createdAt_idx" ON "engine_service_lifecycle_events"("serviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "engine_service_versions_serviceId_version_key" ON "engine_service_versions"("serviceId", "version");

-- CreateIndex
CREATE INDEX "engine_service_scores_serviceId_createdAt_idx" ON "engine_service_scores"("serviceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "engine_packages_companyId_code_key" ON "engine_packages"("companyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "engine_package_items_packageId_serviceId_key" ON "engine_package_items"("packageId", "serviceId");

-- CreateIndex
CREATE INDEX "engine_resources_companyId_kind_idx" ON "engine_resources"("companyId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "engine_resource_rates_resourceId_effectiveFrom_key" ON "engine_resource_rates"("resourceId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "engine_resource_skills_resourceId_skillId_key" ON "engine_resource_skills"("resourceId", "skillId");

-- CreateIndex
CREATE INDEX "engine_resource_absences_resourceId_startDate_idx" ON "engine_resource_absences"("resourceId", "startDate");

-- CreateIndex
CREATE INDEX "engine_assignments_companyId_status_idx" ON "engine_assignments"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_assignments_contractId_idx" ON "engine_assignments"("contractId");

-- CreateIndex
CREATE INDEX "engine_assignments_opportunityId_idx" ON "engine_assignments"("opportunityId");

-- CreateIndex
CREATE INDEX "engine_assignments_companyId_externalProjectRef_idx" ON "engine_assignments"("companyId", "externalProjectRef");

-- CreateIndex
CREATE INDEX "engine_demands_assignmentId_idx" ON "engine_demands"("assignmentId");

-- CreateIndex
CREATE INDEX "engine_demands_resourceId_idx" ON "engine_demands"("resourceId");

-- CreateIndex
CREATE INDEX "engine_milestones_assignmentId_idx" ON "engine_milestones"("assignmentId");

-- CreateIndex
CREATE INDEX "engine_adjustments_assignmentId_idx" ON "engine_adjustments"("assignmentId");

-- CreateIndex
CREATE INDEX "engine_forecast_versions_assignmentId_kind_idx" ON "engine_forecast_versions"("assignmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "engine_forecast_versions_assignmentId_version_key" ON "engine_forecast_versions"("assignmentId", "version");

-- CreateIndex
CREATE INDEX "engine_scenarios_companyId_status_idx" ON "engine_scenarios"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_scenario_runs_scenarioId_createdAt_idx" ON "engine_scenario_runs"("scenarioId", "createdAt");

-- CreateIndex
CREATE INDEX "engine_optimization_runs_companyId_createdAt_idx" ON "engine_optimization_runs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "engine_alerts_companyId_status_idx" ON "engine_alerts"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_alerts_companyId_dedupeKey_idx" ON "engine_alerts"("companyId", "dedupeKey");

-- CreateIndex
CREATE INDEX "engine_actions_companyId_status_idx" ON "engine_actions"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_recommendations_companyId_status_idx" ON "engine_recommendations"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_decisions_companyId_status_idx" ON "engine_decisions"("companyId", "status");

-- CreateIndex
CREATE INDEX "engine_decision_events_decisionId_createdAt_idx" ON "engine_decision_events"("decisionId", "createdAt");

-- CreateIndex
CREATE INDEX "engine_recalibrations_companyId_status_idx" ON "engine_recalibrations"("companyId", "status");

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_settings" ADD CONSTRAINT "engine_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_settings_revisions" ADD CONSTRAINT "engine_settings_revisions_settingsId_fkey" FOREIGN KEY ("settingsId") REFERENCES "engine_settings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_services" ADD CONSTRAINT "engine_services_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_services" ADD CONSTRAINT "engine_services_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "engine_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_services" ADD CONSTRAINT "engine_services_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_service_requirements" ADD CONSTRAINT "engine_service_requirements_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_service_requirements" ADD CONSTRAINT "engine_service_requirements_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_service_lifecycle_events" ADD CONSTRAINT "engine_service_lifecycle_events_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_service_versions" ADD CONSTRAINT "engine_service_versions_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_service_scores" ADD CONSTRAINT "engine_service_scores_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_packages" ADD CONSTRAINT "engine_packages_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_package_items" ADD CONSTRAINT "engine_package_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "engine_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_package_items" ADD CONSTRAINT "engine_package_items_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resources" ADD CONSTRAINT "engine_resources_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resources" ADD CONSTRAINT "engine_resources_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resources" ADD CONSTRAINT "engine_resources_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resource_rates" ADD CONSTRAINT "engine_resource_rates_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "engine_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resource_skills" ADD CONSTRAINT "engine_resource_skills_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "engine_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resource_skills" ADD CONSTRAINT "engine_resource_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_resource_absences" ADD CONSTRAINT "engine_resource_absences_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "engine_resources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "business_partners"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_opportunityId_fkey" FOREIGN KEY ("opportunityId") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "engine_packages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_assignments" ADD CONSTRAINT "engine_assignments_responsibleEmployeeId_fkey" FOREIGN KEY ("responsibleEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_demands" ADD CONSTRAINT "engine_demands_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "engine_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_demands" ADD CONSTRAINT "engine_demands_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_demands" ADD CONSTRAINT "engine_demands_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "engine_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_milestones" ADD CONSTRAINT "engine_milestones_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "engine_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_adjustments" ADD CONSTRAINT "engine_adjustments_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "engine_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_forecast_versions" ADD CONSTRAINT "engine_forecast_versions_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "engine_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_scenarios" ADD CONSTRAINT "engine_scenarios_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_scenario_runs" ADD CONSTRAINT "engine_scenario_runs_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "engine_scenarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_optimization_runs" ADD CONSTRAINT "engine_optimization_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_alerts" ADD CONSTRAINT "engine_alerts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_actions" ADD CONSTRAINT "engine_actions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_actions" ADD CONSTRAINT "engine_actions_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "engine_alerts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_recommendations" ADD CONSTRAINT "engine_recommendations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_decisions" ADD CONSTRAINT "engine_decisions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_decisions" ADD CONSTRAINT "engine_decisions_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "engine_recommendations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_decision_events" ADD CONSTRAINT "engine_decision_events_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "engine_decisions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_recalibrations" ADD CONSTRAINT "engine_recalibrations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_recalibrations" ADD CONSTRAINT "engine_recalibrations_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "engine_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
