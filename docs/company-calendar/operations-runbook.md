# Setup and operations

From apps/api, with DATABASE_URL provided (local .env in development):

```powershell
# Read-only schema preflight
pnpm exec tsx --env-file=.env prisma/setup-company-calendar.ts
# Back up DB, install only calendar tables, grant existing standard roles
pnpm exec tsx --env-file=.env prisma/setup-company-calendar.ts --apply
# Local-only variant also updates the local feature flag
pnpm exec tsx --env-file=.env prisma/setup-company-calendar.ts --apply --enable-local
```

Requires pg_dump on PATH (override PG_DUMP_PATH). Setup refuses a partial calendar installation. Backups are uniquely named custom dumps under the ignored root backups directory. Permission installation is idempotent and modifies only the calendar permission catalog and existing standard-role grants; it never seeds users or demo events. Migration is transactional additive SQL generated against the pre-change checkout schema. No reset, db push or whole-checkout migration is needed.

For managed deployment, use the reviewed SQL files under apps/api/prisma/sql, regenerate Prisma client normally, set COMPANY_CALENDAR_ENABLED=true and restart the API. Verify actual role assignments and sensitive-domain permissions; custom roles are not automatically broadened. Example env defaults off; local env was enabled after successful migration tests. If the Windows Prisma engine is locked by a running process, stop/restart the development API for normal generation; this session generated into a temporary directory and retained the unchanged engine binary.

Smoke test (localhost only, read-only, uses local server signing material without printing it):

```powershell
pnpm exec tsx --env-file=.env test/company-calendar.smoke.ts
```

Rollback: set COMPANY_CALENDAR_ENABLED=false, restart API, roll back application deployment if needed. Preserve tables/history; do not drop data. Restore a backup only through the project's separately authorized DB recovery procedure. No background worker/Graph webhook is deployed by this release.

Operational limits: capped Horizon feed and paginated calendar/timeline; in-app automatic reminders and recurring job materialization are deferred. Completion generates one next date atomically. API availability depends on existing PostgreSQL/Nest operational monitoring. No new external integration health is asserted.
