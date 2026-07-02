# 12 — Development Roadmap

Team assumption: 4–6 developers (2 BE, 2 FE, 1 full-stack, 1 QA/DevOps part-time).
Phases ship usable increments; platform first, then revenue chain, then breadth.

## Phase 0 — Foundation (Weeks 1–4)
- Monorepo, CI/CD, Docker stack, environments (dev/stage/prod)
- Prisma schema + migrations + seed; PostgreSQL/Redis/MinIO/Meilisearch
- Auth (JWT + refresh), Entra SSO, MFA; RBAC engine + permission catalog
- App shell: sidebar/topbar/tabs/split view, dark mode, i18n de/en
- Platform services v1: audit interceptor, notification center (in-app), number sequences,
  saved views, tags/comments/attachments, generic EntityPage (list/filter/export)
- **Exit criteria**: log in via Entra, switch company, CRUD a reference entity with audit trail

## Phase 1 — Master Data + CRM (Weeks 5–10)
- Master data admin (companies→approval groups), import (CSV/XLSX)
- CRM: partners (all 4 types), contacts, activities, timeline, segmentation, map view
- Global search v1 (partners/contacts/employees), duplicate detection (AI)
- Org: departments, offices, org chart
- **Ship to pilot users** — CRM replaces spreadsheets

## Phase 2 — Sales + Contracts (Weeks 11–17)
- Pipeline kanban, opportunities, go/no-go scoring, win/loss
- Proposals: versions, fee calculation, submission calendar, reference projects, CV library
- Contracts: full lifecycle, obligations, milestones, VOs/claims, guarantees, insurance,
  expiry monitor + notification scanners
- Workflow engine v1 (approval steps, escalation) → contract approval
- **Ship** — sales & contract management live

## Phase 3 — Finance + HR core (Weeks 18–26)
- Invoices in/out, approval workflow with thresholds, payments, open items, cash flow
- DATEV export; XRechnung generation; budgets & cost center reporting
- HR: employees 360°, employment contracts, skills matrix, certificates, leave management
  (workflow), business trips, equipment link
- Executive dashboard v1 (revenue, EBIT proxy, backlog, pipeline, utilization from PMO API)
- **Ship** — the money and people core

## Phase 4 — Procurement, Assets, Legal (Weeks 27–33)
- Purchase request→order→receipt→invoice chain, supplier evaluation
- Assets: registry, QR labels, assignments, maintenance/TÜV/calibration scanners,
  software licenses
- Legal: compliance register, GDPR VVT, legal cases, licenses, whistleblower portal
- Recruitment (openings→applicants→interviews→offer) + GDPR auto-deletion

## Phase 5 — Knowledge, DMS, Communication (Weeks 34–40)
- DMS: folders/ACLs, check-in/out, versions, OCR, previews, retention
- Knowledge: wiki, standards, lessons learned, approvals
- Communication: Outlook/Teams via Graph (mail logging to CRM, calendar sync), meeting minutes
- Full-text search across documents; AI ask-knowledge (RAG)

## Phase 6 — BI + AI + Polish (Weeks 41–48)
- Dashboard designer (dockable widgets), report builder, scheduled reports, Power BI feed
- AI suite: proposal/contract drafting, invoice extraction, revenue prediction,
  NL search, management summaries, translation
- Visual workflow designer (drag & drop)
- Performance hardening, pen test, load test (500 users), accessibility audit
- **GA release 1.0**

## Continuous / post-1.0
Plugin SDK & marketplace · e-signature integration · Business Central/SAP live sync ·
mobile PWA polish · advanced forecasting · multi-entity consolidation reporting.

## Risks & Mitigations
| Risk | Mitigation |
|---|---|
| Scope breadth stalls delivery | strict phase gates; EntityPage/generator reuse keeps per-module cost ~2–3 weeks |
| DATEV/finance compliance errors | tax advisor review in Phase 3; golden-file export tests |
| Graph API consent/throttling | early tenant admin consent; delta queries + backoff |
| PMO integration drift | contract-first: shared OpenAPI + consumer-driven contract tests |
| Data migration from spreadsheets | import tooling ships with each module in its phase |
