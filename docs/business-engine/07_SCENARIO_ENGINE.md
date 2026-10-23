# 07 — Scenario Engine

## Separation

1. Input snapshot (`SnapshotService.build`) 2. assumption overrides (`applyOperations`, deep copy — live data is never
mutated) 3. calculation (`computePortfolio`) 4. persistence (`engine_scenario_runs`: input snapshot, operations,
parameters, seed, engine version, result) 5. comparison (`compareMetrics`) 6. explanation (operation log with affected
counts and notes, e.g. "contracted work cannot be lost").

## Operations (`ScenarioOperation`, validated by `validateOperations`)

WIN, LOSE, SHIFT, STRETCH, PRICE (pipeline only unless `includeContracted`), EFFORT, SCOPE, PROBABILITY, HIRE (payroll +
ramp-up capacity), FREELANCER (variable cost capacity), REMOVE_RESOURCE (named demand returns to pool), OUTSOURCE,
LABOR_COST, OVERHEAD, PAYMENT_TERMS, PAYMENT_DELAY, STOP_SERVICE (pipeline only), OPENING_CASH, NEW_SERVICE. Operations
without a target select nothing.

## Metrics

revenue, contribution, margin, operating result, end/min cash, peak deficit, financing requirement, utilization,
shortage hours, over-allocations, fixed cost commitment (capacity cost + overhead), top client share, unabsorbed capacity.

## Runs

- DETERMINISTIC — synchronous, stored with baseline metrics and deltas; `POST /engine/scenario-runs/:id/verify`
  recomputes from stored inputs and compares canonically (key-order independent).
- SENSITIVITY — one parameter (PRICE, HOURS, INTERNAL_RATE, EXTERNAL_RATE, DURATION, PROBABILITY, PAYMENT_DELAY) over
  steps; break-even by bisection over a wide range, reported only when the metric changes sign (monotonicity assumed and
  disclosed).
- MONTE_CARLO — background job (`EngineJobRunner`, max 2 concurrent, cancellable, interrupted runs marked FAILED on
  restart). Seeded PRNG (mulberry32). Award outcomes share a market factor and effort deviations a delivery factor
  (one-factor Gaussian copula, ρ configurable) — no independence assumption; mutually exclusive groups never win
  together. Triangular start delay, effort factor and collection delay. Output: mean, P5–P95, probabilities of negative
  cash, cash below reserve, capacity overload, operating loss. Labelled SIMULATED. Iterations capped by settings.

## Make / buy / partner (`domain/sourcing.ts`)

Options INTERNAL, HIRE, FREELANCE, SUBCONTRACT, PARTNER, HYBRID with explicit costs, capacity, lead time, coordination
and quality-control effort, minimum commitments. Hiring: employer cost = salary × (1 + configured employer %) +
benefits; productive hours = weekly × productive weeks × (1 − non-billable %); onboarding loss 37.5 % over the
onboarding weeks; break-even utilization = (employer + recruiting cost) / (bill rate × productive hours); break-even
hours vs. freelance = fixed cost / freelance rate. Recommendation = highest contribution among feasible options (ties →
lower fixed exposure) with basis, assumptions, risks and alternatives; external options always disclose OCTA's continuing
contractual responsibility.
