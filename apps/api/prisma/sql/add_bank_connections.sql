-- Read-only bank API connections (Qonto + PSD2 aggregator) and imported
-- statement lines. Additive only: existing bank accounts and payments are untouched.
BEGIN;
CREATE TABLE "bank_connections" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "accessScope" TEXT NOT NULL DEFAULT 'READ_ONLY',
  "credentials" TEXT,
  "aspspName" TEXT,
  "aspspCountry" TEXT,
  "consentState" TEXT,
  "consentExpiresAt" TIMESTAMP(3),
  "lastSyncAt" TIMESTAMP(3),
  "lastSyncStatus" TEXT,
  "lastError" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "deletedAt" TIMESTAMP(3),
  CONSTRAINT "bank_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bank_connections_consentState_key" ON "bank_connections"("consentState");
CREATE INDEX "bank_connections_companyId_idx" ON "bank_connections"("companyId");

ALTER TABLE "bank_accounts"
  ADD COLUMN "connectionId" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "syncedBalance" DECIMAL(18,2),
  ADD COLUMN "syncedBalanceAt" TIMESTAMP(3);
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE UNIQUE INDEX "bank_accounts_connectionId_externalId_key" ON "bank_accounts"("connectionId", "externalId");

CREATE TABLE "bank_transactions" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bankAccountId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "bookingDate" TIMESTAMP(3),
  "valueDate" TIMESTAMP(3),
  "amount" DECIMAL(18,2) NOT NULL,
  "currencyCode" TEXT NOT NULL DEFAULT 'EUR',
  "counterpartyName" TEXT,
  "counterpartyIban" TEXT,
  "remittanceInfo" TEXT,
  "bankReference" TEXT,
  "raw" JSONB,
  "paymentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "bank_transactions_bankAccountId_externalId_key" ON "bank_transactions"("bankAccountId", "externalId");
CREATE INDEX "bank_transactions_bankAccountId_bookingDate_idx" ON "bank_transactions"("bankAccountId", "bookingDate");
COMMIT;
