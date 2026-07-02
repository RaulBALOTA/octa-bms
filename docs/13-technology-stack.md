# 13 — Recommended Technology Stack

## Decision Summary

| Layer | Choice | Why (vs. alternatives) |
|---|---|---|
| Backend | **NestJS 10 (Node 20, TS strict)** | first-class modular/DDD/CQRS structure, huge ecosystem, one language across stack. Alt .NET 8 is equally valid but splits the team across languages |
| ORM | **Prisma 5** | type-safe, migration workflow, client extensions for soft-delete/tenancy |
| Database | **PostgreSQL 16** | JSONB (workflow defs, custom fields), tsvector fallback search, pgvector for AI RAG, materialized views for KPIs, battle-tested |
| Cache/queue | **Redis 7 + BullMQ** | permission cache, outbox relay, scanners, jobs |
| Search | **Meilisearch** | Dynamics-grade instant search with typo tolerance, trivial ops footprint (vs. Elasticsearch's ops cost — overkill at this scale) |
| Files | **MinIO (S3 API)** | self-hostable in Germany (data residency), swap to Azure Blob/S3 later |
| Frontend | **React 18 + Vite** | ecosystem, hiring, component maturity |
| Routing/data | **React Router v6 + TanStack Query** (TanStack Router planned for typed routes) | URL-serialized filters, cache discipline |
| UI | **Tailwind + Radix (shadcn/ui pattern)** | owned design system, accessible primitives, dark mode for free |
| Forms | react-hook-form + zod | shared validation schemas |
| Charts | Recharts (+ visx for special) | dashboard needs |
| i18n | i18next + ICU | de/en, plurals, number/date formats |
| Auth | Passport JWT + **Azure Entra ID (OIDC)** | company runs M365; SSO/MFA/conditional access come from tenant |
| Integrations | Microsoft Graph SDK · DATEV EXTF export · XRechnung (UBL) | German market requirements |
| AI | **Claude API (claude-sonnet-5)** behind provider-agnostic gateway; pgvector embeddings | structured outputs for extraction; swap-friendly |
| OCR | Tesseract container (German trained data) | self-hosted, GDPR-safe |
| PDF | Playwright (HTML→PDF) for documents; pdf.js preview | template-driven proposals/invoices |
| Observability | pino → Loki · Prometheus + Grafana · Sentry | doc 17 |
| Testing | Vitest · Supertest · Playwright · Testcontainers | doc 16 |
| CI/CD | GitHub Actions → GHCR → Docker Compose/K8s | doc 19 |

## Version Policy
Node LTS only; renovate-bot weekly dependency PRs; Prisma/Nest majors upgraded in dedicated
hardening sprints; browser support: last 2 evergreen versions + Edge WebView.

## Build vs. Buy Notes
- **Workflow engine**: build (JSON-interpreted approvals cover the need; Camunda is overkill).
- **E-signature**: buy/integrate (DocuSign/Yousign adapter behind `SignaturePort` —
  qualified signatures are regulated).
- **Accounting**: integrate, never build — DATEV/BC/SAP remain the ledgers; BMS keeps the
  sub-ledgers (invoice register, open items).
- **BI**: build operational dashboards; delegate deep analytics to Power BI over a read schema.
