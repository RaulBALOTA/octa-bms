# 06 — Backend Architecture

NestJS 10 · TypeScript strict · Prisma · PostgreSQL · Redis/BullMQ · CQRS via `@nestjs/cqrs`.

## Request Pipeline

```
HTTP → Helmet/CORS → RateLimit → JwtAuthGuard → CompanyContextGuard
     → PermissionsGuard (@RequirePermission)
     → ValidationPipe (class-validator, whitelist+transform)
     → Controller → CommandBus/QueryBus → Handler
     → AuditInterceptor (diff capture on mutations)
     → ResponseEnvelope + problem+json errors
```

## Module Anatomy (example: contracts)

```
modules/contracts/
├── contracts.module.ts
├── presentation/
│   └── contracts.controller.ts        # REST + OpenAPI decorators only
├── application/
│   ├── commands/
│   │   ├── create-contract/           # command + handler + tests
│   │   ├── activate-contract/
│   │   └── add-variation-order/
│   ├── queries/
│   │   ├── list-contracts/            # filtering, paging, saved-view configs
│   │   └── get-contract-detail/
│   ├── dto/                           # request/response DTOs
│   └── ports/                         # e.g. SignaturePort (e-sign provider)
├── domain/
│   ├── contract.entity.ts             # rich model: transitions, invariants
│   └── events/
└── infrastructure/
    ├── contract.repository.ts         # Prisma, returns domain entities
    └── adapters/                      # DocuSign adapter etc.
```

## Cross-Cutting Implementations

**Auth** — Passport strategies: `jwt` (access 15 min / refresh 7 d rotation, hashed in DB)
and `oidc` (Azure Entra; auto-provision users by `entraObjectId`, group→role mapping).
MFA: TOTP enrollment when `mfaEnabled`. Password policy + lockout counters on `User`.

**RBAC** — permission codes `module.resource.action` (catalog generated from
`packages/shared/permissions.ts`). `PermissionsGuard` resolves the user's effective
permission set (roles scoped by company/office/department, cached in Redis 60 s,
invalidated on role change). Row-level: repository layer applies scope filters
(e.g. HR "own department" scope) declared per query handler.

**Multi-company** — `CompanyContextGuard` reads `X-Company-Id` header, verifies membership,
stores in `AsyncLocalStorage`; the Prisma extension injects `companyId` into every query on
company-scoped models. Switching company in the UI just changes the header.

**Audit** — `AuditInterceptor` wraps mutations: reloads pre-image, computes JSON diff,
writes `audit_logs` in the same transaction; also emits `activity_logs` summaries via
per-entity humanizers.

**Events** — handlers write `outbox_events` transactionally; the relay (BullMQ) publishes to
Redis streams; subscribers register with `@OnDomainEvent('finance.invoice.approved')`.

**Jobs (BullMQ queues)** — `scanners` (daily expiry scans: contracts, guarantees,
certificates, licenses, service dates, birthdays, GDPR deletion), `search-index`,
`ocr`, `mail`, `datev-export`, `report-schedule`, `graph-sync`, `webhooks`.

**Search** — Meilisearch indexes per searchable entity (partners, contacts, employees,
contracts, invoices, assets, documents, articles, opportunities). Indexer subscribes to all
`*.created/updated/deleted` events. `GET /search?q=` fans out, merges, filters hits by the
caller's permissions before returning.

**Notifications** — service with channel strategy: in-app (DB + SSE push
`GET /notifications/stream`), email (templated, user preference), Teams (Graph). Scanner
jobs and workflow engine are the main producers.

**Workflow engine** — interprets `WorkflowDefinition.definition` JSON:
`{steps: [{code, type: approval|condition|notify|timer|signature, assigneeRule, onApprove,
onReject, escalation: {afterHours, to}}]}`. Assignee rules: user, role, manager-of-initiator,
approval group, amount-threshold table. Exposes the "My Approvals" inbox
(`GET /workflow/tasks/my`).

**AI gateway** — `AiGatewayPort` (default adapter: Claude API, model `claude-sonnet-5`).
Endpoints under `/ai/*`: summarize, draft, extract-invoice (structured output), translate,
nl-search (NL → filter JSON), ask-knowledge (RAG over pgvector-embedded articles/documents).
Every call PII-scrubbed + logged to `audit_logs` (action `AI_CALL`).

**File storage** — MinIO/S3 via `StoragePort`; uploads through pre-signed URLs; OCR job
(Tesseract container) populates `documents.ocrText`.

**OpenAPI** — `@nestjs/swagger` at `/api/docs`, spec exported to
`packages/shared/openapi.json` in CI; typed frontend client generated from it.

## Error Handling

RFC 7807 `application/problem+json`. Domain rule violations → 422 with `code`
(e.g. `CONTRACT_INVALID_TRANSITION`) translated in the frontend; infra errors → 500 with
correlation id (pino logger, `X-Request-Id` propagated).

## Configuration

`@nestjs/config` + zod-validated env schema. Secrets via env only (K8s secrets / Key Vault
in production). Feature flags table for gradual rollout of modules.
