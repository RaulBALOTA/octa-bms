# OCTA BMS — Authentication & Access Audit (Phase 0)

Audit date: 2026-10-23 · Branch audited: `claude/modest-gauss-0wgd4b` @ `4a9257c`
Scope: identity, authentication, sessions, authorization, and the code paths that
consume them. This document records what the repository **actually** contained before
the secure-auth work, the risks found, and the plan that was executed. It is not a
statement that the system is secure.

## 1. Repository structure and versions

| Part | Path | Stack (from lockfile) |
|---|---|---|
| Monorepo | `/` | pnpm 9.15 workspaces (`apps/*`, `packages/*`), Node ≥ 20 (tested on 22.22) |
| API | `apps/api` | **NestJS 10.4** on Express 4, Prisma 5.22, PostgreSQL 16, `argon2` 0.41.1, `helmet` 7, `@nestjs/throttler` 6, `nestjs-pino` 4, `@nestjs/jwt` + `passport-jwt`, `jose` 6 (Entra OIDC) |
| Web | `apps/web` | React 18.3, Vite 5.4, react-router 6.26, TanStack Query 5, Zustand 4.5 (`persist`), i18next (de + en), Tailwind 3, Playwright 1.64 |
| Shared | `packages/shared` | TS enums + permission catalogue |
| Infra | `infra/docker`, `docker-compose.yml` | nginx SPA + `/api` reverse proxy (1 hop), Postgres, Redis (unused by code), Mailpit, MinIO, Meilisearch |
| CI | `.github/workflows/ci.yml` | install → prisma validate/generate → typecheck → unit tests → `db push` → seed → build → non-blocking `pnpm audit` |

The brief assumed "Express"; the backend is **NestJS on Express**. All controls were
implemented as Nest guards/middleware/services following the existing module layout
(`src/core/*`, `src/modules/*`).

**Schema management:** there is no `prisma/migrations` directory. The project uses
`prisma db push` for fresh databases and hand-written, idempotent, additive SQL files in
`apps/api/prisma/sql/` for existing databases (pattern: `add_org_chart_versioning.sql` +
`setup-org-chart.ts` which takes a `pg_dump` before applying). The auth work follows that
same pattern (`add_secure_auth.sql`, `setup-secure-auth.ts`).

Baseline before changes (measured): `pnpm typecheck` clean; API 14 files / 185 tests pass;
web 4 files / 23 tests pass.

## 2. Identity and authentication as found

### Tables
- `users` — `id` cuid, `email @unique` (lower-cased in app code, **no DB-level
  case-insensitive guarantee**), `passwordHash` (Argon2id, node-argon2 defaults
  m=64 MiB, t=3, p=4 — verified on seeded rows), `entraObjectId`, `isActive`,
  `isSystemAdmin` (global super-admin flag), **unused** `mfaEnabled` / `mfaSecret`
  (plaintext column, never written), `failedLoginCount`, `lockedUntil`,
  `passwordChangedAt`, `deletedAt`.
- `refresh_tokens` — SHA-256 of the refresh JWT, expiry, revocation.
- `roles`, `permissions`, `role_permissions`, `user_roles` (scoped to company/office/
  department or global when `companyId IS NULL`), `groups`, `user_groups`,
  `company_memberships` (`userId+companyId` unique), `api_keys` (hash + scopes —
  **no code path authenticates with them**).
- `audit_logs` — generic CRUD audit written by `AuditInterceptor`; `/api/v1/auth/*` is
  skipped entirely, so **no login/logout/failure events were recorded**.

### Endpoints (`src/core/auth`)
| Route | Behaviour found |
|---|---|
| `POST /api/v1/auth/login` | Argon2 verify, returns `{accessToken, refreshToken}` JWTs in JSON. Unknown user returns immediately (timing oracle). Locks account for 15 min after 5 failures (**victim lockout DoS**), and returns a distinct "Account temporarily locked" message (**enumeration**). |
| `POST /auth/refresh` | Rotates refresh JWT (DB-hashed). Non-atomic revoke → two parallel refreshes can both succeed. |
| `POST /auth/logout` | Revokes the presented refresh token only; access JWT remains valid ≤ 15 min. |
| `GET /auth/me` | Profile, memberships, effective permissions. |
| `GET /auth/oidc/{status,login,callback}` | Entra OIDC code flow; state kept in a per-process `Map` (breaks multi-instance); **tokens handed to SPA in URL fragment**; auto-provisions unknown Entra users into the *first* company with `EMPLOYEE`. |

### Middleware / guards (global `APP_GUARD` order)
`ThrottlerGuard` (300 req/min/IP, in-memory) → `JwtAuthGuard` (passport-jwt, Bearer
header, `JWT_SECRET` **defaults to `'dev-only-secret'`** when unset, including in the API
docker-compose profile) → `CompanyContextGuard` (`X-Company-Id` header validated
against `company_memberships`; super-admins may use any company) →
`PermissionsGuard` (`@RequirePermission` codes, deny if missing; RBAC cache is
in-memory 60 s per process).

### Frontend
`stores/auth.ts` keeps **access and refresh tokens in `localStorage`** (zustand
`persist`, key `octa-bms-auth`) — any XSS yields long-lived account takeover.
`RequireAuth` only checks that a token string exists. No CSRF concerns existed because
auth was header-based, but the move to cookies requires CSRF protection.

### Bootstrap / onboarding
`prisma/seed.ts` creates the first super-admin from `BOOTSTRAP_ADMIN_EMAIL/PASSWORD`
only when no active admin exists (good: no public bootstrap route, no default password
outside `--demo`). `POST /identity/users` lets an admin set a user's password directly.
No invitation, password-reset, or email-verification flow exists. `--demo` seeds known
password `ChangeMe!2026` for six accounts.

## 3. Protected surface inventory

234 HTTP routes across 52 controllers (scanned with the script in
`apps/api/test/route-inventory.ts`; the automated coverage test re-derives this list
from Nest metadata on every run, see `AUTH_TEST_RESULTS.md`).

- **Public** before: `auth/login|refresh|logout`, `auth/oidc/*`, `health`.
- **Authenticated without `@RequirePermission` (35 routes):** reviewed one by one:
  - `auth/me`, `notifications/*` (per-user, filtered by `user.id`), `workflow/tasks/my`
    (per-user) — acceptable.
  - `master/*` reference lists (countries, currencies, tax codes, offices, departments,
    positions, company-profile) — company-scoped reference data; acceptable for any
    member.
  - `records/*` — every service method calls `admin(user)` → super-admin only. OK.
  - `search`, `ai/*` — filter results by the caller's module read permissions in code. OK.
  - `finance/budgets/categories` — static category list. OK.
  - `corporate/announcements` (read) — company news, intended for all staff. OK.
  - **`group/overview` — returns revenue, open items, backlog and pipeline for every
    company the caller belongs to with no permission check.** The documented matrix
    (`docs/10`) restricts `corporate.dashboard` to SYS/MD/DEPT_HEAD/FIN. **Finding F-12.**
- **File downloads:** `documents/:id/download|preview`, `finance/datev/*` use `@Res()`
  but still pass through the global guards. `documents` has **no `companyId` column**,
  so any holder of `documents.documents.read` in any company can fetch any document by
  id. **Finding F-13 (pre-existing data-model issue).**
- **WebSockets / SSE:** none (`@WebSocketGateway`, `@Sse` not used).
- **Background jobs:** `@nestjs/schedule` crons (`expiry-scanner.service.ts`) run
  in-process with Prisma, not over HTTP; unaffected by auth changes.
- **Machine identities:** `api_keys` table exists and Swagger advertises `X-Api-Key`,
  but no guard accepts it. There is therefore no working machine/integration
  authentication today (the PMO integration in docs/01 is design-only).

## 4. Findings (pre-change)

| ID | Severity | Finding |
|---|---|---|
| F-01 | High | Bearer access + 7-day refresh tokens stored in `localStorage` (XSS → persistent takeover). |
| F-02 | High | `JWT_SECRET` falls back to `'dev-only-secret'`; docker-compose `full` profile ships `JWT_SECRET: dev-only-secret` with `NODE_ENV=production`. Anyone can mint tokens for any user id. |
| F-03 | High | **Privilege escalation:** `POST /identity/roles/assign` accepts any `roleId` and `companyId: null` (global). A user holding only `identity.roles.update` can assign themselves `SYSTEM_ADMIN` (all permissions, all companies). `POST /identity/roles` likewise lets a role creator bundle permissions they do not hold. No step-up. |
| F-04 | High | No MFA (the `mfaSecret` column is plaintext if ever used). |
| F-05 | Medium | Account lockout after 5 failures for 15 min → trivial victim-lockout DoS; distinct "locked" message enumerates accounts; unknown-user path skips Argon2 (timing oracle). |
| F-06 | Medium | `identity/users` list/get returns **all users of all companies** to any company-level holder of `identity.users.read` (cross-organization leakage); `PATCH identity/users/:id` lets company admins edit/disable super-admins and does not revoke sessions on disable. |
| F-07 | Medium | Refresh rotation not atomic (parallel replay). Logout leaves access JWT valid. No server-side session list / revoke. |
| F-08 | Medium | CORS: `origin: APP_URL?.split(',') ?? true` → reflects **any** origin with credentials when `APP_URL` unset. |
| F-09 | Medium | No security event audit (auth routes excluded from audit interceptor). |
| F-10 | Medium | OIDC: tokens in URL fragment; in-memory state store (multi-instance failure); unknown Entra users auto-provisioned into the first company. |
| F-11 | Low | Rate limit in-memory per process (not shared across instances); one global budget. |
| F-12 | Medium | `group/overview` exposes group financial KPIs without permission (see §3). |
| F-13 | Medium (pre-existing, out of auth scope) | Documents are not company-scoped; cross-company read by id. |
| F-14 | Low | No `trust proxy` configuration: behind nginx `req.ip` is the proxy address → per-IP limits collapse to one bucket. |
| F-15 | Low | nginx serves the SPA with no CSP/HSTS/frame/referrer headers. |
| F-16 | Info | Demo seed uses a fixed known password — must never run against production (already gated behind `--demo`). |

## 5. Plan executed (file-by-file) — zero destructive changes

Database (additive only; `prisma/sql/add_secure_auth.sql`, idempotent, `IF NOT EXISTS`):
- `users`: add `status`, `emailNormalized` (+ unique index, backfilled from
  `lower(trim(email))`), `emailVerifiedAt`, `credentialUpdatedAt`, `mfaRequired`
  (cohort flag), `mfaEnrolledAt`. Existing `mfaEnabled`/`mfaSecret`/`lockedUntil`
  columns are **kept** (not dropped); `mfaSecret` is never read or written.
- New tables: `auth_sessions`, `mfa_authenticators`, `mfa_enrollments`,
  `mfa_challenges`, `recovery_codes`, `mfa_recovery_requests`, `one_time_tokens`,
  `invitations`, `security_events`, `security_policies`, `auth_rate_limits`.
- Existing `refresh_tokens` rows are marked revoked (data kept) — legacy JWTs stop
  working; users simply sign in again. No user, role, membership or business row is
  modified except the additive backfill above.

API (`apps/api/src/core/security/*` new module, replacing `core/auth/*` JWT pieces):
- `crypto.ts` (CSPRNG tokens, domain-separated hashes, AES-256-GCM seed envelope with
  AAD, HKDF-derived recovery pepper, key ring with rotation), `auth-config.ts`
  (validated configuration, production refusal rules).
- `password.service.ts`, `totp.service.ts`, `session.service.ts`,
  `mfa-challenge.service.ts`, `recovery.service.ts`, `security-audit.service.ts`,
  `security-policy.service.ts`, `rate-limit.service.ts` (Postgres-backed, atomic),
  `email-notification.service.ts`, `invitation.service.ts`, `password-reset.service.ts`.
- `session-auth.guard.ts` (replaces `JwtAuthGuard` + `JwtStrategy`), `csrf.guard.ts`
  (Origin + synchronizer token), `step-up.guard.ts` (`@RequireRecentMfa`).
- Controllers: `auth.controller.ts` (login, MFA, logout, sessions, step-up, password),
  `mfa.controller.ts`, `admin-security.controller.ts`; OIDC callback re-routed through
  the same MFA decision and cookie session.
- `main.ts`: cookie parsing, explicit CORS allowlist, `trust proxy`, Helmet with HSTS,
  production config validation.
- Identity hardening: `roles.controller.ts`, `users.controller.ts` (F-03, F-06),
  `group.controller.ts` (F-12).

Web: `lib/api.ts` (cookies + CSRF header, no tokens), `stores/auth.ts` (in-memory
state from `/auth/state`, `BroadcastChannel` multi-tab logout), new pages under
`pages/auth/*`, `SecurityPage`, `AdminSecurityPage`; de/en strings.

Infra: nginx security headers + CSP; compose `full` profile no longer ships a usable
JWT secret.

## 6. Libraries selected

| Library | Version | Purpose | Rationale / maintenance (checked 2026-10-23) |
|---|---|---|---|
| `argon2` (node-argon2) | 0.41.1 (existing) | Argon2id | Already in lockfile; reference C impl; maintained. |
| `otpauth` | 9.5.2 | RFC 4226/6238 TOTP + `otpauth://` URI | Zero runtime deps, actively released (9.5.2 2026-09-03), returns matched window delta (needed for per-counter replay protection). |
| `qrcode` | 1.5.4 | Server-side SVG rendering of the provisioning URI | Most used QR lib; last release 2024-08 (stable, no open advisories at audit time). Seed never leaves our server; no third-party QR API. |
| `cookie-parser` | 1.4.7 | Parse `Cookie` header | expressjs org. |
| `nodemailer` | 10.0.16 | SMTP delivery (Mailpit in dev, provider in prod) | Version chosen ≥ 2 weeks old (newer 10.1/10.2 releases were days old). Graph mail (existing `OutboundService`) is used when configured. |
| `unplugin-swc` + `@swc/core` | 1.6.0 / 1.16.13 (dev) | Vitest transform with decorator metadata so HTTP-level Nest integration tests run | Dev-only. |

Removed from runtime use: `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`.
Node `crypto` is used for AES-256-GCM, HKDF, SHA-256, HMAC and `randomBytes` — no
hand-rolled primitives.

## 7. Configuration prerequisites (operator-provisioned)

See `.env.example` (names only) and `SECURITY_OPERATIONS_RUNBOOK.md`. Production
refuses to start unless: `APP_PUBLIC_ORIGIN` is `https://…`; `AUTH_ENCRYPTION_KEY`
is a 32-byte base64 key with `AUTH_ENCRYPTION_KEY_ID`; session cookie uses the
`__Host-` prefix; session/MFA numeric settings are within bounds; `TRUST_PROXY` is set
explicitly. External prerequisites that **cannot be verified from the repository**:
TLS termination and HSTS at the edge, NTP on API hosts, SMTP/Graph mail credentials,
a secret manager to inject keys, Postgres backups.

## 8. Threat model

Summarised in `THREAT_MODEL.md` (credential stuffing, enumeration, MFA bypass, OTP
replay/races, stolen session, CSRF, XSS, leaked DB, cross-organization abuse, admin
takeover, recovery compromise, expired invites, secret leakage, multi-instance races).

## 9. Rollback and backup

`MIGRATION_AND_ROLLBACK.md`. The setup script takes a `pg_dump` before applying SQL to
a local database; production requires an operator-taken backup first. Rehearsed against
a copy of a database created from the **pre-change** schema with legacy users
(see `AUTH_TEST_RESULTS.md`).
