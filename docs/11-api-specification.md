# 11 — API Specification

Live OpenAPI 3.1 at `GET /api/docs` (Swagger UI) and `/api/docs-json`; this document defines
the conventions and the resource map.

## Conventions

- Base URL: `https://<host>/api/v1` — URI-versioned; breaking changes → `/v2`.
- Auth: `Authorization: Bearer <JWT>` (or `X-Api-Key` for integrations).
  Active company: `X-Company-Id` header (must match a membership).
- JSON only; dates ISO 8601 UTC; money `{ "amount": "1234.56", "currency": "EUR" }` (strings — no float loss).
- Errors: RFC 7807 `application/problem+json` with stable `code` for client translation.
- Idempotency: mutating endpoints accept `Idempotency-Key` header.
- Correlation: `X-Request-Id` in/out.

### List endpoints (uniform contract)

```
GET /crm/partners?type=CLIENT&status=ACTIVE&segment=A
    &q=bayer                      # quick search
    &filter[city][eq]=München     # typed filters: eq,ne,gt,gte,lt,lte,in,contains,null
    &sort=-createdAt,name
    &page=1&pageSize=50           # max 200
    &include=accountManager       # allowed expansions per resource
    &fields=id,name,city          # sparse fieldsets
→ 200 { "data": [...], "meta": { "page":1, "pageSize":50, "total":412, "totalPages":9 } }
```

Common sub-resources on every major entity:
`GET|POST /{entity}/{id}/comments · /attachments · /tags · /tasks · /activity · /audit`
plus `GET /{entity}/export?format=csv|xlsx` and `POST /{entity}/import`.

## Resource Map (v1)

```
AUTH        POST /auth/login · /auth/refresh · /auth/logout · /auth/mfa/verify
            GET  /auth/me · GET /auth/oidc/login (Entra redirect) · /auth/oidc/callback
IDENTITY    /identity/users · /identity/roles · /identity/permissions · /identity/groups
            /identity/api-keys
MASTER DATA /master/companies · /master/offices · /master/departments
            /master/business-units · /master/cost-centers · /master/profit-centers
            /master/countries · /master/currencies · /master/tax-codes
            /master/contract-types · /master/document-types · /master/asset-categories
            /master/banks · /master/bank-accounts · /master/approval-groups
            /master/email-templates · /master/number-sequences
CORPORATE   /corporate/kpis · /corporate/goals · /corporate/announcements
            /corporate/calendar · /corporate/org-chart
CRM         /crm/partners · /crm/contacts · /crm/activities
            POST /crm/partners/{id}/merge (duplicate resolution)
SALES       /sales/opportunities · /sales/opportunities/{id}/go-no-go
            POST /sales/opportunities/{id}/transition { "stage": "PROPOSAL" }
            /sales/proposals · /sales/proposals/{id}/versions · /sales/fee-lines
            /sales/reference-projects · /sales/cv-profiles · /sales/competitors
            GET /sales/pipeline (aggregated funnel) · GET /sales/win-loss
CONTRACTS   /contracts · /contracts/{id}/versions · /obligations · /milestones
            /contracts/{id}/variation-orders · /claims
            /contracts/guarantees · /contracts/insurance
            POST /contracts/{id}/transition · GET /contracts/expiring?withinDays=90
FINANCE     /finance/invoices?direction=OUTGOING · /finance/invoices/{id}/lines
            POST /finance/invoices/{id}/transition · POST /finance/invoices/{id}/cancel
            /finance/payments · POST /finance/payments/{id}/allocate
            /finance/budgets · /finance/cashflow?horizonDays=90
            GET /finance/receivables · /finance/payables (open items)
            POST /finance/datev/export { from, to } → file
HR          /hr/employees · /hr/employees/{id}/skills|certificates|equipment
            /hr/positions · /hr/employment-contracts
            /hr/leave-requests · POST /hr/leave-requests/{id}/decide
            /hr/leave-balances · /hr/business-trips
            /hr/trainings · /hr/job-openings · /hr/applicants · /hr/interviews
            /hr/performance-reviews · GET /hr/competence-matrix
LEGAL       /legal/cases · /legal/compliance-items · /legal/gdpr/processing-activities
            /legal/licenses · POST /legal/whistleblower (unauthenticated, anonymous)
PROCUREMENT /procurement/requests · POST /procurement/requests/{id}/submit
            /procurement/orders · /procurement/orders/{id}/receipts
            /procurement/supplier-evaluations · /procurement/software-licenses
ASSETS      /assets · POST /assets/{id}/assign · POST /assets/{id}/return
            /assets/{id}/maintenance · GET /assets/{id}/qr (PNG label)
KNOWLEDGE   /knowledge/categories · /knowledge/articles · /articles/{id}/versions
            POST /knowledge/articles/{id}/publish
DOCUMENTS   /documents/folders · /documents
            POST /documents/{id}/checkout · /checkin (multipart or pre-signed)
            GET /documents/{id}/versions/{v}/download · GET /documents/{id}/preview
WORKFLOW    /workflow/definitions · /workflow/instances
            GET /workflow/tasks/my · POST /workflow/tasks/{id}/approve|reject|delegate
NOTIFY      GET /notifications?unread=true · POST /notifications/read-all
            GET /notifications/stream (SSE)
SEARCH      GET /search?q=&types=partners,contracts&limit=5   (global, permission-filtered)
BI          /bi/dashboards · /bi/reports · POST /bi/reports/{id}/run?format=pdf|xlsx
            /bi/scheduled-reports · GET /bi/kpi/{code}?period=2026
AI          POST /ai/summarize { entityType, entityId | text }
            POST /ai/draft { kind: proposal|contract|email|report, context }
            POST /ai/extract-invoice (multipart PDF → structured InvoiceDraft)
            POST /ai/translate { text|documentId, target: de|en }
            POST /ai/nl-search { question } → { filters, results }
            POST /ai/ask-knowledge { question } → { answer, sources[] }
COMMON      /views (saved views) · /favorites · /custom-fields · /tags
            /comments · /attachments (pre-signed upload) · /tasks
ADMIN       /admin/audit-logs · /admin/health · /admin/feature-flags · /admin/plugins
WEBHOOKS    /webhooks/subscriptions (PMO subscribes: partner.*, employee.*, costcenter.*)
```

## Example: create outgoing invoice

```http
POST /api/v1/finance/invoices
X-Company-Id: cmp_octa_de   Idempotency-Key: 7f3a…

{ "direction": "OUTGOING", "partnerId": "bp_01…", "invoiceDate": "2026-07-02",
  "serviceDate": "2026-06-30", "dueDate": "2026-08-01", "contractId": "ct_01…",
  "lines": [ { "description": "Engineering services June 2026 — TGA",
               "quantity": "168", "unit": "h", "unitPrice": "115.00",
               "taxCodeId": "tax_de19", "costCenterId": "cc_100" } ] }

→ 201 { "data": { "id": "inv_01…", "invoiceNumber": "R-2026-00107",
        "status": "DRAFT", "netAmount": "19320.00", "taxAmount": "3670.80",
        "grossAmount": "22990.80", … } }
```

Status codes: 200/201/204 success · 400 validation · 401/403 auth · 404 · 409 conflict
(optimistic concurrency via `updatedAt` precondition) · 422 domain rule · 429 rate limit.
