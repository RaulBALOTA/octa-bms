-- OCTA BMS secure authentication (sessions, TOTP MFA, recovery, audit).
-- ADDITIVE ONLY: creates new types/tables/columns/indexes; drops nothing, rewrites no
-- business data. Idempotent: safe to re-run. Runs in one transaction.
-- Apply:   pnpm --filter @octa-bms/api exec tsx --env-file=.env prisma/setup-secure-auth.ts --apply
--   or:    psql -v ON_ERROR_STOP=1 -f prisma/sql/add_secure_auth.sql   (after taking a backup)
-- Rollback: see docs/security/MIGRATION_AND_ROLLBACK.md
BEGIN;
SET LOCAL client_min_messages = warning;

-- Abort early if existing emails collide case-insensitively (the new unique index on
-- emailNormalized would fail). Resolve duplicates manually; nothing is changed here.
DO $$
BEGIN
  IF EXISTS (SELECT lower(trim(email)) FROM "users" GROUP BY 1 HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'add_secure_auth: users.email has case-insensitive duplicates; resolve them before applying';
  END IF;
END $$;

DO $$ BEGIN
  CREATE TYPE "UserStatus" AS ENUM ('INVITED', 'ACTIVE', 'DISABLED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "AuthSessionRevokeReason" AS ENUM ('LOGOUT', 'LOGOUT_ALL', 'USER_REVOKED', 'ADMIN_REVOKED', 'PASSWORD_CHANGED', 'PASSWORD_RESET', 'MFA_RESET', 'ACCOUNT_DISABLED', 'ROTATED', 'POLICY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MfaFactorType" AS ENUM ('TOTP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MfaAuthenticatorStatus" AS ENUM ('ACTIVE', 'REVOKED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MfaChallengePurpose" AS ENUM ('LOGIN', 'ENROLL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MfaRecoveryStatus" AS ENUM ('PENDING', 'APPROVED', 'COMPLETED', 'REJECTED', 'CANCELLED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "OneTimeTokenPurpose" AS ENUM ('PASSWORD_RESET', 'EMAIL_VERIFICATION');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "MfaPolicyMode" AS ENUM ('DISABLED', 'OPTIONAL', 'ENROLLMENT_REQUIRED', 'ENFORCED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "credentialUpdatedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "emailNormalized" TEXT,
ADD COLUMN IF NOT EXISTS "emailVerifiedAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "mfaEnrolledAt" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS "mfaRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE TABLE IF NOT EXISTS "auth_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idleExpiresAt" TIMESTAMP(3) NOT NULL,
    "absoluteExpiresAt" TIMESTAMP(3) NOT NULL,
    "authenticatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMfaAt" TIMESTAMP(3),
    "lastReauthAt" TIMESTAMP(3),
    "authMethod" TEXT NOT NULL DEFAULT 'password',
    "revokedAt" TIMESTAMP(3),
    "revokeReason" "AuthSessionRevokeReason",
    "userAgent" TEXT,
    "ipPrefix" TEXT,
    "rotatedFromId" TEXT,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mfa_authenticators" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MfaFactorType" NOT NULL DEFAULT 'TOTP',
    "label" TEXT NOT NULL DEFAULT 'Microsoft Authenticator',
    "encryptedSeed" TEXT NOT NULL,
    "seedKeyId" TEXT NOT NULL,
    "status" "MfaAuthenticatorStatus" NOT NULL DEFAULT 'ACTIVE',
    "confirmedAt" TIMESTAMP(3) NOT NULL,
    "lastUsedStep" BIGINT NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_authenticators_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mfa_enrollments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "encryptedSeed" TEXT NOT NULL,
    "seedKeyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_enrollments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mfa_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "csrfToken" TEXT NOT NULL,
    "purpose" "MfaChallengePurpose" NOT NULL,
    "authMethod" TEXT NOT NULL DEFAULT 'password',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "ipPrefix" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "recovery_codes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "pepperKeyId" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "mfa_recovery_requests" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "verificationMethod" TEXT NOT NULL,
    "status" "MfaRecoveryStatus" NOT NULL DEFAULT 'PENDING',
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mfa_recovery_requests_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "one_time_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "OneTimeTokenPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_time_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "invitations" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "roleId" TEXT,
    "invitedById" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "redeemedAt" TIMESTAMP(3),
    "redeemedUserId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "security_events" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "actorUserId" TEXT,
    "targetUserId" TEXT,
    "companyId" TEXT,
    "correlationId" TEXT,
    "ipPrefix" TEXT,
    "userAgent" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "security_policies" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "mfaMode" "MfaPolicyMode" NOT NULL DEFAULT 'OPTIONAL',
    "enrollmentDeadline" TIMESTAMP(3),
    "sessionIdleMinutes" INTEGER,
    "sessionAbsoluteHours" INTEGER,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "auth_rate_limits" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auth_rate_limits_pkey" PRIMARY KEY ("key","windowStart")
);

CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

CREATE INDEX IF NOT EXISTS "auth_sessions_userId_revokedAt_idx" ON "auth_sessions"("userId", "revokedAt");

CREATE INDEX IF NOT EXISTS "auth_sessions_absoluteExpiresAt_idx" ON "auth_sessions"("absoluteExpiresAt");

CREATE INDEX IF NOT EXISTS "mfa_authenticators_userId_status_idx" ON "mfa_authenticators"("userId", "status");

CREATE INDEX IF NOT EXISTS "mfa_enrollments_userId_idx" ON "mfa_enrollments"("userId");

CREATE INDEX IF NOT EXISTS "mfa_enrollments_expiresAt_idx" ON "mfa_enrollments"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "mfa_challenges_tokenHash_key" ON "mfa_challenges"("tokenHash");

CREATE INDEX IF NOT EXISTS "mfa_challenges_userId_idx" ON "mfa_challenges"("userId");

CREATE INDEX IF NOT EXISTS "mfa_challenges_expiresAt_idx" ON "mfa_challenges"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "recovery_codes_codeHash_key" ON "recovery_codes"("codeHash");

CREATE INDEX IF NOT EXISTS "recovery_codes_userId_usedAt_revokedAt_idx" ON "recovery_codes"("userId", "usedAt", "revokedAt");

CREATE INDEX IF NOT EXISTS "mfa_recovery_requests_status_createdAt_idx" ON "mfa_recovery_requests"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "mfa_recovery_requests_targetUserId_idx" ON "mfa_recovery_requests"("targetUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "one_time_tokens_tokenHash_key" ON "one_time_tokens"("tokenHash");

CREATE INDEX IF NOT EXISTS "one_time_tokens_userId_purpose_idx" ON "one_time_tokens"("userId", "purpose");

CREATE INDEX IF NOT EXISTS "one_time_tokens_expiresAt_idx" ON "one_time_tokens"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "invitations_tokenHash_key" ON "invitations"("tokenHash");

CREATE INDEX IF NOT EXISTS "invitations_email_idx" ON "invitations"("email");

CREATE INDEX IF NOT EXISTS "invitations_companyId_createdAt_idx" ON "invitations"("companyId", "createdAt");

CREATE INDEX IF NOT EXISTS "security_events_createdAt_idx" ON "security_events"("createdAt");

CREATE INDEX IF NOT EXISTS "security_events_targetUserId_createdAt_idx" ON "security_events"("targetUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "security_events_actorUserId_createdAt_idx" ON "security_events"("actorUserId", "createdAt");

CREATE INDEX IF NOT EXISTS "security_events_action_createdAt_idx" ON "security_events"("action", "createdAt");

CREATE INDEX IF NOT EXISTS "auth_rate_limits_expiresAt_idx" ON "auth_rate_limits"("expiresAt");

CREATE UNIQUE INDEX IF NOT EXISTS "users_emailNormalized_key" ON "users"("emailNormalized");

DO $$ BEGIN
  ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_authenticators" ADD CONSTRAINT "mfa_authenticators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_enrollments" ADD CONSTRAINT "mfa_enrollments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "recovery_codes" ADD CONSTRAINT "recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "mfa_recovery_requests" ADD CONSTRAINT "mfa_recovery_requests_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "one_time_tokens" ADD CONSTRAINT "one_time_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "invitations" ADD CONSTRAINT "invitations_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


-- Backfill (additive columns only).
UPDATE "users" SET "emailNormalized" = lower(trim("email")) WHERE "emailNormalized" IS NULL;
UPDATE "users" SET "status" = 'DISABLED' WHERE "isActive" = false AND "status" = 'ACTIVE';
UPDATE "users" SET "credentialUpdatedAt" = COALESCE("passwordChangedAt", "updatedAt") WHERE "credentialUpdatedAt" IS NULL;

-- Legacy JWT refresh tokens: mark revoked (rows are kept for audit). Users sign in again
-- once; the new API no longer accepts bearer JWTs.
UPDATE "refresh_tokens" SET "revokedAt" = now() WHERE "revokedAt" IS NULL;

COMMIT;
