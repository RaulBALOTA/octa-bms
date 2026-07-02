# 03 — Database Schema

**Source of truth: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)** —
~100 tables, PostgreSQL 16 via Prisma. This document explains the design decisions.

## Table Groups

| Group | Tables |
|---|---|
| Identity | users, refresh_tokens, roles, permissions, role_permissions, user_roles, groups, user_groups, api_keys, company_memberships |
| Organization | companies, offices, departments, business_units, cost_centers, profit_centers |
| Reference data | countries, currencies, exchange_rates, languages, tax_codes, contract_types, document_types, asset_categories, vehicle_types, banks, bank_accounts, approval_groups, email_templates |
| CRM | business_partners, contacts, crm_activities |
| Sales | opportunities, go_no_go_evaluations, competitors, opportunity_competitors, proposals, proposal_versions, fee_calculation_lines, reference_projects, cv_profiles |
| Contracts | contracts, contract_versions, contract_obligations, payment_milestones, variation_orders, claims, bank_guarantees, insurance_policies |
| Finance | invoices, invoice_lines, payments, payment_allocations, budgets, budget_lines, number_sequences |
| HR | employees, positions, employment_contracts, skills, employee_skills, employee_certificates, trainings, training_participations, leave_requests, leave_balances, business_trips, performance_reviews, job_openings, applicants, interviews |
| Legal | legal_cases, compliance_items, data_processing_activities, whistleblower_reports, professional_licenses |
| Procurement | purchase_requests, purchase_request_items, purchase_orders, purchase_order_items, goods_receipts, supplier_evaluations |
| Assets | assets, asset_assignments, maintenance_records, software_licenses |
| Knowledge | knowledge_categories, knowledge_articles, article_versions |
| Documents | folders, documents, document_versions |
| Workflow | workflow_definitions, workflow_instances, approval_tasks, approval_actions |
| Corporate | company_goals, announcements, company_calendar_events |
| BI | dashboards, report_definitions, scheduled_reports |
| Cross-cutting | audit_logs, activity_logs, notifications, comments, attachments, tags, entity_tags, tasks, custom_field_definitions, custom_field_values, favorites, saved_views, outbox_events |

## Key Design Decisions

### 1. Unified Business Partner
Clients, suppliers, partners and authorities share one table (`business_partners`,
discriminated by `type`) because they share 90 % of attributes and CRM behavior
(contacts, activities, contracts, invoices attach uniformly). This matches SAP B1's
Business Partner concept and makes AI duplicate detection a single-table problem.

### 2. Soft delete everywhere
`deletedAt` timestamp; the Prisma client extension appends `deletedAt: null` to every query
and converts `delete` → `update`. Hard deletes exist only as scheduled GDPR jobs
(e.g. applicants 6 months post-rejection via `gdprDeleteBy`).

### 3. Audit & history
- `audit_logs` — machine-oriented field-level diff (`changes` JSONB: `{field: {old, new}}`),
  written by a global interceptor. Indexed by `(entityType, entityId)` and time.
- `activity_logs` — human-readable timeline for entity pages and the activity feed.
- Explicit version tables (`contract_versions`, `document_versions`, `proposal_versions`,
  `article_versions`) where legally meaningful snapshots are required.

### 4. Polymorphic cross-cutting features
`comments`, `attachments`, `entity_tags`, `tasks`, `custom_field_values`, `favorites`,
`notifications` reference `(entityType, entityId)`. Referential integrity for these is
enforced at the application layer (a `EntityRegistry` maps entityType → repository);
this trades FK guarantees for one implementation instead of 15 per feature — the standard
ERP compromise (Dynamics/Odoo do the same).

### 5. Numbering (German compliance)
`number_sequences` provides gap-free sequential document numbers per company/entity/year
(`R-2026-00042` invoices — §14 UStG requires unique sequential numbers). Allocation runs
`SELECT … FOR UPDATE` inside the creating transaction.

### 6. German finance specifics
- `invoices.serviceDate` (Leistungsdatum) — mandatory VAT invoice element.
- `tax_codes.datevCode` — DATEV BU-Schlüssel for export mapping.
- `invoices.xrechnungId` — Leitweg-ID for B2G e-invoicing (XRechnung).
- Retention: `document_types.retentionYears` (6/10 years per GoBD/AO §147).

### 7. Money & precision
All monetary values `Decimal(18,2)` (rates `Decimal(18,4/8)`). Currency stored per document;
`exchange_rates` keeps a dated EUR-base rate history so historical reports stay stable.

### 8. Transactional outbox
`outbox_events` guarantees at-least-once event delivery: domain write + event insert share
one transaction; a relay publishes and stamps `publishedAt`.

## Indexing Strategy

- Every FK column indexed (Prisma default for relations + explicit `@@index`).
- Hot query paths get composite indexes: `(companyId, status)` on partners/opportunities/
  contracts/invoices/assets; `(userId, isRead, createdAt)` on notifications;
  `(entityType, entityId)` on all polymorphic tables; date-based indexes on every
  expiry/due-date column feeding the notification scanners (`contracts.endDate`,
  `bank_guarantees.expiryDate`, `employee_certificates.expiryDate`, `assets.nextServiceDate`).
- Full-text: generated `tsvector` columns (migration SQL) on partners.name, contracts.title,
  documents.ocrText, knowledge_articles.content — used as fallback when Meilisearch is down.

## Migrations

`prisma migrate` with SQL review. Never `db push --force-reset`. Column drops require an
explicit two-step deploy (stop writes → migrate) and a data-loss review.
