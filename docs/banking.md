# Bank connections (read-only)

OCTA BMS imports **balances and transactions** from the company's banks. Access
is **read-only by design**: OCTA cannot initiate payments, transfers, direct
debits or change beneficiaries at any bank.

| Bank | How OCTA connects | Credential |
|---|---|---|
| **Qonto** | Qonto Business API (`thirdparty.qonto.com/v2`) | Organization API key (login + secret key), entered once in the UI |
| **Any other European bank** (Sparkasse, Volksbank, Deutsche Bank, Commerzbank, ING, N26, …) | PSD2 Account Information Service via the licensed aggregator [Enable Banking](https://enablebanking.com) | Consent the user approves at the bank; valid up to 180 days, renewable |

Finance → **Bank connections** (`/finance/banking`) lists connections, account
balances as reported by the bank, and the imported statement lines.

## How read-only is enforced

1. **No write capability in the code.** The provider contract
   (`apps/api/src/modules/banking/banking.types.ts`) has only list/read methods.
   There is no payment, transfer or beneficiary method to call.
2. **HTTP guard.** Every bank request goes through `ReadOnlyHttpClient`, which
   allows `GET` and refuses any other method unless the route is on the
   provider's consent allow-list (Enable Banking: `POST /auth`, `POST /sessions`,
   `DELETE /sessions/{id}`). Qonto has an empty allow-list, so OCTA only ever
   sends `GET` to Qonto. Unit tests cover this (`read-only-http.spec.ts`).
3. **Narrow consent.** PSD2 consents ask only for account information
   (`balances`, `transactions`). Payment initiation is never requested.
4. **Imported ≠ booked.** Statement lines go to `bank_transactions`. Importing
   never creates payments or changes invoice status. Matching lines to invoices
   (reconciliation) is a separate, later step (`bank_transactions.paymentId`).

On the Qonto side, create a dedicated API key for OCTA and revoke it in Qonto
if you stop using the connection. OCTA uses only read endpoints whatever the key
allows. Once OCTA is registered as a Qonto OAuth partner, the OAuth flow with
read-only scopes can replace the API key without changing the rest of the module.

## Security

- **Credentials at rest:** API keys and PSD2 session ids are encrypted with
  AES-256-GCM (`BANKING_ENCRYPTION_KEY`). The API never returns them, and the
  audit log does not record request bodies.
- **Back up the key.** If `BANKING_ENCRYPTION_KEY` is lost or changed, the stored
  credentials can't be decrypted, and every bank must be reconnected. Statement
  history is kept.
- **Consent state:** the PSD2 redirect `state` is a random UUID tied to the
  company and the pending connection. It is single-use.
- **Multi-company:** accounts are linked by IBAN only within the same company.
  An IBAN that already belongs to another company is skipped and never shared.

## Permissions

| Code | Grants | Default roles |
|---|---|---|
| `finance.banking.read` | View connections, balances, transactions | System admin, Finance manager, Managing director |
| `finance.banking.create` | Connect a bank / start or renew a consent | System admin, Finance manager |
| `finance.banking.update` | Trigger a sync | System admin, Finance manager |
| `finance.banking.delete` | Disconnect a bank | System admin, Finance manager |

These permissions only control what users can do *inside OCTA*. None of them
gives anyone write access at a bank.

## Setup

### Existing database

```bash
psql "$DATABASE_URL" -f apps/api/prisma/sql/add_bank_connections.sql
psql "$DATABASE_URL" -f apps/api/prisma/sql/grant_banking_permissions.sql
```

Fresh databases get the tables from `pnpm db:push` and the permissions from
`pnpm db:seed`.

### Environment (`apps/api/.env`)

```bash
BANKING_ENABLED=true
BANKING_ENCRYPTION_KEY=$(openssl rand -base64 32)   # store it in your secret manager
```

**Qonto** needs no server config. In the Qonto web app, go to *Settings →
Integrations & partnerships → API key*, then enter the login and secret key under
*Bank connections → Connect bank → Qonto*. OCTA checks the key, imports the
accounts and fetches the last `BANKING_SYNC_LOOKBACK_DAYS` (default 90) days.

**Other banks (PSD2):**

1. Register an application at Enable Banking. Set the redirect URL to
   `{APP_URL}/finance/banking/callback` (for example
   `https://bms.example.com/finance/banking/callback`).
2. Set `ENABLE_BANKING_APP_ID` and `ENABLE_BANKING_PRIVATE_KEY`. The key can be a
   path to the downloaded `.pem` or the PEM text itself.
3. In OCTA, go to *Connect bank → Other bank (PSD2)*. Pick the country and the bank,
   then approve the read-only consent at the bank. You return to OCTA, and the
   first sync runs.
4. Before the consent ends (shown on the card, with a warning 14 days ahead),
   click **Renew consent**.

## Sync

- **Automatic** every 6 hours for all active connections (`BankSyncScheduler`).
  This stays within PSD2's limit of 4 unattended reads per day.
- **Manual** with *Sync now* on the connection card.
- **Incremental:** each run re-reads from 7 days before the last sync, so late
  bookings and pending → booked changes are picked up. Upserts are keyed by
  `(bankAccountId, externalId)`, so re-running never duplicates lines.
- **Pending and declined lines:** pending lines update in place when they book.
  Qonto lines that end up declined are removed. PSD2 pending lines without a bank
  id are replaced on every run.
- **Errors:** a rejected key or consent (HTTP 401/403) sets the connection to
  `EXPIRED`. Other failures set it to `ERROR` and show `lastError` on the card.
- **Balances:** connected accounts show the balance reported by the bank. That
  balance is also used by *Payments → bank accounts* and as the starting balance
  of the cash flow forecast. Manual accounts still use opening balance plus
  recorded payments.

## Adding another bank provider

Implement `BankProvider` in `apps/api/src/modules/banking/providers/`:

- `info`
- `listAccounts`
- `listTransactions`
- for redirect flows: `startConsent`, `completeConsent`, `listInstitutions`, `revoke`

Then:

1. Build its HTTP client as a `ReadOnlyHttpClient` with the smallest possible
   write allow-list.
2. Register the provider in `BankingService`.
3. Add its code to the DTOs and the `banking.providers.*` i18n keys.

Candidates: a direct API for a house bank, or another AIS aggregator such as
finAPI or Tink.

## Verify before go-live

The Qonto and Enable Banking field mappings follow the providers' published
API formats. The unit tests use mocked responses. Before relying on the data,
run one sync against the **Qonto sandbox** (`QONTO_API_BASE` = sandbox URL plus
`QONTO_STAGING_TOKEN`) and the **Enable Banking sandbox** (the "Mock ASPSP"
bank). Compare a few lines with the bank statement.

## API

| Method | Path | Permission |
|---|---|---|
| GET | `/api/v1/finance/banking/capabilities` | `finance.banking.read` |
| GET | `/api/v1/finance/banking/connections` | `finance.banking.read` |
| GET | `/api/v1/finance/banking/transactions?bankAccountId&from&to&direction&q&page&pageSize` | `finance.banking.read` |
| GET | `/api/v1/finance/banking/institutions?provider=ENABLE_BANKING&country=DE` | `finance.banking.create` |
| POST | `/api/v1/finance/banking/connections` (Qonto API key) | `finance.banking.create` |
| POST | `/api/v1/finance/banking/consents` (start or renew PSD2 consent) | `finance.banking.create` |
| POST | `/api/v1/finance/banking/consents/complete` | `finance.banking.create` |
| POST | `/api/v1/finance/banking/connections/:id/sync` | `finance.banking.update` |
| DELETE | `/api/v1/finance/banking/connections/:id` | `finance.banking.delete` |
