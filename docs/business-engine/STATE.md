# Business Engine — Implementation State

_Last updated: 2026-10-23 (checkpoint 4)_

## Current phase
Phases 0–9 implemented as vertical slices (database → API → UI → tests → docs). Hardening items below remain.

## Completed
- Audit, plan, docs 03–13.
- Schema (`engine_*`, `skills.parentId`), additive SQL + guarded setup script, permission grants, seed roles.
- Deterministic engine (`apps/api/src/modules/business-engine/domain`): time model, economics, capacity allocation,
  P&L, cash/VAT, scenarios, sensitivity/break-even, Monte Carlo, make/buy/hire, HiGHS MILP optimizer,
  benchmarks/recalibration, attractiveness, alerts, rule recommendations.
- API (`BusinessEngineModule`): settings, catalog/templates/packages/skills, resources, assignments/demand/actuals/
  versions, PMO adapter, analytics + CSV, scenario runs (sync + background), optimization runs, intelligence, AI advisor.
- Web (`apps/web/src/features/business-engine`, routes `/engine/*`): cockpit, services, portfolio, resources,
  financials (+ make/buy), scenarios, optimization, intelligence, settings; de/en; validated chart palette.

## Files
- API: `apps/api/src/modules/business-engine/**`, `prisma/schema.prisma` (section 18), `prisma/sql/add_business_engine.sql`,
  `prisma/sql/grant_business_engine_permissions.sql`, `prisma/setup-business-engine.ts`, `prisma/seed.ts`,
  `src/core/prisma/prisma.service.ts`, `src/app.module.ts`, `test/business-engine.http.ts`.
- Shared: `packages/shared/src/business-engine.d.ts`, `permissions.ts`.
- Web: `src/features/business-engine/**`, `src/main.tsx`, `src/app/nav.ts`, `src/i18n/engine.{de,en}.json`,
  `src/i18n/index.ts`, `src/index.css`, `tests/business-engine.e2e.ts`.

## Tests executed
- `pnpm typecheck` ✔, `pnpm test` ✔ (API incl. 69 engine tests; web 23).
- `test/business-engine.http.ts` against the compiled API + PostgreSQL 16 ✔.
- `tests/business-engine.e2e.ts` (Playwright) ✔. Manual UI review via screenshots (de/en).

## Known limitations / defects
- Monte Carlo cost scales with portfolio size (~0.15 s/iteration at 200 assignments); runs are background jobs.
  A full integer-cent rewrite of the engine would speed this up.
- Optimizer capacity model is monthly with per-skill + total constraints (relaxation for multi-skill resources);
  verification reports residual shortages.
- Server-generated explanation texts (optimizer reasons, diagnostics, alert details) are English only.
- PMO integration needs a machine account with `engine.portfolio.update` (no API-key auth in the repository).
- Approved scenarios/decisions are not "applied" automatically to source modules by design; follow-up is manual.
- Duration benchmarks use planned dates until the PMO reports actual dates.

## Architecture decisions
See 02_IMPLEMENTATION_PLAN.md §Architecture decisions (no new project table, single deterministic engine, Decimal money,
segment time model, HiGHS, in-process jobs, type-only shared contracts).

## Exact next step
Confirm business settings with management, then: (1) machine-account/API-key support for PMO sync; (2) localise
server-generated explanation texts; (3) optional integer-cent engine core for faster Monte Carlo at large scale.
