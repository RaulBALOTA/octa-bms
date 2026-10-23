# 01 — Repository Audit (OCTA Business Engine)

Audit date: 2026-10-23 · Baseline commit `4a9257c` · Baseline checks: `pnpm typecheck` green,
API unit tests 185/185, web unit tests 23/23.

## 1. Existing architecture

| Area | Finding |
|---|---|
| Monorepo | pnpm workspaces: `apps/api` (NestJS 10), `apps/web` (React 18 + Vite), `packages/shared` (types/constants). |
| Backend | Modular monolith, one Nest module per business area under `apps/api/src/modules/*`. Controllers are thin; business logic in services; pure calculation modules exist (`hr/staffing-budget.calculation.ts`, `business-calendar/calendar-domain.ts`). |
| Database | PostgreSQL 16 via Prisma 5 (`apps/api/prisma/schema.prisma`, ~100 models). **No Prisma migrations folder**: schema changes ship as reviewed additive SQL in `prisma/sql/*.sql` plus a guarded local setup script (`prisma/setup-*.ts`, backs up with `pg_dump`, refuses remote hosts). `prisma db push --force-reset` is banned. |
| Soft delete | `PrismaService` filters `deletedAt` on every model **not** listed in `SOFT_DELETE_EXEMPT`. Every new model without `deletedAt` must be added there, otherwise reads fail. |
| Money | `Decimal(18,2)` columns; staffing calculations use `Prisma.Decimal` (decimal.js) with half-up cent rounding. Older code (treasury cash flow, BI reports) still uses `Number()` — not reused for new money math. |
| Auth | JWT (+ refresh rotation), global guards: `JwtAuthGuard` → `CompanyContextGuard` (X-Company-Id, membership check) → `PermissionsGuard` (`@RequirePermission(...codes)`, all required). `user.permissions` is populated for field-level filtering. |
| RBAC | Codes `module.resource.action` (actions read/create/update/delete/approve/export). Catalog duplicated in `packages/shared/src/permissions.ts` and `prisma/seed.ts`; roles seeded by regex: SYSTEM_ADMIN, MANAGING_DIRECTOR, SALES_MANAGER, FINANCE_MANAGER, HR_MANAGER, EMPLOYEE. Module-only grants also ship as idempotent SQL (`grant_business_calendar_permissions.sql`). |
| Multi-company | Business tables carry `companyId`; every query is scoped by `@CompanyId()`. |
| Audit | `AuditInterceptor` + `AuditService.log/diff` → `audit_logs`. |
| Notifications | `NotificationsService.notify({userIds,type,...})` → in-app notification center; `ExpiryScannerService` uses `@nestjs/schedule` cron. |
| Background jobs | No BullMQ queue is wired despite docs; only `@nestjs/schedule` crons. |
| AI | `AiGatewayService.complete()` — provider abstraction over the Anthropic SDK, JSON-schema structured output, audit log of token usage, typed `ServiceUnavailableException` codes when not configured. Model via `AI_MODEL`. No local-model integration. |
| API docs | Swagger at `/api/docs` (`@ApiTags`, `@ApiBearerAuth`). URI versioning `/api/v1`. Global `ValidationPipe` (whitelist + forbidNonWhitelisted). |
| Frontend | React Router routes in `main.tsx`, side navigation `app/nav.ts`, module sub-navigation via `SubNav`. TanStack Query for server state, `api` fetch client, Tailwind tokens, `components/ui.tsx` (Button, Field, Dialog, Drawer, Tabs, Toast, Skeleton, KeyValue), `components/charts.tsx` (BarChart, HBarList). i18n via i18next with de/en JSON; large modules use separate resource files (`calendar.de.json`). |
| Tests | Vitest unit specs colocated (`*.spec.ts`); PostgreSQL integration scripts under `apps/api/test/*.postgres.ts` (tracked fixtures, cleanup); Playwright e2e under `apps/web/tests`. CI runs typecheck, unit tests, `db push`, seed, build. |

## 2. Existing entities and system-of-record ownership

| Concept in the spec | Existing entity | Owner | Engine usage |
|---|---|---|---|
| Client registry | `BusinessPartner` (type CLIENT) | CRM | Referenced by FK; never duplicated. |
| Suppliers / partners / engineering offices | `BusinessPartner` (SUPPLIER/PARTNER) | CRM | External resources may reference a partner. |
| Opportunities | `Opportunity` (stage, probability, estimatedValue, expectedAward) | Sales | Pipeline source; service assignments reference `opportunityId`. Stage/probability stay owned by Sales. |
| Proposals / fee calculation | `Proposal`, `FeeCalculationLine` | Sales | Not duplicated; future import source for demand lines. |
| Contracted projects | `Contract` (+ `PaymentMilestone`, `VariationOrder`) | Contracts | The BMS has **no project table**: the PMO owns execution. A contract is the commercial anchor of a "project" in the engine. Assignments reference `contractId`, optionally `externalProjectRef` (PMO id). |
| Employees | `Employee` (weeklyHours, status, hire/exit dates) | HR | Internal resources reference `employeeId`. |
| Employment cost | `EmploymentContract.annualSalary` | HR | Not read automatically (privacy). Engine cost rates are explicit, effective-dated, permission-protected. |
| Skills | `Skill` (global catalog), `EmployeeSkill` (level 1–5) | HR | Reused as the skills taxonomy; additive `parentId` column for hierarchy. Employee skills read from `EmployeeSkill`; only non-employee resources get engine-owned skills. |
| Absences | `LeaveRequest` (APPROVED) | HR | Read as planned absence for employee-backed resources. |
| Invoices / receivables | `Invoice` (direction, status, contractId, net/gross/paid, dueDate) | Finance | Read-only: invoiced-to-date per contract and open AR/AP feed the cash forecast as *actual* events. The engine never creates invoices or payments. |
| Cash balance | `BankAccount.openingBalance` + `Payment` | Finance | Read-only opening cash for forecasts. |
| Budgets | `Budget`/`BudgetLine` | Finance | Not overwritten. Overhead is configured in engine settings. |
| Staffing plans | `StaffingBudgetScenario` | HR/Finance | Separate concern (hiring cost budget); hiring scenarios in the engine are independent simulations. |
| Notifications | `Notification` | Platform | Alerts notify owners through `NotificationsService`. |
| AI | `AiGatewayService` | Platform | Advisor reuses the gateway; no new provider. |

## 3. Missing functionality (to be built)

Service catalog and packages; resource/capacity model with effective-dated rates; project service
assignments and demand lines; economics (revenue models, direct cost, contribution, overhead
allocation, EAC); time-phased capacity; cash-flow forecasting with VAT timing; scenarios with
isolated snapshots; sensitivity and Monte Carlo; make/buy/partner; MILP optimization; service
attractiveness; performance monitoring, alerts, corrective actions; benchmarks and recalibration;
AI advisor with read-only tools; decision workflow; reports/CSV; engine configuration.

## 4. Integration opportunities

- Opportunities → pipeline assignments (probability from Sales or stage table in engine config).
- Contracts → contracted backlog; Invoices → invoiced-to-date and open AR/AP; Bank accounts → opening cash.
- LeaveRequest → absences; EmployeeSkill → skills; Employee.weeklyHours → default capacity.
- PMO → `PUT /engine/integrations/pmo/progress` (idempotent upsert by `externalProjectRef` + service code). No PMO client exists in the repo; no data is fabricated.

## 5. Data-model implications

- New tables prefixed `engine_*`, all company-scoped, additive. No changes to existing columns except
  one nullable `skills.parentId`.
- Models without `deletedAt` (revisions, runs, events) must be added to `SOFT_DELETE_EXEMPT`.
- Scenario and optimization runs store their full input snapshot, operations, configuration and
  engine version (reproducibility).

## 6. Security implications

- New permission module `engine` with resources `services`, `resources`, `portfolio`, `economics`,
  `scenarios`, `optimization`, `intelligence`, `settings`.
- Cost rates, purchase rates and margins require `engine.economics.read`; resource endpoints strip
  them otherwise (project managers do not see payroll-derived data).
- Simulations never write to finance/contract/sales tables; decisions never mutate commercial records.

## 7. Migration risks

- Production databases are maintained by SQL scripts, not `prisma migrate`. The new SQL is
  transactional and additive; the setup script refuses remote hosts and backs up first.
- Permission rows for `engine.*` must be inserted on existing databases (`grant_business_engine_permissions.sql`), as the normal seed only adds missing rows.

## 8. Recommended implementation order

Foundation (schema, permissions, config) → pure calculation engine with tests → catalog/resources →
assignments/economics → capacity → cash/portfolio → scenarios → optimization → monitoring →
advisor → UI per area → integration verification. See `02_IMPLEMENTATION_PLAN.md`.

## 9. Decisions requiring business configuration

All values below ship as **illustrative defaults** in engine settings and must be confirmed by management:
stage probabilities, working days/holidays, non-project time share, overhead per month, overhead
allocation method, VAT rate and payment lag, default payment terms, minimum cash reserve, financing
limit, score weights, alert thresholds, benchmark minimum sample size, German employer cost
percentage for hiring scenarios, onboarding ramp-up.
