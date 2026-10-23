# 03 — Domain Model

All tables are company-scoped (`companyId`), additive (`prisma/sql/add_business_engine.sql`) and use
`Decimal` columns with an explicit `currencyCode` for money. Existing registries are referenced, never duplicated.

## Ownership

| Entity | Table | System of record | Notes |
|---|---|---|---|
| Client | `business_partners` (CLIENT) | CRM | FK from assignments |
| Opportunity | `opportunities` | Sales | Pipeline anchor; stage/probability stay in Sales |
| Contract | `contracts` | Contracts | Contracted anchor (ACTIVE/RENEWED, or opportunity WON) |
| Employee, skills, leave | `employees`, `employee_skills`, `leave_requests` | HR | Read for capacity |
| Skill catalog | `skills` (+ nullable `parentId`) | HR (shared) | Hierarchy added for the engine |
| Invoices, bank | `invoices`, `bank_accounts`, `payments` | Finance | Read-only actuals for cash |
| Project execution | — | PMO | Synced via `PUT /engine/integrations/pmo/progress` |

## Engine tables

| Group | Tables | Purpose |
|---|---|---|
| Settings | `engine_settings`, `engine_settings_revisions` | Central policies (JSON validated by `domain/config.ts`), versioned, `confirmedAt` ends the "illustrative" state |
| Catalog | `engine_services`, `engine_service_requirements`, `engine_service_lifecycle_events`, `engine_service_versions`, `engine_service_scores`, `engine_packages`, `engine_package_items` | Service master data, effort profile (resource mix), lifecycle history, immutable template versions, score history, reusable packages |
| Resources | `engine_resources`, `engine_resource_rates`, `engine_resource_skills`, `engine_resource_absences` | Capacity units (employee-backed or external), effective-dated confidential rates, skills of non-employees, non-availability |
| Assignments | `engine_assignments`, `engine_demands`, `engine_milestones`, `engine_adjustments`, `engine_forecast_versions` | Service sold on a contract/opportunity, named or unfilled demand, payment milestones, append-only scope changes, immutable economics snapshots (ESTIMATE, CONTRACT_BASELINE, APPROVED_BUDGET, FORECAST, ACTUAL) |
| Simulation | `engine_scenarios`, `engine_scenario_runs`, `engine_optimization_runs` | Scenario operations; runs store input snapshot, operations, parameters, engine version, result |
| Management | `engine_alerts`, `engine_actions`, `engine_recommendations`, `engine_decisions`, `engine_decision_events`, `engine_recalibrations` | Monitoring, corrective actions, recommendations (RULE/AI), decision workflow with audit trail, recalibration proposals |

Models without `deletedAt` are listed in `PrismaService.SOFT_DELETE_EXEMPT`. Soft-deleted: services, packages,
resources, assignments, scenarios.

## Commitment (derived, never stored)

`COMPLETED` if assignment status COMPLETED; `CONTRACTED` if the contract is ACTIVE/RENEWED or the opportunity is WON;
otherwise `PIPELINE`. Pipeline items on LOST/CANCELLED opportunities, or without opportunity and approved override,
are excluded and listed in `meta.excluded`.

## Engine snapshot

`apps/api/src/modules/business-engine/snapshot.service.ts` assembles the immutable `EngineSnapshot`
(`packages/shared/src/business-engine.d.ts`) from the systems of record. Every calculation — live views,
scenarios, Monte Carlo, optimizer — works on such a snapshot; scenario and optimization runs persist it.
