# 12 — User Guide

Navigation: **Business Engine** in the sidebar. Sub-pages appear according to your permissions.

## First-time setup

1. **Settings** — review every policy (working time, rates, stage probabilities, overhead, cash reserve, VAT, hiring,
   thresholds, optimization, Monte Carlo). Shipped values are *illustrative*; a banner appears on every page until you
   choose **Save and confirm as company policy**.
2. **Services → Apply OCTA templates** — creates the A–G taxonomy (52 services), 7 packages and the skills hierarchy.
   No prices are seeded; effort profiles are illustrative. Edit, re-parent or retire freely.
3. **Resources → Import employees** — one resource per active employee (capacity from HR weekly hours). Add cost
   rates (confidential, effective-dated; monthly fixed cost for payroll), external freelancers/partners, absences.
4. **Project portfolio → New assignment** — choose client, contract (contracted) or opportunity (pipeline), service or
   package, fee model and billing. Demand is generated from the template; adjust lines, name resources or leave them
   unfilled (they stay visible as capacity demand).

## Daily / weekly use

- **Overview** — backlog, weighted pipeline, revenue, contribution, operating result, minimum cash, utilization; each
  KPI has an ⓘ definition and a basis badge (Actual, Contracted, Forecast, Weighted, Simulated, Missing). Filters: view
  (contracted / expected / all-win), client, service, unit, scenario. Click tiles or charts to drill down.
- **Resources** — weekly heatmap (red "!" = over-allocated), skill gaps, bottlenecks.
- **Project portfolio → assignment → Actuals** — record actual and remaining hours (or let the PMO sync them); record
  versions (contract baseline, approved budget) to enable variance tracking.
- **Intelligence → Run checks** — alerts (hours overrun, margin erosion, unfilled demand, overload, overdue collection,
  cash below reserve, concentration, management time, rate increases). Acknowledge, resolve, or create corrective actions.

## Planning

- **Scenarios** — combine assumptions (win/lose, shift, price, hires, freelancers, outsourcing, payment delays, new
  service …), **Calculate**, run **Monte Carlo** or **Sensitivity**, tick up to three scenarios to compare.
  Nothing in live data changes.
- **Financial performance → Make / buy** — compare internal, hire, freelance, subcontract and partner delivery.
- **Optimization** — set objective weights deliberately, constraints and hire options, **Optimize**. Read the solver
  status (Optimal / Feasible / Infeasible), decisions with reasons, binding constraints and the verification.
  **Create decision** to start the approval workflow.

## Decisions and learning

Recommendations (rule-based, or AI when configured) → **Turn into decision** → Under review → Approved/Rejected →
Implemented → record the actual outcome. **Recalibration** proposes effort updates from completed assignments; templates
change only after approval and keep version history.

## Reports

Financial performance → **Export report (CSV)**: service profitability, assignment profitability, financial forecast,
cash flow, resource utilization, capacity gaps. Each file states period, data status, settings status, currency,
engine version and generation time.
