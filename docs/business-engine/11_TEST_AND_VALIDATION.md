# 11 — Test and Validation

## Unit (Vitest) — `apps/api/src/modules/business-engine/**/*.spec.ts` (69 tests)

| Case | Spec | Verified |
|---|---|---|
| A small feasibility | portfolio.spec | 25,000 fee, 120 h × 80 + 3,000 → cost 12,600, contribution 12,400 (49.6 %), 60/60 h phasing, receipt +30 days |
| B EPCM expansion | portfolio.spec | four services (fixed, T&M, milestone, retainer) = 400,000 revenue, 166,000 contribution, 41.5 % |
| C bottleneck | portfolio.spec | named overload 80 h; skill shortage 80 h priced at shortage rate; freelancer resolves; under-qualified ignored |
| D make/buy | scenario.spec | employer cost 84,700, productive 1,472 h, ramp loss 144 h, break-even 47.95 %, hire vs. freelancer by demand and lead time |
| E cash stress | portfolio.spec | min −60,000 on 31 Jul, peak deficit 70,000, financing need 60,000, project peak need 40,000 |
| F pipeline | portfolio.spec | backlog 80,000, pipeline 150,000 / weighted 60,000; contracted/expected/all-win revenue |
| G optimization | optimizer.spec | chooses P2+P3 (17,800) over greedy P1; exclusivity; contracted never deselected; external sourcing; infeasible reported; cash floor; hire unlocks value |
| H underperformance | portfolio.spec | 400 h at completion (+100), cost 32,000, margin 36 % (−16 pts) |
| I AI unavailable | test/business-engine.http.ts | analyze → 503 while all deterministic endpoints work |

Plus: money allocation exactness (incl. > 2^53 cents fallback), holidays/working days, segments, VAT timing, retainer,
daily, CAPEX, hybrid, effective-dated rates, absences, scenario isolation, empty-target safety, sensitivity break-even,
reproducible Monte Carlo with exclusive groups, benchmark statistics and recalibration, shrinkage ranking, alert rules,
rule recommendations, permission metadata, operation validation, CSV formula neutralisation.

## Integration (PostgreSQL + HTTP)

`apps/api/test/business-engine.http.ts` against a running API: tracked temporary fixtures, cleanup verified. Covers
templates (idempotent), lifecycle history, cost redaction for a project-manager role (403 on rates/economics, capacity
without money), assignment validation, package assignments, invoiced-to-date from finance, cockpit KPIs, CSV, settings
validation/confirmation, scenario isolation (no live mutation), reproducibility, Monte Carlo and sensitivity jobs,
comparison, HiGHS run in the compiled API, PMO sync incl. stale/unknown refs, alert dedupe, actions, recommendations,
decision workflow, AI-off, pseudonymised advisor tools, tenant isolation.

## E2E (Playwright) — `apps/web/tests/business-engine.e2e.ts`

Mocked API backed by the real engine: cockpit KPIs/definitions/illustrative banner; project manager sees capacity but
neither cockpit nor rates.

## Commands

```bash
pnpm typecheck && pnpm test
pnpm --filter @octa-bms/api exec tsx --env-file=.env test/business-engine.http.ts http://localhost:3000
pnpm --filter @octa-bms/web test:e2e -- tests/business-engine.e2e.ts
```

## Note on DTO validation

Vitest/tsx do not emit decorator metadata. Free-form JSON fields (`operations`, `hireOptions`, `config`,
`objectiveWeights`) use a raw transform because implicit conversion otherwise corrupts them in the compiled API — the
HTTP test exercises the compiled path.

## Performance (single run, compiled, this container)

200 assignments / 40 resources / 18 months ≈ 0.2 s; 1,000 assignments / 3,000 demand lines / 150 resources / 24 months
≈ 0.8–1.1 s; Monte Carlo ≈ 0.15 s per iteration at the 200-assignment scale (background job).
