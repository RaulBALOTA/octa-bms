# OCTA BMS — Security operations runbook

Commands below were executed against local PostgreSQL 16 during implementation unless marked
*(not executable here)*.

## 1. Local development

```bash
docker compose up -d postgres redis mailpit          # Mailpit UI: http://localhost:8025
cp .env.example apps/api/.env                         # set BOOTSTRAP_ADMIN_EMAIL/PASSWORD
pnpm install && pnpm db:generate
pnpm db:push                                          # fresh DB (never --force-reset)
pnpm --filter @octa-bms/api auth:setup --apply        # existing DB instead: backup + additive SQL
pnpm db:seed                                          # permissions incl. identity.security.*
pnpm dev:api & pnpm dev:web                           # http://localhost:5180
```
Without `AUTH_ENCRYPTION_KEY` the API logs a warning and uses the development key — fine
locally, refused in production. Password-reset and invitation emails arrive in Mailpit.

Tests: `pnpm test` (unit, no DB) · `pnpm --filter @octa-bms/api test:auth` (PostgreSQL via
`DATABASE_URL`; each run creates and drops its own `auth_test_*` schema) ·
`pnpm --filter @octa-bms/web test:e2e` (mocked API) · live browser check:
`OCTA_LIVE_EMAIL=… OCTA_LIVE_PASSWORD=… pnpm --filter @octa-bms/web test:e2e auth-live`
against a running API on a disposable database.

## 2. Production rollout (gated)

| Step | Action | Gate before the next step |
|---|---|---|
| 0 | Deploy with `MFA_REQUIRED_MODE=optional`, secrets provisioned (MIGRATION_AND_ROLLBACK.md) | sign-in works; `/api/v1/auth/state` has `Cache-Control: no-store`; security emails arrive |
| 1 | **Every system administrator** enrolls (Security → Set up authenticator) and stores recovery codes separately (password manager *and* sealed envelope / safe) | `auth:admin list-admins` shows ≥ 2 admins with `mfa=true` and 10 codes |
| 2 | Recovery drill: admin A signs in with a recovery code; admin B runs an in-app recovery request for a test user, admin C approves, B completes; test user re-enrolls | all three paths succeeded; events visible in Security events |
| 3 | Pilot: Admin → Security → users → **Require MFA (pilot)** for 5–10 staff | ≥ 90 % pilot enrolled, helpdesk issues resolved |
| 4 | Mode **Enrollment required** with a deadline 2–4 weeks out; announce | enrollment rate on the dashboard; follow up with "not enrolled" users |
| 5 | Mode **Enforced** (UI refuses unless ≥ 2 admins have MFA) | unenrolled users can only reach the enrollment screen |

Rollback at any step: set mode back to `Optional` (takes effect ≤ 15 s per API instance).

## 3. Secrets

* **Encryption key:** 32 random bytes, base64. Generate with
  `pnpm --filter @octa-bms/api auth:admin generate-key`, store in the secret manager, inject
  as `AUTH_ENCRYPTION_KEY` + `AUTH_ENCRYPTION_KEY_ID`. Back it up separately from database
  backups (a DB backup + key together expose all seeds).
* **Rotation** (yearly or on suspicion): generate `key-v2`; deploy with
  `AUTH_ENCRYPTION_KEY=<v2> AUTH_ENCRYPTION_KEY_ID=key-v2
  AUTH_ENCRYPTION_PREVIOUS_KEYS=key-v1:<v1>`. Seeds re-encrypt to v2 on each user's next
  successful code. Recovery codes keep verifying via their stored `pepperKeyId`. After all
  active users have signed in (check
  `SELECT "seedKeyId", count(*) FROM mfa_authenticators WHERE status='ACTIVE' GROUP BY 1`),
  ask remaining users to rotate recovery codes, then remove v1. Removing a key with
  remaining seeds disables those users' authenticators (they need recovery).
* **Compromised key:** rotate immediately *and* treat all seeds as exposed: set policy to
  `Optional`, reset MFA for everyone (break-glass per user or SQL in a reviewed change),
  require re-enrollment.

## 4. Helpdesk: locked-out user

1. User tried a recovery code? (Code screen → "Use a recovery code instead".) Most cases end here.
2. Clock skew: ask the user to enable automatic time on the phone and use the newest code.
3. `TOO_MANY_ATTEMPTS`: throttles reset after at most 15 minutes (login) / 1 hour (reset
   emails). Do not clear counters manually unless an attack has been ruled out.
4. Lost phone **and** codes → identity verification out of band (video call with ID / HR
   record, manager confirmation). Never act on an email or a phone call alone.
   Admin → Security → user → **Request MFA reset** (record *how* identity was verified) →
   a second administrator approves → **Complete reset**. The user receives an email,
   all sessions end, and they must enroll at next sign-in.
5. Requests expire after 72 h. System-administrator targets require system-administrator
   requester and approver.

## 5. Break-glass (no second administrator available)

Only when every in-app path failed (e.g. the only other admin is unreachable).
On a host with database access, two people present if at all possible:

```bash
pnpm --filter @octa-bms/api auth:admin list-admins
AUTH_BREAK_GLASS_CONFIRM=jane.admin@company.example \
  pnpm --filter @octa-bms/api auth:admin break-glass-reset-mfa \
  --email jane.admin@company.example --reason "INC-1234: phone stolen, codes in stolen bag" --operator "J. Ops + K. CISO"
```
It revokes factors, codes, pending enrollments/challenges and sessions, forces enrollment
and writes a `breakglass.mfa_reset` security event (operator, reason, host, OS user).
Afterwards: notify the user out of band, review `security_events` for the account, file the
incident, and verify the account re-enrolled. There is no break-glass HTTP route and no
shared bypass account.

## 6. Monitoring and audit review

Weekly (admin.audit.read): Admin → Security → Security events, or SQL:

```sql
SELECT action, outcome, count(*) FROM security_events
WHERE "createdAt" > now() - interval '7 days' GROUP BY 1,2 ORDER BY 3 DESC;
```
Investigate: spikes of `auth.login/failure` (stuffing), `mfa.totp.verify/failure` for one
user (password known to an attacker → force password reset), any `breakglass.*`,
`mfa.recovery_request.*`, `policy.updated`, `role.granted`, `csrf.rejected` bursts,
`email.delivery/failure` (mail outage — resets and invitations not arriving).

Clock: API hosts must run NTP (chrony/systemd-timesyncd). Alert on drift > 5 s — beyond
±30 s codes start failing for everyone.

## 7. Retention (GDPR data minimization)

Hourly job (`SecurityMaintenanceService`): deletes expired rate-limit windows, challenges and
enrollments older than 1 day, sessions 30 days after absolute expiry, one-time tokens 7 days
after expiry, security events older than `SECURITY_EVENT_RETENTION_DAYS` (default 400), and
expires stale recovery requests. Stored network context is coarse (IPv4 /24, IPv6 /48);
no geolocation is collected. Access to events is limited to `admin.audit.read`, scoped to
the admin's company unless system administrator.

## 8. Incident response quick reference

| Situation | Action |
|---|---|
| Account takeover suspected | Admin → Security → **End sessions**; force password reset (forgot-password link to the verified address); if MFA may be compromised, recovery request → re-enroll; review events |
| Admin account compromised | Second admin: disable the account (`isActive=false` revokes sessions instantly), rotate encryption key if the admin had host access, review `role.granted`/`policy.updated` events |
| Mass credential stuffing | Check limiter effectiveness in events; consider `ENFORCED` for affected cohort; block at the edge (WAF) |
| DB backup leaked | Passwords are Argon2id; seeds/codes need the key — confirm the key was not in the same location; if it was, follow §3 "Compromised key" |

## 9. Restore drill (quarterly)

1. Restore the latest backup into a scratch database.
2. Start an API against it with the production key from the secret manager (isolated network).
3. Sign in as a test user with TOTP and with a recovery code.
4. Record the time to restore and any missing secret. A backup without the key restores
   accounts but not their authenticators.
