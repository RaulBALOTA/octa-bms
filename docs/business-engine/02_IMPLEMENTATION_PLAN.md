# 02 — Implementation Plan

Dependency-aware phases. Each phase ships database + API + UI + tests + docs as a vertical slice.

| Phase | Scope | Depends on | Acceptance |
|---|---|---|---|
| 0 | Audit, architecture, plan, STATE.md | — | Docs 01/02 exist; baseline checks recorded. |
| 1 | Schema (`engine_*` tables), SQL migration + setup script, `engine.*` permissions, engine settings, service catalog (taxonomy templates, lifecycle history, versions, requirements), packages, skills hierarchy, resources (rates, skills, absences) | 0 | Services and packages are manageable; skills linked without touching HR data. |
| 2 | Project service assignments (contract/opportunity/PMO ref), demand lines, milestones, revenue models, cost model, contribution, overhead allocation, forecast versions (estimate/baseline/budget/forecast) | 1 | A project with several services is evaluated per service and in total. |
| 3 | Time model (workday-weighted buckets: week/month/quarter/year), capacity, demand (contracted, weighted, overload), utilization, bottlenecks, unfilled demand | 2 | Over-allocation and missing skills detected (case C). |
| 4 | Portfolio: backlog, weighted pipeline, revenue/contribution forecast, company P&L (unabsorbed capacity, overhead), cash events (AR/AP actuals + forecast invoices/receipts/payments, VAT), working capital, overview cockpit | 2, 3 | Contracted vs expected vs scenario values are distinguished (cases E, F). |
| 5 | Scenarios: snapshot + operations, isolated recalculation, comparison, sensitivity + break-even, seeded Monte Carlo with common-factor correlation, make/buy/partner + hiring break-even | 4 | Alternatives compared without mutating live data (case D). |
| 6 | MILP optimization with HiGHS (selection, sourcing mode, capacity/cash/exclusion constraints), LP-bound gap, explainability, async runs with cancellation | 5 | Correct solver status; constraints respected (case G). |
| 7 | Monitoring: variance, alert rules with dedupe + notifications, corrective actions, benchmarks, recalibration proposals, attractiveness scoring | 2–4 | Actuals influence forecasts via approved recalibration (case H). |
| 8 | AI advisor (read-only tools, grounded structured recommendations, refs), rule-based recommendations when AI is off, decision workflow + audit | 7 | AI cannot write records; engine works with AI disabled (case I). |
| 9 | Hardening: PostgreSQL integration test, authorization specs, CSV reports, docs 03–13, operations runbook | all | Module verified end-to-end. |

## Architecture decisions

1. **No new project table.** A "project" is a contract (contracted) or an opportunity (pipeline);
   assignments reference them plus an optional PMO reference.
2. **One deterministic engine** (`apps/api/src/modules/business-engine/domain`), pure functions on an
   `EngineSnapshot`. Live views, scenarios, Monte Carlo and the optimizer all call the same code.
3. **Money in `Prisma.Decimal`**, hours as numbers rounded at output. Bucket allocation uses
   largest-remainder cent distribution so bucket totals reconcile exactly.
4. **Single time model:** amounts are distributed by working days; weeks, months, quarters and years
   are aggregations of the same daily weights, so summaries cannot contradict each other.
5. **Solver:** HiGHS (MIT, WASM via npm `highs`) — no second backend language.
6. **Async runs** in-process with persisted status (no queue infrastructure exists); bounded by limits.
7. **Shared contracts** in `packages/shared/src/business-engine.d.ts` (type-only, like staffing budgets).
