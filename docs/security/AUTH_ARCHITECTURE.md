# OCTA BMS — Authentication Architecture

Scope: how a person proves who they are, how the server keeps that proof, and how every
request is authorized. Code lives in `apps/api/src/core/security/*` (services, guards,
crypto) and `apps/api/src/core/auth/*` (controllers, decorators, company context).

## 1. Sign-in state machine

```
                    POST /auth/login (password)  or  Entra OIDC callback
                                   │
                      ┌────────────┴─────────────┐  invalid / unknown / disabled
                      │ verify (Argon2id, timing │──────────► 401 INVALID_CREDENTIALS
                      │ uniform, throttled)      │            (identical for all cases)
                      └────────────┬─────────────┘
          active TOTP factor?      │      policy requires MFA but none enrolled?
        ┌──────────────────────────┼───────────────────────────────┐
        ▼                          ▼ neither                        ▼
  MFA_PENDING               AUTHENTICATED                 MFA_ENROLLMENT_REQUIRED
  challenge cookie only     session cookie                challenge cookie only
  (bms_preauth, 5 min,      (bms_session)                 (15 min)
   5 attempts)                                            │
        │ POST /auth/mfa/verify (TOTP)                    │ POST /auth/mfa/enroll/start
        │ POST /auth/mfa/recovery (code)                  │ POST /auth/mfa/enroll/confirm
        ▼                                                 ▼
  AUTHENTICATED  ◄──────────────────────────────────────── AUTHENTICATED + recovery codes (once)
```

* A **challenge** (`mfa_challenges`) is a separate table and cookie. The guard only accepts
  it on four `@AllowPreAuth` routes; it never populates `req.user`, so company/permission
  guards and every business route return 401. Verified by a test that calls all ~270 routes.
* The **session cookie is set only after** the required second factor (or when no factor is
  required by policy). Each success issues a *new* session identifier (fixation defence);
  a pre-existing cookie in the browser is revoked, never promoted.
* `GET /auth/state` tells the SPA where it is (`ANONYMOUS | MFA_PENDING |
  MFA_ENROLLMENT_REQUIRED | AUTHENTICATED`) plus the CSRF token. It reveals nothing about
  an account before its password was verified.

## 2. Sessions

| Property | Implementation |
|---|---|
| Token | 32 random bytes (`crypto.randomBytes`), base64url, only in the cookie |
| Storage | `auth_sessions.tokenHash = SHA-256("octa-bms:session:v1:" + token)` |
| Cookie | `__Host-bms_session` on https (`bms_session` on http dev): `HttpOnly; Secure; SameSite=Strict; Path=/`, no `Domain`, `Expires` = absolute expiry |
| Lifetime | idle 60 min (sliding, written at most once per minute) and absolute 12 h, both enforced server-side; idle never extends past absolute; policy can override |
| Validation | every request reads the row (no cache) + live user status → revocation and disablement are effective immediately on every API instance |
| Rotation | login, MFA completion, enrollment, step-up (`rotate()` revokes the old row with reason `ROTATED`) |
| Revocation | logout, "sign out other sessions", user/admin revoke, password change (others) / reset (all), MFA reset, account disable, stricter policy (`SESSION_POLICY_REAUTH`) |
| Caching | every API response carries `Cache-Control: no-store` |

## 3. CSRF and CORS

`CsrfGuard` (global, after authentication) for `POST/PUT/PATCH/DELETE`:
1. `Origin` (or `Referer`) must be in the allow-list (`APP_PUBLIC_ORIGIN`,
   `CORS_ALLOWED_ORIGINS`; dev adds localhost ports). Missing → rejected.
2. Session or challenge requests must send `X-CSRF-Token` equal to the token stored on
   *that* row (synchronizer token, compared in constant time).
3. Anonymous requests must be `Content-Type: application/json` (forces a CORS preflight),
   which together with (1) blocks login CSRF.

CORS reflects only allow-listed origins (credentials enabled), never `*`. GET handlers do
not mutate state (logout is POST-only).

## 4. TOTP (Microsoft Authenticator)

* Profile: RFC 6238, HMAC-SHA1, 6 digits, 30 s, 160-bit secret from the OS CSPRNG
  (`otpauth` `Secret({ size: 20 })`). URI `otpauth://totp/OCTA%20BMS:<email>?secret=…&issuer=OCTA%20BMS&algorithm=SHA1&digits=6&period=30`.
  The period/digits are not configurable away from the Authenticator-compatible values.
* QR rendered **server-side as SVG** (`qrcode`) and returned only by `enroll/start`;
  the manual key is shown in the same response only. Neither is stored in plaintext or
  logged; neither can be fetched again.
* Enrollment row (`mfa_enrollments`) holds the sealed seed, 15-minute TTL, max 5 confirm
  attempts. Confirmation re-seals the seed for the new authenticator id, revokes any
  previous factor, and issues 10 recovery codes in one transaction.
* Verification: ±1 step window (`MFA_TOTP_WINDOW_STEPS`), and
  `UPDATE mfa_authenticators SET lastUsedStep = :step WHERE id = :id AND lastUsedStep < :step`
  inside the same transaction that consumes the challenge. A code (or an older code) is
  accepted at most once even under concurrency.
* Seeds are re-encrypted with the current key on the next successful verification after a
  key rotation.

## 4a. Passkeys (WebAuthn) for administrators

* Eligible: system administrators and holders of `identity.security.update`. Library:
  `@simplewebauthn/server` 14 / `@simplewebauthn/browser` 14.
* Registration (`/auth/passkeys/register/*`) requires a session with a recent verification
  (current factor, or password for a first factor); attestation `none`, resident key
  preferred, **user verification required**, ES256/RS256, at most 10 per user. A first factor
  also issues the recovery-code batch.
* Sign-in: after the password the MFA screen offers the passkey (`/auth/mfa/passkey/*`,
  `@AllowPreAuth`); step-up: `/auth/step-up/passkey/*`.
* Each ceremony has a single-use challenge in `webauthn_challenges`, bound to the session or
  pre-auth challenge that requested it (5 min), consumed atomically *before* verification.
  The server checks origin (allow-list filtered to the RP ID) and RP ID
  (`WEBAUTHN_RP_ID`, default = host of `APP_PUBLIC_ORIGIN`; IPs refused), user verification,
  and the signature counter. Only public keys are stored.
* Policy `requirePasskeyForAdmins`: a system administrator who has a passkey can no longer
  use TOTP (sign-in or step-up → `PASSKEY_REQUIRED`); recovery codes remain the lost-device
  path. It can only be switched on when every active system administrator (≥ 2) has a
  passkey; an admin's last passkey cannot be removed while it is on. MFA reset (admin
  recovery, break-glass) revokes passkeys as well.
* nginx sends `Permissions-Policy: publickey-credentials-create=(self), publickey-credentials-get=(self)`.

## 4b. MFA configuration page

`/admin/security/mfa` (read: `identity.security.read`; edit: system administrators, step-up
required): rollout readiness checklist (admins with a factor, admins with a passkey,
enrollment ratio, email delivery, production key), enforcement mode + deadline, methods
(TOTP profile read-only, passkeys on/off, require passkeys for administrators), session idle /
absolute lifetime and the step-up window (1–60 min), plus fixed server settings from
`GET /admin/security/config`. All guard rails are enforced by the API, not the page.

## 5. Key management and hashing

| Secret | Storage |
|---|---|
| TOTP seed | AES-256-GCM, 96-bit random nonce, AAD `mfa-totp:<userId>:<authenticatorId>`; envelope `v1.<keyId>.<iv>.<ct+tag>`; key from `AUTH_ENCRYPTION_KEY` (32 bytes) outside the DB, old keys in `AUTH_ENCRYPTION_PREVIOUS_KEYS` |
| Recovery code | HMAC-SHA256 with a pepper = HKDF-SHA256(encryption key, "recovery-code-pepper:v1"), bound to the user id; `pepperKeyId` stored per row |
| Session / challenge / reset / invite tokens | SHA-256 with per-purpose domain prefix (inputs are 256-bit random) |
| Password | Argon2id (default m=64 MiB, t=3, p=4; measured 125 ms on the test host), rehash on login when parameters change |

Development without `AUTH_ENCRYPTION_KEY` uses a fixed, clearly named key
(`dev-insecure`); production refuses to start without a real key and refuses to decrypt or
derive with the development key.

## 6. Recovery

* 10 codes, `XXXXX-XXXXX` from a 32-symbol alphabet (50 bits each), shown once with
  copy/download and an acknowledgement. Redemption: conditional update
  `WHERE usedAt IS NULL AND revokedAt IS NULL` — exactly one concurrent caller wins.
  Rotation requires step-up and revokes all unused codes.
* Lost device *and* codes: `mfa_recovery_requests` (request with reason + out-of-band
  identity verification note → approval by a different administrator; system-admin targets
  need system-admin requester and approver → completion removes all factors, codes and
  sessions and sets `mfaRequired`, forcing enrollment at next sign-in; user notified).
* Last resort: `pnpm --filter @octa-bms/api auth:admin break-glass-reset-mfa` on a host with
  database access (double confirmation, audited). See the runbook.

## 7. Authorization

Global guard order: `ThrottlerGuard` → `SessionAuthGuard` → `CsrfGuard` →
`CompanyContextGuard` (company only from a validated membership) → `PermissionsGuard`
(`@RequirePermission`, deny if missing) → `RecentAuthGuard` (`@RequireRecentAuth`).

* `users.isSystemAdmin` is the global super-admin; company roles are `user_roles` scoped by
  `companyId`. `AuthorizationService` blocks: granting roles with permissions the actor
  lacks, global roles, `SYSTEM_ADMIN`, roles in another company, self-grants, and acting on
  super-admins unless the actor is one.
* Step-up (recent factor — passkey or TOTP — or password if no factor; window from policy, default 10 min) on: password change, MFA
  disable/replace, first enrollment from a session, recovery-code rotation, role
  create/assign/revoke, user creation, invitations, pilot flag, session revocation by admin,
  recovery requests, policy changes, bank-account creation. Full list:
  `ROUTE_PERMISSION_MAP.md`.

## 8. Policy and rollout

`security_policies` (single row; `MFA_REQUIRED_MODE` is the default until saved):

| Mode | Users without a factor | Users with a factor |
|---|---|---|
| `DISABLED` | password only; enrollment UI off | still challenged (a factor is never silently ignored) |
| `OPTIONAL` | password only; may enroll | challenged |
| `ENROLLMENT_REQUIRED` | full access until `enrollmentDeadline`, then enrollment-only | challenged |
| `ENFORCED` | enrollment-only | challenged |

A "factor" is an active TOTP authenticator **or** passkey.

`users.mfaRequired` puts individual users (pilot cohort, recovered accounts) into
enforced behaviour regardless of mode. Switching to `ENFORCED` is refused unless the acting
admin and at least one other system admin have an active factor. Sessions created without
MFA are revoked on their next request once the user's requirement changes.

## 9. Abuse limits (shared, Postgres `auth_rate_limits`)

| Bucket | Limit |
|---|---|
| login per IP (IPv6 bucketed by /64) | 30 / 5 min |
| login failures per submitted email (hash) | 10 / 15 min |
| login failures per (IP, email) | 5 / 5 min |
| TOTP failures per user | 10 / 15 min; 5 attempts per challenge |
| recovery-code failures per user | 5 / 15 min |
| enrollment starts+failures per user | 10 / 15 min |
| step-up failures per user | 5 / 15 min |
| forgot-password per IP / per email | 10 / h, 3 / h (silently not sent beyond) |
| token pages (reset, invite) per IP | 20 / h |

Limits are time-bounded throttles, not permanent locks; unknown emails are throttled
identically. Counters are a single atomic `INSERT … ON CONFLICT … RETURNING`.

## 10. Audit

`security_events` (append-only from the application; retention purge only):
action, outcome, actor, target, company, correlation id (pino request id), IP prefix
(/24 or /48), user-agent summary, sanitized context (any key resembling a secret is dropped).
Request logs redact cookies, CSRF headers, `Set-Cookie`, secret-named fields and strip
query strings.

## 11. Phishing resistance

**TOTP is not phishing-resistant** — a real-time relay can capture a code. Passkeys are bound
to the RP ID and verified origin, so a look-alike domain cannot obtain a usable assertion.
With `requirePasskeyForAdmins` on, administrator accounts no longer accept TOTP. Recovery
codes remain phishable and are the documented exception (single use, notification on use).
Entra OIDC is a primary factor that feeds the same MFA decision.
