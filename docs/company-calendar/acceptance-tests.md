# Validation record

Baseline: pnpm typecheck and pnpm build pass; 121 API + 8 web unit tests pass. Existing bundle-size warning. pnpm lint fails because eslint is not installed; no ESLint config was found. This is a pre-existing tooling limit.

New checks:

Final results: 148 unit tests (136 API + 12 web), 57 database-backed checks, 3 browser journeys, workspace typecheck/build and actual API smoke all pass. Lint remains unavailable because the baseline has no installed ESLint.

- Calendar unit tests: impossible/leap dates, Berlin spring/autumn DST, original-anchor recurrence, all-day exclusive end, timed interval/offset validation, domain/privacy predicates, explainable score, unknown fields/status writes/missing versions.
- PostgreSQL integration: clean schema and existing company fixtures; additive migration preserves fixture; cross-company/private/finance/HR boundaries; active member validation; read-only shares; evidence/checklist requirements; history; stale/concurrent edits; concurrent recurrence completion creates one next occurrence; until end; provider mirrors cannot mutate/delete unrelated obligations; rollback on invalid date.
- Playwright (local installed Edge via OCTA_TEST_BROWSER_CHANNEL=msedge): complete obligation/evidence/history journey, all view modes, URL/saved filters, 390px modal focus containment/Escape, disabled feature.
- Read-only actual localhost API smoke: capabilities/members/items/horizon 200 and enabled=true, unauthenticated 401, invalid company 403. No actual calendar records were created.

Commands:

```powershell
pnpm typecheck
pnpm test
pnpm build
# apps/api — creates and removes only unique calendar_test_* PostgreSQL schemas
pnpm exec tsx --env-file=.env test/company-calendar.integration.ts
pnpm exec tsx --env-file=.env test/company-calendar.smoke.ts
# root — installed Edge, otherwise install Playwright's standard browser separately
$env:OCTA_TEST_BROWSER_CHANNEL = 'msedge'
pnpm --filter @octa-bms/web test:e2e -- company-calendar.e2e.ts
```

No Graph/Teams/AI connection or live tenant verification claimed. Browser tests mock API for deterministic UI journeys; database tests exercise real Prisma transactions separately. Full application E2E suite and accessibility certification are not claimed.
