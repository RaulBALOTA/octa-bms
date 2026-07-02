# OCTA BMS — Business Management System

Enterprise business management platform for a German engineering / EPCM consulting company.
Manages the **company itself** — CRM, sales, contracts, finance, HR, legal, procurement,
assets, knowledge, documents, workflows, BI — and integrates with the separate PMO
application via REST. It is explicitly **not** a project management system.

Architecture reference points: Dynamics 365 Business Central · SAP Business One ·
Odoo Enterprise · Linear/Notion-grade UX.

## Documentation (the 20 deliverables)

| # | Document | # | Document |
|---|---|---|---|
| 01 | [System architecture](docs/01-system-architecture.md) | 11 | [API specification](docs/11-api-specification.md) |
| 02 | [Folder structure](docs/02-folder-structure.md) | 12 | [Development roadmap](docs/12-development-roadmap.md) |
| 03 | [Database schema](docs/03-database-schema.md) | 13 | [Technology stack](docs/13-technology-stack.md) |
| 04 | [ER diagram](docs/04-entity-relationship-diagram.md) | 14 | [Component library](docs/14-component-library.md) |
| 05 | [Domain model](docs/05-domain-model.md) | 15 | [Coding standards](docs/15-coding-standards.md) |
| 06 | [Backend architecture](docs/06-backend-architecture.md) | 16 | [Testing strategy](docs/16-testing-strategy.md) |
| 07 | [Frontend architecture](docs/07-frontend-architecture.md) | 17 | [Deployment architecture](docs/17-deployment-architecture.md) |
| 08 | [UI wireframes](docs/08-ui-wireframes.md) | 18 | [Docker environment](docs/18-docker-environment.md) |
| 09 | [Navigation tree](docs/09-navigation-tree.md) | 19 | [CI/CD pipeline](docs/19-cicd-pipeline.md) |
| 10 | [Permission matrix](docs/10-permission-matrix.md) | 20 | [Scalability plan](docs/20-scalability-plan.md) |

## Stack

**API** NestJS 10 · Prisma 5 · PostgreSQL 16 · Redis/BullMQ · Meilisearch · MinIO —
modular monolith, Clean Architecture/DDD, CQRS-ready, OpenAPI at `/api/docs`.
**Web** React 18 · Vite · Tailwind · TanStack Query · Zustand · i18next (de/en) —
dark mode, global search (Ctrl+K), notification center, multi-company switcher.

## Quick start

Prerequisites: Node 20+, pnpm 9+, Docker Desktop.

```bash
# 1. Infrastructure (Postgres, Redis, Meilisearch, MinIO, Mailpit)
docker compose up -d postgres redis meilisearch minio mailpit

# 2. Environment
cp .env.example apps/api/.env

# 3. Install, create schema, seed demo data
pnpm install
pnpm db:generate
pnpm db:push          # creates tables (never use --force-reset)
pnpm db:seed          # permissions, roles, demo company + users

# 4. Run (two terminals or `pnpm dev`)
pnpm dev:api          # http://localhost:3000  ·  Swagger: /api/docs
pnpm dev:web          # http://localhost:5180
```

Demo logins (password `ChangeMe!2026`): `admin@octa.example` (system admin),
`md@octa.example`, `sales@octa.example`, `finance@octa.example`, `hr@octa.example`,
`employee@octa.example` — each seeded with the matching role to try the RBAC matrix.

Full containerized stack: `docker compose --profile full up -d --build` → web at
`http://localhost:8080`.

## What is implemented vs. designed

**Working now (Phase 0 scaffold):** monorepo + CI, full Prisma schema (~100 tables,
all 15 modules + master data), JWT auth with refresh rotation + lockout, RBAC
(permission catalog, scoped roles, guard), multi-company context, soft delete,
audit logging, gap-free number sequences (§14 UStG), CRM partners, HR employees +
leave workflow with balance checks, contracts with status machine + expiry monitor,
invoices with server-side VAT totals, notification center + daily expiry/birthday
scanners, global search, and the web shell (login, dashboard, CRM/HR/contracts/
finance lists, dark mode, DE/EN).

**Designed, scheduled by roadmap (docs/12):** sales pipeline & proposals, workflow
designer, DMS with OCR, knowledge base, Graph/Teams integration, DATEV export,
BI dashboards, AI suite, Entra SSO. Nav items for these show a roadmap placeholder.

## House rules

- **Never** run destructive database commands (`prisma db push --force-reset`,
  unscoped `DELETE`/`TRUNCATE`). Schema changes follow docs/15 §Database safety.
- All UI strings via i18n (de + en in the same PR).
- Status changes only through transition endpoints — never direct field updates.
