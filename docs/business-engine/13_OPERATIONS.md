# 13 — Operations

## Installation on an existing database

```bash
cd apps/api
pnpm prisma:generate
# local database (refuses remote hosts; pg_dump backup to ../../backups first):
pnpm exec tsx --env-file=.env prisma/setup-business-engine.ts --apply
```
For other environments apply, after a backup and review, through the normal deployment workflow:
1. `prisma/sql/add_business_engine.sql` — additive, transactional (new `engine_*` tables, nullable `skills.parentId`).
2. `prisma/sql/grant_business_engine_permissions.sql` — idempotent permission rows and role grants
   (SYSTEM_ADMIN, MANAGING_DIRECTOR: all; FINANCE_MANAGER: economics/scenarios/optimization/intelligence/portfolio + read;
   SALES_MANAGER: services/portfolio read-write, scenarios/intelligence read; HR_MANAGER: resources read-write).

Fresh databases: `pnpm db:push` then `pnpm db:seed` (the seed includes the `engine` module).

## Runtime

- Dependency `highs` (WASM solver) is bundled via `node_modules`; no extra service.
- Background runs execute in-process (max 2 concurrent). Runs still RUNNING at startup are marked FAILED
  ("Interrupted by an API restart"). With several API replicas, runs execute on the replica that received them.
- Daily alert scan at 05:30 (server time) for companies with assignments (`IntelligenceService.scheduledScan`);
  failures are logged per company.
- Retention: last 20 runs per scenario; optimization runs and alerts are kept (prune via SQL if needed).
- AI is optional (`ANTHROPIC_API_KEY`, `AI_MODEL`); without it the advisor returns 503 and everything else works.

## Monitoring

Pino logs (`EngineJobRunner`, `IntelligenceService`), audit log entries for all engine writes (entity types
`engine_*`), AI usage as `AI_CALL`. Health of runs: `engine_scenario_runs.status`, `engine_optimization_runs.status`.

## Rollback

The engine is additive. Disable by removing role grants for `engine.*`; drop tables only after an explicit review
(destructive migrations require approval per docs/15).

## Data protection

Personnel cost data (rates, monthly fixed cost, actual cost) requires `engine.economics.*`; capacity endpoints carry no
money; AI tools are pseudonymised. Employee skills/leave are read from HR, not copied.
