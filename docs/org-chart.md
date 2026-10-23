# Org chart staffing and versions

HR → Org Chart combines departments, positions, occupants and reporting lines. A department manager sits directly under the department, with its branches below.

Positions have three displayed states:

- **Open:** an unfilled position available for staffing.
- **Budgeted:** an unfilled position included in the company's staffing plan.
- **Filled:** at least one active, non-deleted employee of the selected company is assigned to the position.

Open/Budgeted plans are stored per company, even when the position definition is shared. Filled is calculated from active employee assignments. An occupied position cannot be marked Open or Budgeted; an unoccupied position cannot be manually marked Filled. When the last active occupant leaves, the position returns to its saved Open/Budgeted plan.

Recruitment automatically lists the selected company's **Open positions** from the current chart. Budgeted and Filled positions are excluded. The list refreshes when opening Recruitment or returning focus, and staffing-state edits invalidate it immediately. Saved org chart versions do not change this live recruitment list. Recruiters can use a position's **New opening** button to create a job opening with the title and department prefilled; existing job openings and applicant pipelines remain available separately.

Users with both `hr.employees.read` and `hr.employees.update` can change vacancy states and save versions. Readers can browse versions and compare them with the current chart. Existing administrator record actions still manage position definitions and employee assignments.

**Save version** captures a named, immutable snapshot containing departments, positions, effective statuses, employee names and assignments, managers and department hierarchy. Version numbers increase separately for each company. Each version records its author, timestamp and optional note. Saved versions have no edit, delete, or restore endpoint. Selecting a version switches both chart views to the snapshot and hides record editing actions. Company switching returns to the current chart.

Status changes automatically save the before and after charts in the same transaction as the staffing-plan update. Other structural and employee edits are captured with Save version. Comparison lists added, removed and changed departments, position definitions and employees, including staffing status and reporting/assignment changes.

Snapshots are created server-side with serializable transactions and retried on concurrency conflicts. Requests never accept a client-supplied snapshot or version number. Version reads and writes are scoped to the selected company.

## Local database setup

Run from `apps/api`:

```powershell
pnpm prisma:generate
pnpm exec tsx --env-file=.env prisma/setup-org-chart.ts --apply
```

The setup script checks the schema, takes a PostgreSQL backup under `backups/`, and applies `prisma/sql/add_org_chart_versioning.sql` to a local database. The migration only adds the position status enum and two tables; it does not rewrite existing position or employee records. Existing occupied positions automatically display Filled and existing unfilled positions default to Open.

For a managed database, back up first and apply the reviewed SQL through the normal database deployment process. Restart the API after generating its Prisma client. The app uses Europe/Berlin for version timestamp display.

Verification from `apps/api`:

```powershell
pnpm exec vitest run src/modules/hr/org-chart.controller.spec.ts
pnpm exec tsx --env-file=.env test/org-chart.postgres.ts
```

The PostgreSQL test creates tracked temporary fixtures, checks isolation, staffing transitions, immutable snapshots and concurrent version numbering, then removes only those fixtures.
