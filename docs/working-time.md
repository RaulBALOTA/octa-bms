# Working time & PMO connection

**Working time** (sidebar, `/time`) plans and records employees' working time and links it to the hours the EPCM teams book on projects in the PMO app (RaulBALOTA/PMO-Web, `services/api`). The PMO app stays the system of record for project hours. BMS owns attendance, target time, flexitime balances, approvals and capacity planning.

## Pages

| Page | Path | Permission | Purpose |
|---|---|---|---|
| My time | `/time` | `time.records.read` | Clock in/out, record attendance blocks, book project hours, see each day's target/actual/break/project time, ArbZG notices, flexitime balance, and submit the week |
| Team & approvals | `/time/team` | `time.timesheets.approve` | Approve or reject submitted weeks (four-eyes rule), reopen weeks, see a team-week overview (target, actual, project hours, time not on projects, ArbZG notices), export CSV |
| Capacity planning | `/time/planning` | `time.planning.read` | Weekly board per employee: planned project hours vs. available hours (after holidays and leave), plus hours actually booked (BMS + PMO); allocate hours over a week range |
| Work schedules | `/time/schedules` | `time.schedules.read` | Working-time models (target minutes Mon–Sun, core time, default) and their dated assignment to employees |
| PMO connection | `/time/pmo` | `time.integration.read` | Connection status, manual sync, sync history, PMO users that could not be matched |

Time managers (`time.timesheets.approve`) may act on any employee of the company: they use the employee picker on *My time*. Everyone else only sees and changes their own data. Users act through the employee record linked to their user (`employees.userId`). Without that link *My time* explains what to do.

Seeded roles: **EMPLOYEE** gets `time.records.*` (except export/approve), `time.timesheets.read|create` and `time.planning.read`. **HR_MANAGER** and **SYSTEM_ADMIN** get every `time.*` permission. **MANAGING_DIRECTOR** gets read/approve/export. Re-run `pnpm db:seed` on existing databases to add the new permissions to these roles.

## Rules

**Target time.** For each day, the schedule assignment valid on that day applies. Without one, the employee's contractual `weeklyHours` are spread evenly over Mon–Fri. Without those, the company's default schedule applies, and failing that 40 h. Days before `hireDate` or after `exitDate` have no target. Public holidays (`company_calendar_events` of type `HOLIDAY`, company-specific or global) and approved leave of type vacation, sick, special, unpaid or parental set the target to zero. Approved *overtime compensation* keeps the target, so the day is paid from the flexitime balance. *Home office* is a place of work, not an absence.

**Delta and balance.** Delta = worked − target per day. Days after today contribute no target yet. By default the flexitime balance runs from 1 January, the hire date or the first recorded day, whichever is latest, until today. An employee without any record has no balance yet.

**ArbZG checks** (shown per day; stored with each submitted timesheet):

| Code | Rule |
|---|---|
| `MAX_DAILY_EXCEEDED` | more than 10 h worked (§3) |
| `BREAK_TOO_SHORT` | > 6 h needs 30 min, > 9 h needs 45 min (§4). Recorded breaks plus gaps of ≥ 15 min between blocks count |
| `REST_PERIOD_TOO_SHORT` | less than 11 h between the end of the previous working day and the first start (§5) |
| `SUNDAY_HOLIDAY_WORK` | work on a Sunday or public holiday (§9), warning |
| `WEEKLY_OVER_48` | more than 48 h in one week, warning |
| `MISSING_CLOCK_OUT` | a block of a past day is still open. It blocks submitting the week |

Times are entered and evaluated in `TIME_ZONE` (default `Europe/Berlin`); conversion is DST-safe. An end time earlier than the start means the next day. A single block is at most 16 h. Blocks of the same employee must not overlap. Working time cannot be recorded in advance.

**Timesheets.** `DRAFT → SUBMITTED → APPROVED | REJECTED`. Submitting stores a totals and ArbZG snapshot. Submitted and approved weeks are locked for attendance and project hours, PMO mirroring included. The employee can withdraw a submitted week. A time manager approves it, or rejects it with a mandatory reason. A manager cannot decide on their own week. A time manager can reopen a submitted or approved week (back to draft).

**Planning.** An allocation is hours per employee, project and week (`time_allocations`). *Allocate* writes the same hours to every week of a range; `0` removes them. Utilization = planned ÷ available. Cell colours: < 50 % light, 50–89 % green, 90–100 % amber, > 100 % red.

## PMO connection

### Pull (PMO → BMS)

Configure the API (`apps/api/.env`):

```dotenv
PMO_API_URL=https://pmo.example.com       # PMO services/api base URL
PMO_SERVICE_EMAIL=bms-sync@octa.example   # PMO user used by BMS
PMO_SERVICE_PASSWORD=…
PMO_SYNC_DAYS=35                           # rolling window
PMO_SYNC_ENABLED=true                      # hourly background sync (all active companies)
```

Each sync logs in with `POST /api/auth/login`, then reads:

- `GET /api/workforce/timesheets?days=N`: PMO `TimeEntry` rows joined to task, project and user
- `GET /api/users`: maps the PMO `userId` to an e-mail
- `GET /api/projects?archived=include`: mirrored into `pmo_projects` for project pickers. A project without a code becomes `PMO-<id>`

Entries are matched to BMS employees by e-mail: the employee's `workEmail` or the e-mail of the linked user, case-insensitive. Each matched entry is mirrored into `project_time_entries` with `source = PMO` and `externalId = PMO TimeEntry.id`. Re-syncing is idempotent. Changed entries are updated, and entries PMO no longer reports inside the window are removed. Entries without a project are booked to `UNASSIGNED`. Mirrored entries are read-only in BMS.

PMO entries are never changed inside a submitted or approved week; they are counted as *Locked* in the sync history, and the next sync after the week is reopened applies them. PMO users without a matching employee are listed as *unmatched* with their hours.

PMO currently returns at most 500 timesheet rows per call (newest first). When the cap is hit, BMS removes entries only on days it received completely and reports `truncated`. Shorten `PMO_SYNC_DAYS` or sync more often if that happens.

### Push (PMO → BMS, optional)

PMO or middleware can push changes immediately, with a BMS user holding `time.integration.create`:

```http
POST /api/v1/time/integration/pmo/entries
Authorization: Bearer <BMS access token>
X-Company-Id: <company id>

{ "entries": [{ "id": "8812", "userEmail": "a.engineer@octa.example", "date": "2026-10-20",
                "hours": 6.5, "projectCode": "P-2026-014", "projectName": "Refinery Revamp",
                "taskTitle": "Piping ISOs", "billable": true }],
  "deletedIds": ["8790"] }
```

### Read-back (BMS → PMO)

For PMO resource planning, `GET /api/v1/time/integration/capacity?from=YYYY-MM-DD&to=YYYY-MM-DD` (`time.integration.read`, ≤ 26 weeks) returns, per employee (keyed by e-mail and employee number) and ISO week: contract hours, available hours after holidays and leave, absence days, and the BMS project allocations.

## API overview (`/api/v1/time`)

| Method | Path | Permission |
|---|---|---|
| GET | `week?week=&employeeId=` · `balance` · `projects` | `time.records.read` |
| POST/PUT/DELETE | `records`, `entries` · `clock-in` · `clock-out` | `time.records.create/update/delete` |
| GET | `timesheets?status=&week=` | `time.timesheets.read` |
| POST | `timesheets/submit` · `timesheets/:id/withdraw` | `time.timesheets.create` |
| POST | `timesheets/:id/decide` · `timesheets/:id/reopen` · GET `team` | `time.timesheets.approve` |
| GET | `export.csv?from=&to=&employeeId=` (`;`-separated, decimal comma, for payroll/DATEV preparation) | `time.timesheets.export` |
| GET/POST/PUT | `schedules` · `schedule-assignments` | `time.schedules.*` |
| GET | `capacity?from=&weeks=&departmentId=&projectCode=` | `time.planning.read` |
| POST/DELETE | `allocations` | `time.planning.create/delete` |
| GET/POST | `integration/pmo` · `integration/pmo/sync` · `integration/pmo/entries` · `integration/capacity` | `time.integration.*` |

## Setup and checks

From `apps/api`, after a backup:

```powershell
pnpm prisma:generate
pnpm exec tsx --env-file=.env prisma/setup-working-time.ts --apply   # local DB: backs up, applies prisma/sql/add_working_time.sql
pnpm prisma:seed                                                     # adds time.* permissions to the system roles
```

For other databases, apply the reviewed, additive `prisma/sql/add_working_time.sql` with the normal deployment workflow.

Validation:

```powershell
pnpm exec vitest run src/modules/working-time
pnpm test:time:postgres
```

The PostgreSQL check applies the migration on top of the previous schema in a temporary, uniquely named schema and drops only that schema. It covers attendance, overlaps, access scoping, ArbZG rules, timesheet locking and four-eyes approval, planning, schedules, CSV, and the PMO pull/push/read-back against an in-process fake of the PMO API.
