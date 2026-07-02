# 05 — Domain Model (DDD)

## Bounded Contexts & Aggregates

Each module is a bounded context. Aggregates (consistency boundaries) with their roots:

| Context | Aggregate Root | Members inside boundary | Key invariants |
|---|---|---|---|
| Identity | User | roles, memberships, api keys | unique email; role scope must reference a company the user is member of |
| Organization | Company | offices, departments, cost/profit centers | department tree acyclic; cost center codes unique per company |
| CRM | BusinessPartner | contacts, crm activities | exactly one primary contact; partnerNumber immutable after creation |
| Sales | Opportunity | go/no-go, competitor links | stage transitions follow the funnel; WON requires a contract or explicit override; probability auto-set per stage |
| Sales | Proposal | versions, fee lines | totalFee = Σ(hours × rate); submit requires APPROVED status |
| Contracts | Contract | versions, obligations, milestones, VOs, claims | status machine (DRAFT→…→ACTIVE→EXPIRED/TERMINATED); active contract requires signed date; Σ milestones ≤ value |
| Finance | Invoice | lines, allocations | gross = net + tax; numbers gap-free sequential; posted (SENT+) invoices immutable — corrections via cancellation invoice (Storno) |
| Finance | Payment | allocations | Σ allocations ≤ payment amount |
| HR | Employee | contracts, skills, certificates, balances | one active employment contract at a time; leave taken ≤ entitlement + carryover |
| HR | LeaveRequest | — | no overlapping approved leave; days computed from working calendar |
| Procurement | PurchaseRequest / PurchaseOrder | items, receipts | received qty ≤ ordered qty; approval required above threshold |
| Assets | Asset | assignments, maintenance | one open assignment at a time; ASSIGNED status ⇔ open assignment exists |
| Documents | Document | versions | check-in only by check-out holder; version numbers monotonic |
| Workflow | WorkflowInstance | approval tasks, actions | one RUNNING instance per (definition, entity); step transitions per definition |
| Knowledge | KnowledgeArticle | versions | publish requires reviewer ≠ author |

## Value Objects

`Money {amount, currency}` · `DateRange {start, end}` (validated start ≤ end) ·
`Address {street, postalCode, city, country}` · `IBAN` (checksum-validated) ·
`VatId` (format per country) · `Percentage` · `EmailAddress` · `NumberedIdentifier`
(prefix-year-sequence). Implemented as immutable TS classes in `domain/value-objects`.

## Domain Events (catalog excerpt)

| Event | Emitted when | Consumed by |
|---|---|---|
| `crm.partner.created` | partner registered | search indexer, AI dedup check, PMO webhook |
| `sales.opportunity.stageChanged` | funnel move | pipeline read model, notifications (owner, management) |
| `sales.opportunity.won` | stage → WON | corporate KPIs, contract draft suggestion |
| `contracts.contract.activated` | status → ACTIVE | obligation scheduler, milestone → invoice suggestions |
| `contracts.contract.expiring` | daily scan, endDate − noticePeriod ≤ 90d | notification center, renewals dashboard |
| `finance.invoice.approved` | approval workflow completes | posting, DATEV export queue |
| `finance.invoice.overdue` | daily scan past dueDate | dunning notifications, AR dashboard |
| `hr.employee.hired` | employee activated | onboarding workflow, user provisioning, asset checklist, birthday feed |
| `hr.leave.requested` | leave submitted | approval workflow (manager) |
| `hr.certificate.expiring` | daily scan ≤ 60d | notifications (employee + HR) |
| `procurement.request.submitted` | PR submitted | approval workflow (threshold rules) |
| `assets.asset.serviceDue` | daily scan | notifications, maintenance kanban |
| `documents.document.checkedIn` | new version | OCR job, search indexer |
| `workflow.task.escalated` | dueAt passed | escalation assignee notification |

Events are immutable records `{id, type, occurredAt, actorId, payload}` persisted via the
outbox (doc 01). Handlers are idempotent (event id dedup).

## Status Machines (canonical)

```
Opportunity: LEAD → QUALIFIED → GO_NO_GO → PROPOSAL → NEGOTIATION → WON | LOST | CANCELLED
Contract:    DRAFT → IN_REVIEW → IN_APPROVAL → ACTIVE → { RENEWED | EXPIRED | TERMINATED }
Invoice:     DRAFT → IN_APPROVAL → APPROVED → SENT → { PARTIALLY_PAID → PAID | OVERDUE | DISPUTED } | CANCELLED
Leave:       REQUESTED → { APPROVED | REJECTED } → CANCELLED (before start)
Purchase:    DRAFT → SUBMITTED → IN_APPROVAL → APPROVED → ORDERED → PARTIALLY_RECEIVED → RECEIVED → INVOICED → CLOSED
Asset:       IN_STOCK ↔ ASSIGNED → IN_REPAIR → { IN_STOCK | RETIRED | SOLD | LOST }
```

Transitions are the *only* way status changes (no direct field writes); each transition is a
command with guard conditions and emits an event.

## Ubiquitous Language (DE/EN glossary excerpt)

| EN | DE | Meaning |
|---|---|---|
| Business Partner | Geschäftspartner | any external org: client/supplier/partner/authority |
| Opportunity | Verkaufschance | qualified pursuit before proposal |
| Proposal | Angebot | priced offer document |
| Framework Agreement | Rahmenvertrag | parent contract with call-offs |
| Variation Order | Nachtrag | contract amendment |
| Outgoing/Incoming Invoice | Ausgangs-/Eingangsrechnung | AR/AP document |
| Service Date | Leistungsdatum | VAT-relevant performance date |
| Cost Center | Kostenstelle | internal cost allocation unit |
| Leave Request | Urlaubsantrag | absence request |
| Power of Attorney / Signatory rule | Prokura / Unterschriftenregelung | approval thresholds |
