# 10 — API and Integrations

Base `/api/v1/engine`, JWT + `X-Company-Id`, global `ValidationPipe` (whitelist, forbid unknown). Swagger tag
`business-engine` at `/api/docs`. Errors: Nest standard; deterministic input errors → `400 { code, message }`.

| Area | Endpoints (permission) |
|---|---|
| Settings | `GET/PUT /settings`, `GET /settings/revisions` (engine.settings.*) — optimistic `expectedVersion`, `confirm` |
| Catalog | `GET/POST /services`, `GET/PUT/DELETE /services/:id`, `POST /services/:id/lifecycle`, `GET /services/:id/versions/:v`, `GET/POST /packages`, `PUT/DELETE /packages/:id`, `GET/POST /skills`, `PUT /skills/:id/parent`, `GET /templates`, `POST /templates/apply` (engine.services.*) |
| Resources | `GET/POST /resources`, `POST /resources/import-employees`, `GET/PUT/DELETE /resources/:id`, `POST /resources/:id/rates` (+ engine.economics.update), `PUT /resources/:id/skills`, `POST/DELETE /resources/:id/absences` (engine.resources.*) |
| Assignments | `GET /assignments` (paged, filters), `GET /assignments/references`, `GET/PUT/DELETE /assignments/:id`, `POST /assignments`, `POST /assignments/from-package/:packageId`, `POST /assignments/:id/status`, demand CRUD + `regenerate`, milestones, adjustments, `actuals`, `forecast-versions`, `GET /assignments/:id/economics` (+ economics.read) (engine.portfolio.*) |
| PMO | `PUT /integrations/pmo/progress` (engine.portfolio.update) |
| Analytics | `GET /analytics/overview`, `/portfolio`, `/attractiveness` (economics.read); `/capacity` (resources.read, no money); `/benchmarks` (services.read); `POST /analytics/sourcing`; `GET /analytics/reports`, `GET /analytics/reports/:code` CSV (economics.export) |
| Scenarios | `GET/POST /scenarios`, `GET/PUT/DELETE /scenarios/:id`, `POST /scenarios/:id/duplicate`, `/status`, `/runs`; `GET /scenario-runs/:id`, `POST /scenario-runs/:id/cancel`, `/verify`; `POST /scenario-compare` |
| Optimization | `GET/POST /optimizations`, `GET /optimizations/:id`, `POST /optimizations/:id/cancel` |
| Intelligence | alerts (`GET`, `POST scan`, `POST :id/status`), actions, recommendations (`generate`, `:id/status`), decisions (`POST`, `:id/status`, `:id/outcome`, `GET quality`), recalibrations (`generate`, `:id/decision` — services.approve), advisor (`GET`, `tools/:name`, `analyze`, `ask`) |

Query filters for analytics: `mode` (CONTRACTED|EXPECTED|ALL_WIN), `asOf`, `serviceId`, `clientId`, `departmentId`
(responsible manager's department), `scenarioId` (apply a saved scenario).

## PMO adapter (stable identifiers, idempotent)

```json
PUT /api/v1/engine/integrations/pmo/progress
{ "externalProjectRef": "PMO-4711", "serviceCode": "B-PM", "asOf": "2026-10-23",
  "actualHours": 1500, "remainingHours": 600, "percentComplete": 60, "actualCost": "98000.00", "status": "ACTIVE" }
```
Matches the assignment by `externalProjectRef` + service code; unknown references → 404 (nothing is created).
Updates older than the stored `actualsAsOf` are ignored (`applied: false`), so replays and out-of-order deliveries are
safe. Totals are distributed over demand lines proportionally to planned hours. A machine account needs
`engine.portfolio.update` (API keys are not implemented in this repository yet).

## Finance, CRM, Sales, HR

Read-only, via `SnapshotService`. FX conversion through `exchange_rates.rateToEUR`; missing rates exclude the assignment
with a reason instead of guessing.
