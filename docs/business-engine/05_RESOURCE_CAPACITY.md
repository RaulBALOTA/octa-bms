# 05 — Resource Capacity

## Time model (`domain/calendar.ts`)

UTC calendar days; working days = Mon–Fri minus nationwide German holidays (computed, Easter-based) and configured
extra dates. The horizon is split into *segments* (week ∩ month); weeks (ISO, Monday start), months, quarters and years
are exact unions of segments, so summaries never contradict each other. Hours and amounts are spread over working days
(`rangeFractions`).

## Capacity per resource and week

```
nominal     = weekly hours / 5 × working days in activity window
absence     = nominal-day × absence fraction (approved HR leave + engine absences)
non-project = (nominal − absence) × non-project %
available   = min((nominal − absence − non-project) × ramp-up factor, nominal × max allocation %)
```
Ramp-up (hires): linear from 25 % to 100 % over the onboarding weeks. Paid hours ≠ available hours.

## Allocation (weekly)

1. Named lines consume their resource (over-allocation is allowed and reported).
2. Unfilled internal lines are allocated to free qualified capacity: contracted before pipeline, scarcest skill first;
   internal resources before external, then lower cost rate. Qualification = skill or a descendant skill with level ≥
   seniority level (JUNIOR 1 … PRINCIPAL 5).
3. Remaining hours are **shortage** (visible gap, priced at the shortage rate).

In EXPECTED mode pipeline hours are probability-weighted (expected demand ≠ reservation); ALL_WIN shows overload.

## Outputs

Per resource: nominal, absence, non-project, available, planned, billable, utilization, billable utilization and weekly
cells (heatmap). Per skill: demand, covered, shortage per week. Bottlenecks: RESOURCE_OVERLOAD (planned > available) and
SKILL_SHORTAGE, aggregated by month with the affected assignments.
