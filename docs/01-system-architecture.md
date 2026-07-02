# 01 — System Architecture

## Vision

OCTA BMS is the **company operating system** for a German engineering / EPCM consulting firm.
It manages the *business* (people, clients, contracts, money, assets, knowledge) and deliberately
does **not** manage projects — the existing PMO application owns that domain. The two systems
integrate over REST APIs and shared master data (clients, employees, cost centers).

Architectural reference points: Dynamics 365 Business Central (module + role model),
SAP Business One (document flow: request → order → receipt → invoice), Odoo (modular monolith,
pluggable apps), Monday/Linear (UX interaction model).

## Architecture Style: Modular Monolith → Extractable Services

A **modular monolith** with strict module boundaries, deployed as one API process, is the correct
starting point for ≤500 users. Every module is built so it *could* be extracted into a
microservice later (see doc 20), because:

- modules communicate only via **domain events** (in-process bus + transactional outbox) or
  explicit application-service interfaces — never by reaching into another module's tables
- each module owns its Prisma models and exposes its own REST resource group
- the workflow engine, notification center, search index and audit log are *platform services*
  consumed by all modules through ports (interfaces)

```
┌────────────────────────────────────────────────────────────────────────┐
│                            CLIENTS                                     │
│   React SPA (desktop/tablet/mobile) · PMO App · Power BI · DATEV      │
└──────────────┬─────────────────────┬───────────────────────────────────┘
               │ HTTPS/JSON          │ REST + webhooks
┌──────────────▼─────────────────────▼───────────────────────────────────┐
│                      API GATEWAY (NestJS)                              │
│  AuthN (JWT / Entra OIDC) · AuthZ (RBAC guard) · Rate limit · OpenAPI  │
├────────────────────────────────────────────────────────────────────────┤
│  APPLICATION LAYER (per module: controllers → CQRS handlers)           │
│  ┌─────────┬─────────┬────────┬──────────┬─────────┬────────┬───────┐  │
│  │Corporate│  CRM    │ Sales  │Contracts │ Finance │  HR    │ Legal │  │
│  ├─────────┼─────────┼────────┼──────────┼─────────┼────────┼───────┤  │
│  │Procure- │ Assets  │Know-   │Documents │Communi- │Workflow│  BI   │  │
│  │ment     │         │ledge   │          │cation   │Engine  │       │  │
│  └─────────┴─────────┴────────┴──────────┴─────────┴────────┴───────┘  │
├────────────────────────────────────────────────────────────────────────┤
│  PLATFORM SERVICES                                                     │
│  Identity/RBAC · Audit · Notifications · Global Search · Tags/Comments │
│  Custom Fields · Number Sequences · Event Bus (outbox) · AI Gateway    │
├────────────────────────────────────────────────────────────────────────┤
│  DOMAIN LAYER — entities, value objects, domain events, invariants     │
├────────────────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE — Prisma repositories · BullMQ jobs · MinIO storage    │
│  Meilisearch indexer · MS Graph client · SMTP · DATEV/BC/SAP adapters  │
└──────┬───────────┬───────────┬───────────┬───────────┬─────────────────┘
       │           │           │           │           │
  PostgreSQL     Redis     Meilisearch   MinIO     Azure Entra
  (system of   (cache,     (global      (files,    (SSO, MFA)
   record)      queues)     search)      S3 API)
```

## Layering (Clean Architecture per module)

| Layer | Contents | Depends on |
|---|---|---|
| **Domain** | Entities, value objects, domain events, business rules | nothing |
| **Application** | Command/query handlers (CQRS), ports, DTOs, validation | Domain |
| **Infrastructure** | Prisma repositories, external adapters (Graph, DATEV) | Application ports |
| **Presentation** | REST controllers, OpenAPI decorators, request mapping | Application |

Dependency rule enforced by ESLint `import/no-restricted-paths` per module.

## CQRS Policy

Full CQRS with separate read models only where it pays off:

- **Commands** everywhere: `ApproveInvoiceCommand`, `SubmitLeaveRequestCommand` — handlers
  enforce invariants, write via repositories, emit domain events.
- **Queries**: simple modules query Prisma directly through query handlers; **dashboards, KPIs
  and the executive cockpit** use dedicated read models (materialized views refreshed by events:
  `mv_revenue_monthly`, `mv_pipeline_by_stage`, `mv_utilization`).

## Event-Driven Backbone

1. Command handler writes aggregate **and** an `OutboxEvent` row in the same transaction.
2. Outbox relay (BullMQ repeatable job) publishes events to the internal bus / Redis streams.
3. Subscribers: notification center, search indexer, workflow engine triggers, audit
   enrichment, webhook dispatcher (PMO integration), read-model refreshers.

Event names: `<module>.<entity>.<pastTenseVerb>` — `contracts.contract.expiring`,
`finance.invoice.approved`, `hr.employee.hired`.

## Multi-Company / Multi-Office

- Single database, single schema. Every business row carries `companyId`.
- A `CompanyMembership` links users to companies; the active company travels in the JWT and a
  Prisma client extension injects `companyId` filters automatically (guard against cross-tenant reads).
- Roles can be scoped globally, per company, per office, or per department (`UserRole`).

## Integration Surface (API First)

| System | Direction | Mechanism |
|---|---|---|
| PMO application | bidirectional | REST v1 + webhooks; shared master data (clients, employees, cost centers) with BMS as system of record |
| DATEV | outbound | DATEV-format export (EXTF CSV) of invoice registers, monthly batch |
| Business Central / SAP | bidirectional | Adapter services behind `AccountingPort` (GL interface) |
| Microsoft Graph | bidirectional | Outlook mail/calendar sync, Teams messages, user provisioning from Entra |
| Power BI | outbound | Read-only reporting schema + OData feed |
| AI providers | outbound | `AiGatewayPort` — provider-agnostic (Claude API default) |

## AI-Ready Design

Central **AI Gateway** module: one port, per-feature prompts, full audit of AI calls, PII
redaction filter before external calls (GDPR). Features (summaries, drafting, extraction,
NL search) are thin consumers — swapping providers touches one adapter.

## Plugin Architecture

- Backend: NestJS dynamic modules discovered from `plugins/` manifest; plugins register
  routes, event subscribers, nav items, and permissions through a typed `PluginContract`.
- Frontend: module federation-ready lazy routes; nav tree is data-driven from the API.
- Custom fields + workflow definitions + email templates cover 80 % of customization
  without code.

## Non-Functional Targets

| Concern | Target |
|---|---|
| Users | 500+ concurrent-capable, ~50–100 typical concurrency |
| API latency | p95 < 300 ms for list/detail queries |
| Availability | 99.5 % (single region, HA optional per doc 17) |
| Audit | every write attributable (who/what/when/old→new), 10-year retention for financial records (GoBD) |
| GDPR | soft delete + hard-delete jobs (applicant data), Art. 30 register built in |
| i18n | de-DE default, en-US; all reference data bilingual |
