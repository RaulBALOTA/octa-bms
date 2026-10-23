# Route → permission coverage map

Generated from live Nest metadata by `test/auth/platform.int.spec.ts` (run with
`WRITE_ROUTE_MAP=<file>`). The same test fails CI if a new route is public outside the
reviewed allow-list, or is authenticated without a permission code and is not in the
reviewed self-service list. A second test calls **every** non-public route anonymously
and with a pre-auth (MFA-pending) cookie and requires `401` for all of them.

"Self-service / in-code check" routes are reviewed in `AUTH_AUDIT.md` §3 (per-user data,
reference lists, super-admin-only record management, search/AI filtered by read
permissions, policy update restricted to system administrators in code).

| Method | Route (/api/v1) | Authentication | Permission | Step-up |
|---|---|---|---|---|
| GET | `/admin/security/config` | session | identity.security.read |  |
| GET | `/admin/security/events` | session | admin.audit.read |  |
| GET | `/admin/security/invitations` | session | identity.users.read |  |
| POST | `/admin/security/invitations` | session | identity.users.create | yes |
| POST | `/admin/security/invitations/:id/revoke` | session | identity.users.create |  |
| GET | `/admin/security/overview` | session | identity.security.read |  |
| GET | `/admin/security/policy` | session | identity.security.read |  |
| PATCH | `/admin/security/policy` | session | self-service / in-code check | yes |
| GET | `/admin/security/recovery-requests` | session | identity.security.read |  |
| POST | `/admin/security/recovery-requests` | session | identity.security.update | yes |
| POST | `/admin/security/recovery-requests/:id/approve` | session | identity.security.approve | yes |
| POST | `/admin/security/recovery-requests/:id/complete` | session | identity.security.update | yes |
| POST | `/admin/security/recovery-requests/:id/reject` | session | identity.security.update | yes |
| GET | `/admin/security/users` | session | identity.security.read |  |
| PATCH | `/admin/security/users/:id/mfa-required` | session | identity.security.update | yes |
| POST | `/admin/security/users/:id/revoke-sessions` | session | identity.security.update | yes |
| POST | `/ai/ask` | session | self-service / in-code check |  |
| POST | `/ai/draft` | session | self-service / in-code check |  |
| POST | `/ai/extract-invoice` | session | finance.invoices.create |  |
| GET | `/ai/status` | session | self-service / in-code check |  |
| POST | `/ai/summarize` | session | self-service / in-code check |  |
| GET | `/assets` | session | assets.assets.read |  |
| POST | `/assets` | session | assets.assets.create |  |
| GET | `/assets/:id` | session | assets.assets.read |  |
| POST | `/assets/:id/assign` | session | assets.assets.update |  |
| POST | `/assets/:id/return` | session | assets.assets.update |  |
| GET | `/auth/config` | public | — |  |
| POST | `/auth/invitations/accept` | public | — |  |
| POST | `/auth/invitations/preview` | public | — |  |
| POST | `/auth/login` | public | — |  |
| POST | `/auth/logout` | public | — |  |
| POST | `/auth/logout-all` | session | self-service / in-code check |  |
| GET | `/auth/me` | session | self-service / in-code check |  |
| POST | `/auth/mfa/disable` | session | self-service / in-code check | yes |
| POST | `/auth/mfa/enroll/confirm` | session or pre-auth | self-service / in-code check |  |
| POST | `/auth/mfa/enroll/start` | session or pre-auth | self-service / in-code check |  |
| GET | `/auth/mfa/methods` | session or pre-auth | self-service / in-code check |  |
| POST | `/auth/mfa/passkey/options` | session or pre-auth | self-service / in-code check |  |
| POST | `/auth/mfa/passkey/verify` | session or pre-auth | self-service / in-code check |  |
| POST | `/auth/mfa/recovery` | session or pre-auth | self-service / in-code check |  |
| POST | `/auth/mfa/verify` | session or pre-auth | self-service / in-code check |  |
| GET | `/auth/oidc/callback` | public | — |  |
| GET | `/auth/oidc/login` | public | — |  |
| GET | `/auth/oidc/status` | public | — |  |
| GET | `/auth/passkeys` | session | self-service / in-code check |  |
| DELETE | `/auth/passkeys/:id` | session | self-service / in-code check | yes |
| PATCH | `/auth/passkeys/:id` | session | self-service / in-code check |  |
| POST | `/auth/passkeys/register/options` | session | self-service / in-code check | yes |
| POST | `/auth/passkeys/register/verify` | session | self-service / in-code check | yes |
| POST | `/auth/password/change` | session | self-service / in-code check | yes |
| POST | `/auth/password/forgot` | public | — |  |
| POST | `/auth/password/reset` | public | — |  |
| POST | `/auth/recovery-codes/rotate` | session | self-service / in-code check | yes |
| GET | `/auth/recovery-codes/status` | session | self-service / in-code check |  |
| GET | `/auth/security/activity` | session | self-service / in-code check |  |
| GET | `/auth/sessions` | session | self-service / in-code check |  |
| DELETE | `/auth/sessions/:id` | session | self-service / in-code check |  |
| GET | `/auth/state` | public | — |  |
| GET | `/auth/step-up` | session | self-service / in-code check |  |
| POST | `/auth/step-up/passkey/options` | session | self-service / in-code check |  |
| POST | `/auth/step-up/passkey/verify` | session | self-service / in-code check |  |
| POST | `/auth/step-up/start` | session | self-service / in-code check |  |
| POST | `/auth/step-up/verify` | session | self-service / in-code check |  |
| GET | `/bi/reports` | session | bi.reports.read |  |
| GET | `/bi/reports/:code` | session | bi.reports.read |  |
| GET | `/business-calendar/capabilities` | session | calendar.items.read |  |
| GET | `/business-calendar/entities` | session | calendar.items.read |  |
| GET | `/business-calendar/horizon` | session | calendar.items.read |  |
| GET | `/business-calendar/items` | session | calendar.items.read |  |
| POST | `/business-calendar/items` | session | calendar.items.create |  |
| GET | `/business-calendar/items/:id` | session | calendar.items.read |  |
| PATCH | `/business-calendar/items/:id` | session | calendar.items.update |  |
| POST | `/business-calendar/items/:id/archive` | session | calendar.items.delete |  |
| POST | `/business-calendar/items/:id/complete` | session | calendar.items.update |  |
| POST | `/business-calendar/items/:id/evidence` | session | calendar.items.update |  |
| GET | `/business-calendar/items/:id/history` | session | calendar.items.read |  |
| POST | `/business-calendar/items/:id/reopen` | session | calendar.items.update |  |
| POST | `/business-calendar/items/:id/transition` | session | calendar.items.update |  |
| GET | `/business-calendar/members` | session | calendar.items.read |  |
| GET | `/communication/activity` | session | admin.audit.read |  |
| GET | `/communication/email-templates` | session | admin.settings.read |  |
| POST | `/communication/email-templates` | session | admin.settings.update |  |
| PATCH | `/communication/email-templates/:id` | session | admin.settings.update |  |
| POST | `/communication/email-templates/:id/send` | session | communication.mail.create |  |
| GET | `/communication/integrations` | session | admin.settings.read |  |
| POST | `/communication/integrations/test-mail` | session | admin.settings.update |  |
| POST | `/communication/integrations/test-teams` | session | admin.settings.update |  |
| GET | `/communication/meetings` | session | communication.meetings.read |  |
| POST | `/communication/meetings` | session | communication.meetings.create |  |
| GET | `/communication/meetings/:id` | session | communication.meetings.read |  |
| PATCH | `/communication/meetings/:id` | session | communication.meetings.update |  |
| POST | `/communication/meetings/:id/action-items` | session | communication.meetings.update |  |
| POST | `/communication/meetings/:id/finalize` | session | communication.meetings.update |  |
| PATCH | `/communication/meetings/action-items/:taskId/toggle` | session | communication.meetings.update |  |
| GET | `/communication/messages` | session | communication.messages.read |  |
| POST | `/communication/messages` | session | communication.messages.create |  |
| GET | `/communication/messages/:userId` | session | communication.messages.read |  |
| GET | `/contracts` | session | contracts.contracts.read |  |
| POST | `/contracts` | session | contracts.contracts.create |  |
| GET | `/contracts/:id` | session | contracts.contracts.read |  |
| PATCH | `/contracts/:id` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/claims` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/milestones` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/obligations` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/renew` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/transition` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/variation-orders` | session | contracts.contracts.update |  |
| POST | `/contracts/:id/versions` | session | contracts.contracts.update |  |
| PATCH | `/contracts/claims/:id/status` | session | contracts.contracts.update |  |
| GET | `/contracts/expiring` | session | contracts.contracts.read |  |
| GET | `/contracts/guarantees` | session | contracts.guarantees.read |  |
| POST | `/contracts/guarantees` | session | contracts.guarantees.create |  |
| PATCH | `/contracts/guarantees/:id/status` | session | contracts.guarantees.update |  |
| GET | `/contracts/insurance` | session | contracts.insurance.read |  |
| POST | `/contracts/insurance` | session | contracts.insurance.create |  |
| DELETE | `/contracts/milestones/:id` | session | contracts.contracts.update |  |
| POST | `/contracts/milestones/:id/invoice` | session | finance.invoices.create |  |
| PATCH | `/contracts/obligations/:id/fulfill` | session | contracts.contracts.update |  |
| PATCH | `/contracts/variation-orders/:id/status` | session | contracts.contracts.update |  |
| GET | `/corporate/announcements` | session | self-service / in-code check |  |
| POST | `/corporate/announcements` | session | corporate.announcements.create |  |
| DELETE | `/corporate/announcements/:id` | session | corporate.announcements.delete |  |
| GET | `/corporate/announcements/:id` | session | self-service / in-code check |  |
| PATCH | `/corporate/announcements/:id` | session | corporate.announcements.update |  |
| GET | `/corporate/goals` | session | corporate.goals.read |  |
| POST | `/corporate/goals` | session | corporate.goals.create |  |
| DELETE | `/corporate/goals/:id` | session | corporate.goals.delete |  |
| GET | `/corporate/goals/:id` | session | corporate.goals.read |  |
| PATCH | `/corporate/goals/:id` | session | corporate.goals.update |  |
| GET | `/corporate/kpis` | session | corporate.dashboard.read |  |
| DELETE | `/crm/contacts/:id` | session | crm.contacts.delete |  |
| PATCH | `/crm/contacts/:id` | session | crm.contacts.update |  |
| GET | `/crm/partners` | session | crm.partners.read |  |
| POST | `/crm/partners` | session | crm.partners.create |  |
| DELETE | `/crm/partners/:id` | session | crm.partners.delete |  |
| GET | `/crm/partners/:id` | session | crm.partners.read |  |
| PATCH | `/crm/partners/:id` | session | crm.partners.update |  |
| POST | `/crm/partners/:partnerId/activities` | session | crm.activities.create |  |
| POST | `/crm/partners/:partnerId/contacts` | session | crm.contacts.create |  |
| GET | `/documents` | session | documents.documents.read |  |
| GET | `/documents/:id/download` | session | documents.documents.read |  |
| GET | `/documents/:id/preview` | session | documents.documents.read |  |
| PATCH | `/documents/:id/title` | session | documents.documents.update |  |
| POST | `/documents/bulk-delete` | session | documents.documents.delete |  |
| POST | `/documents/bulk-move` | session | documents.documents.update |  |
| GET | `/documents/folders` | session | documents.folders.read |  |
| POST | `/documents/folders` | session | documents.folders.create |  |
| DELETE | `/documents/folders/:id` | session | documents.folders.delete |  |
| PATCH | `/documents/folders/:id` | session | documents.folders.update |  |
| POST | `/documents/upload` | session | documents.documents.create |  |
| GET | `/finance/bank-accounts` | session | finance.payments.read |  |
| POST | `/finance/bank-accounts` | session | finance.payments.create | yes |
| GET | `/finance/budgets/categories` | session | self-service / in-code check |  |
| POST | `/finance/budgets/copy` | session | finance.budgets.update |  |
| GET | `/finance/budgets/detail` | session | finance.budgets.read |  |
| GET | `/finance/budgets/overview` | session | finance.budgets.read |  |
| PUT | `/finance/budgets/plan` | session | finance.budgets.update |  |
| POST | `/finance/budgets/status` | session | finance.budgets.approve |  |
| GET | `/finance/budgets/structure` | session | finance.budgets.read |  |
| GET | `/finance/cashflow` | session | finance.invoices.read |  |
| GET | `/finance/datev/export` | session | finance.datev.export |  |
| GET | `/finance/datev/pending-count` | session | finance.datev.export |  |
| GET | `/finance/dunning` | session | finance.invoices.read |  |
| POST | `/finance/dunning/:id/dun` | session | finance.invoices.update |  |
| GET | `/finance/invoices` | session | finance.invoices.read |  |
| POST | `/finance/invoices` | session | finance.invoices.create |  |
| GET | `/finance/invoices/:id` | session | finance.invoices.read |  |
| POST | `/finance/invoices/:id/transition` | session | finance.invoices.update |  |
| GET | `/finance/open-items` | session | finance.invoices.read |  |
| GET | `/finance/payments` | session | finance.payments.read |  |
| POST | `/finance/payments` | session | finance.payments.create |  |
| GET | `/group/overview` | session | corporate.dashboard.read |  |
| GET | `/health` | public | — |  |
| POST | `/hr/applicants/:id/stage` | session | hr.recruitment.update |  |
| GET | `/hr/applicants/board` | session | hr.recruitment.read |  |
| GET | `/hr/employees` | session | hr.employees.read |  |
| POST | `/hr/employees` | session | hr.employees.create |  |
| GET | `/hr/employees/:id` | session | hr.employees.read |  |
| PATCH | `/hr/employees/:id` | session | hr.employees.update |  |
| GET | `/hr/employees/org-chart` | session | hr.employees.read |  |
| GET | `/hr/employees/org-chart/positions` | session | hr.employees.read |  |
| GET | `/hr/job-openings` | session | hr.recruitment.read |  |
| POST | `/hr/job-openings` | session | hr.recruitment.create |  |
| POST | `/hr/job-openings/:id/applicants` | session | hr.recruitment.create |  |
| PATCH | `/hr/job-openings/:id/status` | session | hr.recruitment.update |  |
| GET | `/hr/leave-requests` | session | hr.leave.read |  |
| POST | `/hr/leave-requests` | session | hr.leave.create |  |
| POST | `/hr/leave-requests/:id/decide` | session | hr.leave.approve |  |
| PATCH | `/hr/org-chart/positions/:id/status` | session | hr.employees.read, hr.employees.update |  |
| GET | `/hr/org-chart/versions` | session | hr.employees.read |  |
| POST | `/hr/org-chart/versions` | session | hr.employees.read, hr.employees.update |  |
| GET | `/hr/org-chart/versions/:id` | session | hr.employees.read |  |
| GET | `/hr/recruitment/open-positions` | session | hr.recruitment.read |  |
| GET | `/hr/staffing-budgets` | session | finance.budgets.read |  |
| POST | `/hr/staffing-budgets` | session | finance.budgets.read, finance.budgets.create |  |
| GET | `/hr/staffing-budgets/:id` | session | finance.budgets.read |  |
| PUT | `/hr/staffing-budgets/:id` | session | finance.budgets.read, finance.budgets.update |  |
| GET | `/hr/staffing-budgets/:id/revisions/:version` | session | finance.budgets.read |  |
| POST | `/hr/staffing-budgets/calculate` | session | finance.budgets.read |  |
| GET | `/hr/staffing-budgets/context` | session | finance.budgets.read |  |
| GET | `/identity/roles` | session | identity.roles.read |  |
| POST | `/identity/roles` | session | identity.roles.create | yes |
| POST | `/identity/roles/:id/revoke/:userRoleId` | session | identity.roles.update | yes |
| POST | `/identity/roles/assign` | session | identity.roles.update | yes |
| GET | `/identity/roles/permissions` | session | identity.roles.read |  |
| GET | `/identity/users` | session | identity.users.read |  |
| POST | `/identity/users` | session | identity.users.create | yes |
| GET | `/identity/users/:id` | session | identity.users.read |  |
| PATCH | `/identity/users/:id` | session | identity.users.update |  |
| GET | `/knowledge/articles` | session | knowledge.articles.read |  |
| POST | `/knowledge/articles` | session | knowledge.articles.create |  |
| GET | `/knowledge/articles/:id` | session | knowledge.articles.read |  |
| PATCH | `/knowledge/articles/:id` | session | knowledge.articles.update |  |
| POST | `/knowledge/articles/:id/publish` | session | knowledge.articles.approve |  |
| GET | `/legal/cases` | session | legal.cases.read |  |
| POST | `/legal/cases` | session | legal.cases.create |  |
| PATCH | `/legal/cases/:id` | session | legal.cases.update |  |
| GET | `/legal/compliance-items` | session | legal.compliance.read |  |
| POST | `/legal/compliance-items` | session | legal.compliance.create |  |
| PATCH | `/legal/compliance-items/:id` | session | legal.compliance.update |  |
| GET | `/master/asset-categories` | session | self-service / in-code check |  |
| GET | `/master/companies` | session | admin.masterdata.read |  |
| POST | `/master/companies` | session | admin.masterdata.create |  |
| POST | `/master/companies/:companyId/offices` | session | admin.masterdata.create |  |
| DELETE | `/master/companies/:companyId/offices/:id` | session | admin.masterdata.delete |  |
| GET | `/master/companies/:companyId/offices/:id` | session | admin.masterdata.read |  |
| PATCH | `/master/companies/:companyId/offices/:id` | session | admin.masterdata.update |  |
| DELETE | `/master/companies/:id` | session | admin.masterdata.delete |  |
| GET | `/master/companies/:id` | session | admin.masterdata.read |  |
| PATCH | `/master/companies/:id` | session | admin.masterdata.update |  |
| GET | `/master/company-profile` | session | self-service / in-code check |  |
| GET | `/master/contract-types` | session | self-service / in-code check |  |
| GET | `/master/cost-centers` | session | finance.budgets.read |  |
| POST | `/master/cost-centers` | session | finance.budgets.update |  |
| DELETE | `/master/cost-centers/:id` | session | finance.budgets.update |  |
| PATCH | `/master/cost-centers/:id` | session | finance.budgets.update |  |
| GET | `/master/countries` | session | self-service / in-code check |  |
| GET | `/master/currencies` | session | self-service / in-code check |  |
| GET | `/master/departments` | session | self-service / in-code check |  |
| GET | `/master/document-types` | session | self-service / in-code check |  |
| GET | `/master/offices` | session | self-service / in-code check |  |
| GET | `/master/positions` | session | self-service / in-code check |  |
| GET | `/master/tax-codes` | session | self-service / in-code check |  |
| GET | `/notifications` | session | self-service / in-code check |  |
| POST | `/notifications/:id/read` | session | self-service / in-code check |  |
| POST | `/notifications/read-all` | session | self-service / in-code check |  |
| GET | `/notifications/unread-count` | session | self-service / in-code check |  |
| GET | `/procurement/requests` | session | procurement.requests.read |  |
| POST | `/procurement/requests` | session | procurement.requests.create |  |
| GET | `/procurement/requests/:id` | session | procurement.requests.read |  |
| POST | `/procurement/requests/:id/decide` | session | procurement.requests.approve |  |
| POST | `/procurement/requests/:id/submit` | session | procurement.requests.update |  |
| GET | `/records/:resource` | session | self-service / in-code check |  |
| POST | `/records/:resource` | session | self-service / in-code check |  |
| DELETE | `/records/:resource/:id` | session | self-service / in-code check |  |
| GET | `/records/:resource/:id` | session | self-service / in-code check |  |
| PATCH | `/records/:resource/:id` | session | self-service / in-code check |  |
| POST | `/records/:resource/:id/restore` | session | self-service / in-code check |  |
| GET | `/records/:resource/archived/list` | session | self-service / in-code check |  |
| POST | `/records/:resource/bulk-delete` | session | self-service / in-code check |  |
| GET | `/records/:resource/lookup/:field` | session | self-service / in-code check |  |
| GET | `/records/catalog` | session | self-service / in-code check |  |
| GET | `/sales/opportunities` | session | sales.opportunities.read |  |
| POST | `/sales/opportunities` | session | sales.opportunities.create |  |
| GET | `/sales/opportunities/:id` | session | sales.opportunities.read |  |
| PATCH | `/sales/opportunities/:id` | session | sales.opportunities.update |  |
| POST | `/sales/opportunities/:id/go-no-go` | session | sales.gonogo.create |  |
| POST | `/sales/opportunities/:id/proposals` | session | sales.proposals.create |  |
| POST | `/sales/opportunities/:id/transition` | session | sales.opportunities.update |  |
| GET | `/sales/opportunities/pipeline` | session | sales.opportunities.read |  |
| GET | `/sales/proposals/:id` | session | sales.proposals.read |  |
| POST | `/sales/proposals/:id/lines` | session | sales.proposals.update |  |
| POST | `/sales/proposals/:id/transition` | session | sales.proposals.update |  |
| DELETE | `/sales/proposals/lines/:lineId` | session | sales.proposals.update |  |
| GET | `/sales/win-loss` | session | sales.opportunities.read |  |
| GET | `/search` | session | self-service / in-code check |  |
| POST | `/search/reindex` | session | admin.settings.update |  |
| GET | `/workflow/definitions` | session | workflow.definitions.read |  |
| POST | `/workflow/definitions` | session | workflow.definitions.create |  |
| PATCH | `/workflow/definitions/:id` | session | workflow.definitions.update |  |
| GET | `/workflow/tasks/my` | session | self-service / in-code check |  |
