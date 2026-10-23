# 08 — Optimization Engine

Implementation: `domain/optimizer.ts`, solver **HiGHS** (MIT, WASM build from npm `highs`), no additional backend
language. Runs are asynchronous (`POST /engine/optimizations`, polled), stored with configuration, input snapshot and
engine version.

## Model

- **Baseline**: contracted work only — fixed, never a decision variable.
- **Variables**: binary per (opportunity, variant): AS_PLANNED, EXTERNAL (unfilled internal demand outsourced at the
  default external rate × (1 + markup), only if every service allows external delivery), SHIFT by ½ and the full
  permissible window; binary per hire option; continuous `P` for peak working capital.
- **Coefficients** per variant from the engine itself (`standardCosting`, `excludeCompanyCosts`): contribution,
  incremental operating profit (revenue − external costs), end cash, monthly cumulative cash delta, monthly hours per
  named resource / skill pool / total.
- **Constraints** (monthly): named-resource free capacity, skill-pool free capacity (qualified resources, hire capacity
  added), total internal free capacity, closing cash ≥ reserve − credit line, one variant per opportunity (= 1 if
  mandatory), mutually exclusive groups, `P ≥ opening − closing_m`.
- **Objectives**: CONTRIBUTION, OPERATING_PROFIT, CASH, PEAK_WORKING_CAPITAL, RISK_ADJUSTED_VALUE (contribution ×
  probability × (1 − 0.1 × (risk − 1)), disclosed), STRATEGIC (revenue × strategic score / 5); weighted after
  normalisation by the largest coefficient. Basis IF_WON (default) or EXPECTED (probability-weighted value); capacity and
  cash constraints always assume the selection is won (no double promising of capacity).

## Integrity

Solver status mapping: Optimal → OPTIMAL; time limit with incumbent → FEASIBLE (not proven optimal); time limit without
→ TIMED_OUT; Infeasible → INFEASIBLE (with diagnostics, e.g. "contracted work alone breaches the cash floor"); else
FAILED. Runtime, variables/constraints, objective, LP-relaxation bound and gap are reported.

## Explainability

Per candidate: selected/rejected, variant, objective coefficient, LP reduced cost, reasons (better variant blocked,
exclusive rival selected, blocking binding constraints, no positive contribution) and all alternatives. Binding
constraints with LP shadow prices (value of one more hour / euro). Baseline overloads. **Verification**: the selected
portfolio is recomputed with the full weekly engine; extra shortage hours (multi-skill effects) are reported.

## Approximations (disclosed in every result)

Monthly capacity granularity with per-skill + total constraints (necessary conditions for multi-skill resources),
month-end cash, standard cost rates for unfilled internal demand.
