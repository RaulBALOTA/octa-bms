# 10 — Permission Matrix

## Model

Permission code = `module.resource.action`. Actions: `read`, `create`, `update`, `delete`,
`approve`, `export`, `admin` (module settings). Roles bundle permissions; assignments can be
scoped **global / company / office / department** (`UserRole`). Additional row-level scopes
applied in repositories: `own` (records where user is owner/subject), `team`
(own department/reports).

## Built-in Roles

| Role | Intended for |
|---|---|
| SYSTEM_ADMIN | IT — everything incl. identity & settings |
| MANAGING_DIRECTOR (Geschäftsführung) | full business read + all approvals |
| DEPARTMENT_HEAD | team-scoped HR + own-module full access |
| SALES_MANAGER / SALES_USER | CRM + Sales |
| CONTRACT_MANAGER | Contracts + related CRM read |
| FINANCE_MANAGER / ACCOUNTANT | Finance (manager: approve + export) |
| HR_MANAGER / HR_ASSISTANT | HR (assistant: no salary fields — field-level mask) |
| LEGAL_COUNSEL | Legal + contracts read |
| PROCUREMENT_OFFICER | Procurement + supplier CRM |
| ASSET_MANAGER (often IT) | Assets + software licenses |
| EMPLOYEE (base role, everyone) | self-service: own profile/leave/trips/equipment/approvals, knowledge read, directory read |
| API_INTEGRATION (PMO) | scoped master-data read/write via API key |

## Matrix (R read · C create · U update · D delete · A approve · E export · — none · ○ own/team scope)

| Resource | SYS | MD | DEPT_HEAD | SALES | CONTRACT | FIN_MGR | ACCT | HR_MGR | LEGAL | PROC | ASSET | EMP |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| corporate.dashboard | RCUDE | RE | R○ | — | — | R | — | — | — | — | — | — |
| corporate.goals | RCUD | RCUDA | R | R | R | R | R | R | R | R | R | R |
| crm.partners | RCUDE | RE | R | RCUDE | R | R | R | — | R | R (suppliers) | — | — |
| crm.contacts | RCUDE | R | R | RCUD | R | R | R | — | R | R | — | — |
| sales.opportunities | RCUDE | RA | R○ | RCUDE | R | R | — | — | — | — | — | — |
| sales.proposals | RCUDE | RA | R○ | RCUDA | R | R | — | — | R | — | — | — |
| sales.gonogo | RCUD | RA | — | RCU | — | — | — | — | — | — | — | — |
| contracts.contracts | RCUDE | RA | R○ | R | RCUDAE | R | R | — | RU | R (supplier) | — | — |
| contracts.guarantees | RCUD | R | — | — | RCUD | RCU | R | — | R | — | — | — |
| finance.invoices.out | RCUDE | RA | — | R○ | R | RCUDAE | RCUE | — | — | — | — | — |
| finance.invoices.in | RCUDE | RA | A○ (own CC) | — | — | RCUDAE | RCUE | — | — | RC | — | — |
| finance.payments | RCUD | R | — | — | — | RCUDE | RCU | — | — | — | — | — |
| finance.budgets | RCUDE | RCUA | R○ | — | — | RCUDE | R | — | — | — | — | — |
| finance.datev | E | E | — | — | — | E | E | — | — | — | — | — |
| hr.employees | RCUDE | R | R○ | — | — | — | — | RCUDE | R | — | — | R (directory) ○self |
| hr.salaries (field-level) | R | R | — | — | — | R | — | RU | — | — | — | ○self |
| hr.leave | RCUDA | RA | RA○ | — | — | — | — | RCUDA | — | — | — | RC○self |
| hr.recruitment | RCUD | R | R○ | — | — | — | — | RCUDE | — | — | — | — |
| hr.reviews | RCUD | R | RCU○ | — | — | — | — | RCUD | — | — | — | R○self |
| legal.cases | RCUD | R | — | — | R | R | — | — | RCUDE | — | — | — |
| legal.gdpr | RCUD | R | — | — | — | — | — | R | RCUD | — | — | — |
| legal.whistleblower | R | — | — | — | — | — | — | — | RCUD | — | — | C (anonymous) |
| procurement.requests | RCUDA | RA | A○ | — | — | RA | — | — | — | RCUDE | — | RC○self |
| procurement.orders | RCUDE | RA | — | — | — | RA | R | — | — | RCUDAE | — | — |
| assets.assets | RCUDE | R | R○ | — | — | R | R | R | — | R | RCUDE | R○assigned |
| knowledge.articles | RCUDA | RA | RCU | RCU | RCU | RCU | R | RCU | RCUA | R | R | R + C(draft) |
| documents.documents | RCUDE | R | R○ | R○ | RCU○ | RCU○ | R○ | RCU○ | RCU○ | R○ | R○ | R○ (per-folder ACL) |
| workflow.definitions | RCUD | R | — | — | — | — | — | — | — | — | — | — |
| workflow.tasks | RCUD | RA | A○ | A○ | A○ | A○ | — | A○ | A○ | A○ | A○ | A○ (assigned) |
| bi.reports | RCUDE | RE | R○E | R○ | R○ | RE | R | R○E | R○ | R○ | R○ | — |
| identity.users/roles | RCUD | R | — | — | — | — | — | — | — | — | — | — |
| admin.masterdata | RCUD | R | — | — | — | — | — | — | — | — | — | — |
| admin.audit | RE | R | — | — | — | — | — | — | R | — | — | — |

Notes:
- **Approval authority follows thresholds**, not just roles: workflow assignee rules consult
  an amount-threshold table (e.g. incoming invoice ≤1k€ dept head, ≤10k€ finance manager,
  >10k€ managing director) — German signatory rules (Unterschriftenregelung).
- **Field-level security**: salary fields, applicant data and whistleblower reports use DTO
  masking per permission, not just row scope.
- **Document ACLs**: folder-level allow lists (users/groups/roles) override module defaults.
- Every `delete` is soft; only SYSTEM_ADMIN may restore.
