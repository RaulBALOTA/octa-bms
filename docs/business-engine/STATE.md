# Business Engine — Implementation State

_Last updated: 2026-10-23 (checkpoint 1)_

## Current phase
Phase 1–7 domain engine complete and tested; API/UI integration in progress.

## Completed
- Audit + plan (01, 02).
- Schema: `engine_*` tables, `skills.parentId`; `prisma/sql/add_business_engine.sql`, `grant_business_engine_permissions.sql`, `prisma/setup-business-engine.ts`.
- Permissions module `engine` (seed + shared catalog + role grants).
- Domain engine `apps/api/src/modules/business-engine/domain`: money, calendar/time model, config, portfolio (economics, capacity allocation, P&L, cash/VAT), scenario ops + comparison + sensitivity/break-even, Monte Carlo, sourcing (make/buy/hire), optimizer (HiGHS MILP), intelligence (benchmarks, recalibration, attractiveness, alerts, rule recommendations).
- Dependency: `highs` (MIT, WASM) in apps/api.

## Tests
`pnpm exec vitest run src/modules/business-engine` → 50 passed (cases A–H covered).

## Next step
Implement Nest services/controllers (snapshot builder from DB), then web UI.
