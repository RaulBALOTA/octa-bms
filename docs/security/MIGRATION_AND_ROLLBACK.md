# Secure authentication — migration and rollback

The change is **additive**: `apps/api/prisma/sql/add_secure_auth.sql` creates 8 enum types,
11 tables, 6 nullable/defaulted columns on `users`, indexes and foreign keys. It drops,
renames or retypes nothing. It runs in one transaction and is idempotent.

Data changes it makes (all on new columns, plus one flag):
* `users.emailNormalized = lower(trim(email))`, `users.status = 'DISABLED'` where
  `isActive = false`, `users.credentialUpdatedAt = coalesce(passwordChangedAt, updatedAt)`;
* `refresh_tokens.revokedAt = now()` for live legacy refresh tokens (rows kept).

It aborts without changes if two `users.email` values differ only by case.

`apps/api/prisma/sql/add_passkeys.sql` (passkeys + MFA configuration) is a second additive,
idempotent script applied **after** the first: 1 enum type, 2 tables
(`webauthn_credentials`, `webauthn_challenges`) and 3 defaulted columns on
`security_policies` (`passkeysEnabled`, `requirePasskeyForAdmins`, `stepUpMaxAgeMinutes`).
`auth:setup --apply` runs both in order.

## Rehearsed (evidence in AUTH_TEST_RESULTS.md)

* Restored a `pg_dump` of a database created from the **pre-change** schema with 7 legacy
  users (bootstrap admin + demo seed) → applied both scripts twice → `prisma migrate diff
  --from-url … --to-schema-datamodel prisma/schema.prisma` reports **no difference**; user
  rows byte-identical in all legacy columns (md5 fingerprint).
* Automated in `test/auth/platform.int.spec.ts` (#22): legacy schema reconstructed from the
  current Prisma schema, legacy users with node-argon2 default hashes, migration ×2, drift
  check, then the legacy admin signs in on the upgraded database and a disabled legacy user
  is refused.

## Production procedure

1. **Freeze & back up.** `pg_dump --format=custom --file before-secure-auth-<date>.dump`
   (or a provider snapshot). Verify the dump restores to a scratch database.
2. **Provision secrets** (secret manager → runtime env, never git): `AUTH_ENCRYPTION_KEY`
   (`pnpm --filter @octa-bms/api auth:admin generate-key`), `AUTH_ENCRYPTION_KEY_ID=key-v1`,
   `APP_PUBLIC_ORIGIN=https://…`, `TRUST_PROXY` (e.g. `1` behind one nginx),
   SMTP settings. Keep `MFA_REQUIRED_MODE=optional`.
3. **Apply schema:** `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f apps/api/prisma/sql/add_secure_auth.sql -f apps/api/prisma/sql/add_passkeys.sql`
   (on a local DB: `pnpm --filter @octa-bms/api auth:setup --apply` takes the dump for you).
4. **Seed permissions:** `pnpm db:seed` (idempotent; adds `identity.security.*`, preserves
   admins and data).
5. **Deploy API + web together.** Old SPA builds cannot talk to the new API (bearer tokens
   are no longer accepted) — users simply sign in again; their accounts, roles and data are
   unchanged.
6. **Verify:** `curl -sI https://…/api/v1/auth/state` shows `Cache-Control: no-store`; sign
   in; `pnpm --filter @octa-bms/api auth:admin list-admins`.
7. Continue with the rollout in `SECURITY_OPERATIONS_RUNBOOK.md` §2.

## Rollback

* **Application rollback (preferred, no data loss):** redeploy the previous API + web images.
  The new tables/columns are ignored by the old code. Legacy refresh tokens were revoked, so
  users sign in again with their unchanged passwords. TOTP enrollments made in between stay
  dormant and become active again on the next roll-forward.
* **Policy rollback:** set the MFA mode back to `OPTIONAL` in `/admin/security` (or `UPDATE
  security_policies SET "mfaMode"='OPTIONAL'`); takes effect within 15 s on every instance.
* **Schema rollback** (only if required; destroys auth data created since the migration —
  sessions, factors, codes, audit events): restore the backup from step 1, or run inside a
  transaction:

  ```sql
  BEGIN;
  DROP TABLE IF EXISTS webauthn_challenges, webauthn_credentials;
  DROP TYPE IF EXISTS "WebAuthnChallengePurpose";
  DROP TABLE IF EXISTS auth_rate_limits, security_policies, security_events, invitations,
    one_time_tokens, mfa_recovery_requests, recovery_codes, mfa_challenges, mfa_enrollments,
    mfa_authenticators, auth_sessions;
  DROP INDEX IF EXISTS "users_emailNormalized_key";
  ALTER TABLE users DROP COLUMN IF EXISTS "emailNormalized", DROP COLUMN IF EXISTS "emailVerifiedAt",
    DROP COLUMN IF EXISTS "credentialUpdatedAt", DROP COLUMN IF EXISTS "mfaRequired",
    DROP COLUMN IF EXISTS "mfaEnrolledAt", DROP COLUMN IF EXISTS status;
  DROP TYPE IF EXISTS "UserStatus", "AuthSessionRevokeReason", "MfaFactorType",
    "MfaAuthenticatorStatus", "MfaChallengePurpose", "MfaRecoveryStatus",
    "OneTimeTokenPurpose", "MfaPolicyMode";
  COMMIT;
  ```
  This is destructive by nature and requires explicit review per `docs/15` (database safety).
* **Key loss:** if `AUTH_ENCRYPTION_KEY` is lost, TOTP seeds and recovery-code peppers cannot
  be recovered. Back the key up in the secret manager with the same care as the database
  (restore drill in the runbook). Recovery from key loss = set policy to `OPTIONAL`,
  break-glass reset every account's MFA, users re-enroll.
