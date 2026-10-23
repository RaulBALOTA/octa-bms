# 04 — Service Economics

Implementation: `domain/portfolio.ts` (`computePortfolio`). Money is `Prisma.Decimal`; hours are numbers.

## Revenue (`revenueFor`)

| Fee model | Revenue |
|---|---|
| FIXED_FEE | fixed fee |
| TIME_AND_MATERIALS | billable hours × hourly rate |
| DAILY_RATE | billable hours ÷ hours per day × daily rate |
| RETAINER | monthly retainer × Σ(active calendar days in month ÷ days in month) |
| MILESTONE | Σ milestone amounts |
| CAPEX_PERCENT | eligible CAPEX basis × % (basis definition is mandatory; client CAPEX is not revenue) |
| HYBRID | fixed part + hourly rate × billable hours |

Approved adjustments (scope changes, amendments, variations) are added. Missing parameters yield 0 and the warning
`MISSING_FEE_PARAMETER:<field>` — revenue is never invented. Revenue at completion uses actual + remaining billable
hours; planned revenue uses planned hours.

## Direct cost

`cost at completion = actual cost to date + cost to complete`, where cost to complete =
internal labour (allocated hours × the resource's effective cost rate) + external labour (external line rate or
external resource rate) + unfilled demand (hours × configured shortage rate, flagged) + remaining expenses
(travel, software, other, subcontract lump sum × remaining share).

Remaining hours per line = `remainingHours` if reported, otherwise `max(0, planned − actual)`. Work scheduled before
the as-of date with remaining hours is moved to the next 4 weeks (`OVERDUE_WORK`). Work beyond the horizon is priced
at standard rates (`BEYOND_HORIZON`). Rate changes apply from the first segment (week ∩ month) starting on/after
their effective date.

## Contribution, overhead, operating result

- `contribution = revenue − direct cost`; `margin = contribution / revenue`, `null` when revenue ≈ 0.
- Assignment level: allocated overhead per configured method (NONE, % revenue, rate per internal hour, % direct cost);
  "result after allocation" is a costing convention.
- Company level (`pnl`): `operating result = contribution − unabsorbed capacity − overhead`, where unabsorbed capacity =
  internal capacity cost (payroll: monthly fixed cost prorated by days, or cost rate × nominal hours) − internal labour
  applied to assignments. This equals revenue − external costs − total personnel − overhead and is **not** mixed with
  project contribution.

## Variance and forecast versions

`hoursVariance = hours at completion − baseline hours`; `marginVariancePts = margin − baseline margin`. Baselines come
from the latest APPROVED_BUDGET, else CONTRACT_BASELINE forecast version. Versions are immutable; an ESTIMATE is taken on
creation and an ACTUAL on completion.

## Aggregates

`byService`, `byClient`, `byPackage` sum assignment values × weight (weight = 1 for contracted, probability in EXPECTED,
1 in ALL_WIN, 0 for pipeline in CONTRACTED). Assignment rows are unweighted.

## Benchmarks and attractiveness (`domain/intelligence.ts`)

Benchmarks use completed assignments (plan snapshot vs. ACTUAL snapshot): n, mean, median, P10/P25/P75/P90, stdev,
CV, Tukey outliers; confidence NONE/LOW/MEDIUM/HIGH by sample size (configured minimum) and dispersion.
Attractiveness normalises dimensions to 0–100 (margins on an absolute −10…60 % scale; assessments (v−1)/4; risks
inverted) and shrinks observed/forecast scores toward 50 with weight n/(n+k) (k = prior strength), so services without
history cannot outrank proven ones on optimistic assumptions. Weights are configurable; score versions are stored.
