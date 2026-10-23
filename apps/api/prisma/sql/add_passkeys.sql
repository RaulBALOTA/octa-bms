-- OCTA BMS passkeys (WebAuthn) for administrators + MFA configuration fields.
-- Requires add_secure_auth.sql. ADDITIVE ONLY, idempotent, one transaction.
-- Apply: pnpm --filter @octa-bms/api auth:setup --apply   (local; takes a pg_dump first)
--    or: psql -v ON_ERROR_STOP=1 -f prisma/sql/add_passkeys.sql   (after a backup)
BEGIN;
SET LOCAL client_min_messages = warning;

DO $$ BEGIN
  CREATE TYPE "WebAuthnChallengePurpose" AS ENUM ('REGISTER', 'AUTHENTICATE', 'STEP_UP');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "security_policies" ADD COLUMN IF NOT EXISTS "passkeysEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS "requirePasskeyForAdmins" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "stepUpMaxAgeMinutes" INTEGER;

CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "publicKey" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[],
    "aaguid" TEXT,
    "deviceType" TEXT NOT NULL,
    "backedUp" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "webauthn_challenges" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" "WebAuthnChallengePurpose" NOT NULL,
    "challenge" TEXT NOT NULL,
    "bindingId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webauthn_challenges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_credentials_credentialId_key" ON "webauthn_credentials"("credentialId");

CREATE INDEX IF NOT EXISTS "webauthn_credentials_userId_revokedAt_idx" ON "webauthn_credentials"("userId", "revokedAt");

CREATE UNIQUE INDEX IF NOT EXISTS "webauthn_challenges_challenge_key" ON "webauthn_challenges"("challenge");

CREATE INDEX IF NOT EXISTS "webauthn_challenges_userId_purpose_idx" ON "webauthn_challenges"("userId", "purpose");

CREATE INDEX IF NOT EXISTS "webauthn_challenges_expiresAt_idx" ON "webauthn_challenges"("expiresAt");

DO $$ BEGIN
  ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "webauthn_challenges" ADD CONSTRAINT "webauthn_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
