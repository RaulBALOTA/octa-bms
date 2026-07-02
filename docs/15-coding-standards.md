# 15 — Coding Standards

## General
- TypeScript `strict: true` everywhere; no `any` (use `unknown` + narrowing); no non-null `!`
  except in tests.
- ESLint (typescript-eslint strict + import boundaries) + Prettier; enforced in CI and
  pre-commit (husky + lint-staged). Warnings are errors in CI.
- English for code, comments, commits. UI strings only in i18n resource files (de + en keys
  land in the same PR).
- Conventional Commits (`feat(crm): partner merge endpoint`); squash merge; branch names
  `feat/…`, `fix/…`, `chore/…`.
- PRs ≤ ~400 lines reviewed by one peer minimum; module owners for cross-module changes.

## Backend
- Layer imports flow inward only: presentation → application → domain; infrastructure
  implements application ports. ESLint `no-restricted-paths` enforces module boundaries.
- One command/query per file with its handler and spec:
  `approve-invoice.command.ts|handler.ts|handler.spec.ts`.
- Controllers: routing + DTO mapping + OpenAPI decorators only — zero business logic.
- All input through class-validator DTOs (`whitelist: true, forbidNonWhitelisted: true`).
- Repositories return domain entities, never Prisma types, outside infrastructure.
- Every status change is a transition command; never `update({ status })` directly.
- Money: `Decimal`/string end-to-end — floating point is banned for amounts.
- Errors: throw typed `DomainError(code)` → 422 mapping; never throw raw strings.
- Naming: files kebab-case; classes PascalCase; DB tables sn_case plural via `@@map`.
- No secrets, credentials or tenant data in logs; structured logging (pino) with request id.
- **Database safety: destructive migrations (column/table drops) require explicit review;
  `prisma db push --force-reset` is banned in every environment.**

## Frontend
- Function components + hooks only; no default exports (named exports aid refactors).
- Server state exclusively via TanStack Query hooks in `features/*/queries.ts` — no fetch in
  components; no server data in Zustand.
- Forms: RHF + zod resolver; schemas colocated and reused for optimistic updates.
- Accessibility: interactive elements are buttons/links (never clickable divs), labels on all
  inputs, focus visible, dialogs trap focus — axe checks in CI.
- Styling: Tailwind utilities + tokens; no inline hex colors; `cn()` helper for variants.
- i18n: `t('crm.partners.title')` — no literal UI strings; ICU for plurals/dates.
- Feature isolation: features import shared code only; cross-feature needs get promoted.

## Testing conventions
Unit specs colocated `*.spec.ts(x)`; integration under `test/`; naming
`describe(unit) → it('rejects transition from DRAFT to PAID')`. Coverage gates in doc 16.

## Documentation
Each module ships a `README.md` (purpose, aggregates, events in/out, endpoints). ADRs
(Architecture Decision Records) in `docs/adr/NNN-title.md` for irreversible choices.
