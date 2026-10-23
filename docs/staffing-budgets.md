# Company-linked recruitment and staffing budgets

In Recruitment, New opening selects active departments and offices from the current company's master data. An opening launched from an Open position preselects its department. The API validates both IDs against that company, stores the relationships and retains the corresponding name snapshots for legacy displays. The migration links existing names only when exactly one active company record matches.

## Staffing planner

Open **HR → Staffing budgets** or use **Staffing budgets** in the Finance navigation. `finance.budgets.read` permits loading plans and running calculations; `finance.budgets.create` and `finance.budgets.update` control saving new and existing plans respectively.

The planner uses the company's default currency and fiscal-year start. The fiscal start year defines a 12-month horizon, which may cross a calendar-year boundary. Select Open positions, Budgeted positions, or both; Filled positions are excluded from new plans. Each eligible position can have several planned hires using its headcount input. Each hire has a fraction of a full-time employee (FTE), from greater than zero to 1.

Enter annual salary, annual bonus, monthly benefits, employer-cost percentage, hiring fee per person, planned hiring date, forecast hiring date and hiring probability. Forecast annual salary can override the budget salary. An optional end date supports fixed-term plans. Assign an active company office for location totals. Initial costs are zero until the user enters assumptions; no statutory employer rates or salaries are guessed.

For each active month, recurring cost is:

```text
((annual salary + annual bonus) / 12 × (1 + employer-cost % / 100)
 + monthly benefits) × headcount × FTE × active-days / days-in-month
```

Annual bonus is spread evenly over the year. Employer-cost percentage applies to salary plus bonus; monthly benefits are added separately. The active fraction uses actual calendar days, including leap years. Start and end dates are inclusive. A hiring fee is charged once in the hiring month, multiplied by headcount; fees are not multiplied by FTE and are excluded when hiring occurred before the horizon.

Budget uses the planned start date. Forecast uses the forecast start date and forecast salary, and weights recurring costs and hiring fees by hiring probability. Expected FTE is weighted by that probability as well. Forecast minus budget gives the variance. This is a staffing-cost projection, without actual payroll spend or automatic tax calculations.

Calculations run on the API with decimal arithmetic. Each position's monthly amount is rounded to cents with half-up rounding; position, month, department, office and grand totals sum those rounded amounts so reports reconcile. The UI includes monthly comparisons and a chart, position totals, department and office totals, and an export of monthly costs and assumptions as CSV.

## Saving and refreshing

Save plan persists the assumptions and server-calculated results. Every save adds an immutable revision with its author, timestamp and optional revision note. Historical revisions are read-only and can be exported. Save as new plan creates an independent scenario. Existing scenarios require their current version number when updated; a concurrent edit is rejected instead of overwriting another user's work.

Saved reports keep the names, staffing states, locations, currency and fiscal calendar used when saved. They remain readable if master data changes. **Refresh positions** reconciles the draft with current Open/Budgeted positions, preserves assumptions for positions still eligible, removes filled/unavailable positions, and adds new eligible positions with zero-cost defaults. A calculation or save rejects positions that have become filled or unavailable; refresh the draft to continue. Calculation inputs and saved plans cannot reference another company's positions or offices.

These plans do not automatically post to or overwrite the Finance cost-center budget. Their totals and CSV can be used to prepare that budget.

## Setup and checks

From `apps/api`, regenerate Prisma and apply the additive migration after backing up:

```powershell
pnpm prisma:generate
pnpm exec tsx --env-file=.env prisma/setup-staffing-budgets.ts --apply
```

The setup script backs up the local database under `backups/`, adds the department/office references on job openings, and creates staffing scenario/revision tables. It rejects automatic setup against a remote database. Use the reviewed `prisma/sql/add_staffing_budgets.sql` with the normal deployment workflow for other databases.

Validation:

```powershell
pnpm exec vitest run src/modules/hr/staffing-budget.calculation.spec.ts src/modules/hr/staffing-budget.controller.spec.ts
pnpm exec tsx --env-file=.env test/org-chart.postgres.ts
```

The PostgreSQL checks create and clean up tracked temporary fixtures. They cover company-owned references, budgeting/forecasting, revisions, concurrent saves, org chart versions and recruitment visibility.

Add `--http` to the PostgreSQL command when the local API is running to verify the compiled API's calculation, persistence and company-reference endpoints using a temporary test account.
