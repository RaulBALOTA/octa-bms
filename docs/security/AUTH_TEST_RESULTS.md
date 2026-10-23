# Secure authentication — test results

Measured 2026-10-23 on Node 22.22, PostgreSQL 16 (local cluster), Chromium 141 (Playwright
1.64). Every number below comes from a run in this session. Nothing is reported as passing
that was not run.

## Commands and measured results

| Suite | Command | Result |
|---|---|---|
| Typecheck (api, web, shared) | `pnpm typecheck` | exit 0 |
| API unit (185 existing + 36 new) | `pnpm test` | **221 / 221** pass, 16 files |
| Web unit | `pnpm test` | **23 / 23** pass, 4 files |
| Auth integration vs PostgreSQL (incl. 15 passkey tests with a software FIDO2 authenticator) | `DATABASE_URL=… pnpm --filter @octa-bms/api test:auth` | **66 / 66** pass, 4 files |
| Playwright, mocked API (7 existing files + `auth.e2e.ts`, incl. MFA configuration page) | `pnpm --filter @octa-bms/web test:e2e` | **73 / 73** pass |
| Playwright, live API + DB (`auth-live.e2e.ts`, opt-in; incl. passkey via Chromium's CDP virtual authenticator) | `OCTA_LIVE_EMAIL=… OCTA_LIVE_PASSWORD=… … test:e2e` (API with `APP_PUBLIC_ORIGIN=http://localhost:5181`) | **5 / 5** pass |
| Production build | `pnpm build` | exit 0 |
| Migration rehearsal on a restored legacy dump | `add_secure_auth.sql` + `add_passkeys.sql`, each ×2, then `prisma migrate diff --from-url --exit-code` | **no schema drift** (exit 0), 7 legacy users unchanged |
| Dependency audit | `pnpm audit --prod` | 28 advisories (2 low, 16 moderate, 10 high), **all pre-existing**; the critical `proxy-addr` advisory was fixed with an in-range override to 2.0.8 |

Baseline before any change: typecheck clean, API 185/185, web 23/23.

The live browser test computes codes from the on-screen manual key with its own HOTP built
on `node:crypto`, independent of the server's `otpauth` library. That is what Microsoft
Authenticator does; a physical phone was **not** available in this environment.

## Defects found by the tests and fixed

| Found by | Defect | Fix |
|---|---|---|
| Live browser test | API responses were cacheable (ETag/304). After sign-in, a reload served the cached `ANONYMOUS` `/auth/state` and sent the user back to `/login`. | `Cache-Control: no-store` on every API response, plus a regression assertion |
| Live browser test | On a fresh database the super-admin has no company, and the layout hid every page except `/group` and `/admin`, which blocked MFA setup. | `/security` and `/admin/security` added to the allow-list |
| Log redaction unit test | Secret keys at the top level of explicit log calls (`password`, `code`) were not redacted. | Top-level and nested redaction paths |
| Passkey suite | Recovery-code rotation/status only recognised TOTP, so passkey-only admins got `MFA_NOT_ENROLLED`. | Factor checks count passkeys |
| Passkey suite | Deleting a passkey evaluated the actor's last-factor rule before ownership (409 instead of 403 for a foreign id). | Ownership checked first |
| Self-review | A hijacked session of a user without MFA could enroll the attacker's authenticator. | First enrollment from a session requires a password step-up within 10 min (regression test added) |
| Self-review | The invitation preview token sat in the URL query string and would reach access logs. | Changed to POST; request logs drop query strings |
| Pre-existing (F-03) | Anyone with `identity.roles.update` could grant themselves `SYSTEM_ADMIN`. | `AuthorizationService` grant rules + tests |

## Acceptance matrix (§13 of the brief)

| # | Case | Status | Evidence |
|---|---|---|---|
| 1 | Non-enumerating unknown/wrong/disabled | verified | `auth-flows` #1 |
| 2 | Password alone gives no session and no business API | verified | `auth-flows` #2; live test |
| 3 | QR unavailable before the password step and never resurfaces | verified | `auth-flows`; live test (secret gone after activation) |
| 4 | RFC 6238 vectors, Authenticator profile | verified (phone not tested) | unit: 6 RFC vectors, URI format; live independent HOTP |
| 5 | Wrong, expired, malformed, long and replayed OTP rejected; attempts capped | verified | `auth-flows` |
| 6 | Concurrent reuse of one code: only one succeeds | verified | 5 parallel requests → exactly 1 × 200 |
| 7 | Consumed or stale challenge unusable; challenge is not a session | verified | `auth-flows`; 270-route 401 sweep with a pre-auth cookie |
| 8 | Recovery codes shown once, hashed, single-use under concurrency | verified | `auth-flows` #8; live test |
| 9 | No unauthenticated generation or reading of codes | verified | `auth-flows` #9 |
| 10 | Reset token time-limited, single-use, revokes sessions | verified | `auth-flows` #10 |
| 11 | Step-up for MFA, password and admin grants | partial | password, roles, codes and enrollment verified; **no email-change feature exists** to protect |
| 12 | Cookie flags; no secrets in JSON, storage or logs | verified | `auth-flows` #12, live test, log-redaction test |
| 13 | CSRF, login CSRF and CORS abuse fail | verified | `auth-flows` #13 |
| 14 | Fixation, tampering, expiry, removed or disabled user rejected | verified | `auth-flows` #14 |
| 15 | User A cannot manage B's sessions | verified | `auth-flows` #15 |
| 16 | No cross-organization access | partial | partners, users, company header verified; **documents are not company-scoped (F-13)** |
| 17 | Staff cannot self-elevate or reach admin endpoints | verified | `authorization` #17 |
| 18 | Enforcement blocks unenrolled users safely | verified | `authorization` #18 |
| 19 | Revocation and role changes propagate across nodes | partial | sessions verified across 2 app instances; **RBAC cache lags up to 60 s and policy cache up to 15 s per instance** |
| 20 | Reset and invitation resist enumeration, replay, expiry and floods | verified | `auth-flows` #10, `platform` #20 |
| 21 | Integrations and jobs use scoped machine auth | not implemented | no machine-identity path exists (the `api_keys` table is unused); in-process cron jobs are unaffected |
| 22 | Non-destructive migration; legacy records consistent | verified | `platform` #22 + manual rehearsal |
| 23 | Keyboard and accessibility; de/en | partial | Playwright keyboard + German checks, labels and live regions; **no automated axe audit** |
| 24 | Sanitization of password, seed, OTP, QR, cookie and codes | verified | unit + `auth-flows` #24 |
| 25 | Atomic rate limiting on a shared store | verified | 60 hits across 2 connection pools → exactly 25 allowed |

## Passkeys and MFA configuration (added)

Verified by `test/auth/passkeys.int.spec.ts` (15) and the live browser test:
registration limited to administrators; first passkey issues recovery codes once; attestation
without user verification, foreign origin (`0cta-bms.example`) or foreign RP ID rejected;
replayed assertion rejected; another user's genuine passkey rejected; ceremonies impossible
without the password step; passkey step-up; "require passkeys for administrators" refused
until every admin (≥ 2) has one, then TOTP refused for admins at sign-in and step-up
(`PASSKEY_REQUIRED`) while recovery codes and staff TOTP keep working; last admin passkey not
removable; admin-assisted recovery revokes passkeys; config endpoint exposes no key material.
Live: Chromium virtual authenticator registers a passkey on `/security`, signs in with it,
and the configuration page shows the server's guard-rail rejection.
A physical security key / platform authenticator was **not** available here.

## Known gaps and follow-ups

* **Blocking before enforcement:** the rollout gates in the runbook §2 (two enrolled admins, recovery drill, pilot) and the deployment prerequisites (TLS + HSTS at the edge, NTP, a real `AUTH_ENCRYPTION_KEY` in a secret manager, SMTP) cannot be verified from this repository.
* F-13: documents need a `companyId` (data-model change, out of scope).
* RBAC permission cache (60 s per process): revoking a role can lag on other instances.
* CSP allows `'unsafe-inline'` for **styles only**, because the print templates and org chart inject `<style>`. Scripts stay strictly `'self'`.
* Login throttling checks the budget before counting the attempt, so a parallel burst can slightly exceed it (still bounded by the per-IP limit).
* Pre-existing dependency advisories (multer, lodash, js-yaml, react-router, qs, …) need framework upgrades.
* TOTP stays phishable for staff; administrators become phishing-resistant once "require passkeys" is on (recovery codes remain the phishable exception). Passkeys for all staff would be the next step.
* Changing the domain / RP ID invalidates every passkey (runbook §3a).
