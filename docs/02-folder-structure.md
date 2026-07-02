# 02 — Folder Structure

pnpm monorepo. Backend modules mirror the 15 business modules plus platform services;
each backend module keeps the Clean Architecture layers internally.

```
octa-bms/
├── package.json                      # workspace root scripts
├── pnpm-workspace.yaml
├── docker-compose.yml                # full dev stack
├── .github/workflows/ci.yml
├── docs/                             # the 20 architecture deliverables
│
├── packages/
│   └── shared/                       # @octa-bms/shared — types shared API↔Web
│       └── src/
│           ├── enums.ts
│           ├── permissions.ts        # permission code catalog (single source)
│           └── api-types/            # DTO interfaces per module
│
├── apps/
│   ├── api/                          # @octa-bms/api — NestJS backend
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   └── seed.ts
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app.module.ts
│   │       ├── core/                 # framework plumbing (no business logic)
│   │       │   ├── config/
│   │       │   ├── prisma/           # PrismaService + companyId extension
│   │       │   ├── auth/             # JWT/Entra strategies, guards, decorators
│   │       │   ├── rbac/             # PermissionsGuard, @RequirePermission()
│   │       │   ├── audit/            # audit interceptor + service
│   │       │   ├── events/           # event bus + outbox relay
│   │       │   └── i18n/
│   │       ├── common/               # pagination, filters, base DTOs, utils
│   │       └── modules/
│   │           ├── identity/         # users, roles, groups, api-keys
│   │           ├── master-data/      # companies, offices, departments, refs
│   │           ├── corporate/        # goals, announcements, org chart, KPIs
│   │           ├── crm/              # partners, contacts, activities
│   │           ├── sales/            # opportunities, proposals, go/no-go
│   │           ├── contracts/
│   │           ├── finance/          # invoices, payments, budgets, DATEV
│   │           ├── hr/               # employees, leave, recruitment, skills
│   │           ├── legal/
│   │           ├── procurement/
│   │           ├── assets/
│   │           ├── knowledge/
│   │           ├── documents/        # DMS: folders, versions, check-in/out
│   │           ├── communication/    # graph sync, templates, announcements
│   │           ├── workflow/         # definitions, instances, approval inbox
│   │           ├── bi/               # dashboards, reports, exports
│   │           ├── search/           # global search API + indexer
│   │           ├── notifications/
│   │           └── ai/               # AI gateway + feature endpoints
│   │
│   │   # inside every business module:
│   │   #   <module>/
│   │   #   ├── <module>.module.ts
│   │   #   ├── presentation/         # *.controller.ts
│   │   #   ├── application/
│   │   #   │   ├── commands/         # <verb>-<entity>.command.ts + handler
│   │   #   │   ├── queries/
│   │   #   │   └── dto/
│   │   #   ├── domain/               # entities, events, rules
│   │   #   └── infrastructure/       # *.repository.ts, external adapters
│   │
│   └── web/                          # @octa-bms/web — React SPA
│       ├── index.html
│       ├── vite.config.ts
│       └── src/
│           ├── main.tsx
│           ├── app/                  # router, providers, layout shell
│           │   ├── layout/           # Sidebar, Topbar, CommandPalette
│           │   └── routes.tsx
│           ├── components/
│           │   ├── ui/               # design system primitives (Button, …)
│           │   └── data/             # DataTable, KanbanBoard, CalendarView,
│           │                         # TimelineView, MapView, FilterBar
│           ├── features/             # one folder per module, mirrors API
│           │   ├── dashboard/
│           │   ├── crm/
│           │   ├── sales/
│           │   ├── contracts/
│           │   ├── finance/
│           │   ├── hr/
│           │   └── ... (one per module)
│           ├── lib/                  # api client, auth, query hooks
│           ├── i18n/                 # de.json, en.json
│           └── stores/               # zustand: ui, auth, notifications
│
└── infra/
    ├── docker/                       # Dockerfiles
    └── k8s/                          # optional Kubernetes manifests (doc 17)
```

Rules:

- `apps/api/src/modules/*` may import from `core/`, `common/`, `@octa-bms/shared` — never
  from a sibling module's internals (only its exported application services or events).
- `apps/web/src/features/*` may import `components/`, `lib/`, `stores/` — never a sibling
  feature (shared UI gets promoted to `components/`).
- `packages/shared` holds only types/constants — no runtime dependencies.
