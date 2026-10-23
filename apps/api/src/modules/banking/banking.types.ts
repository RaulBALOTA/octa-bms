/**
 * Provider-neutral contract for bank API connections.
 *
 * Every provider is READ-ONLY: it can list accounts, balances and statement
 * lines, nothing else. There is deliberately no method for payments,
 * transfers or beneficiaries — adding write access later means a new,
 * separately permissioned interface, not a new method here.
 */

export type BankProviderCode = 'QONTO' | 'ENABLE_BANKING';

/** How a user grants OCTA access to the bank. */
export type BankAuthKind =
  /** Credentials typed into OCTA once (Qonto API key). */
  | 'API_KEY'
  /** User is redirected to the bank to approve a time-limited PSD2 consent. */
  | 'REDIRECT_CONSENT';

export interface BankProviderInfo {
  code: BankProviderCode;
  name: string;
  authKind: BankAuthKind;
  /** False when the server lacks the provider's app credentials. */
  configured: boolean;
  description: string;
}

export interface ExternalBankAccount {
  externalId: string;
  name: string;
  iban: string | null;
  bic: string | null;
  currencyCode: string;
  /** Current balance as reported by the bank, decimal string. */
  balance: string | null;
  balanceAt: Date | null;
}

export interface ExternalBankTransaction {
  /** Stable per account; used for idempotent upserts. */
  externalId: string;
  /** VOID = the bank dropped a line it reported earlier (e.g. a declined card payment). */
  status: 'BOOKED' | 'PENDING' | 'VOID';
  bookingDate: Date | null;
  valueDate: Date | null;
  /** Signed decimal string: positive = money in, negative = money out. */
  amount: string;
  currencyCode: string;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittanceInfo: string | null;
  bankReference: string | null;
  raw: unknown;
}

/** Decrypted per-connection secret; shape is provider-specific. */
export type ConnectionCredentials = Record<string, string>;

export interface ConsentStart {
  /** Where the browser must go to approve access at the bank. */
  redirectUrl: string;
  consentExpiresAt: Date;
}

export interface ConsentResult {
  credentials: ConnectionCredentials;
  consentExpiresAt: Date | null;
}

export interface BankProvider {
  readonly info: BankProviderInfo;

  /** Checks API-key credentials before they are stored. */
  verifyCredentials?(credentials: ConnectionCredentials): Promise<void>;

  /** REDIRECT_CONSENT only: starts a read-only (AIS) consent at the bank. */
  startConsent?(input: {
    aspspName: string;
    aspspCountry: string;
    state: string;
    redirectUrl: string;
  }): Promise<ConsentStart>;

  /** REDIRECT_CONSENT only: exchanges the callback code for a session. */
  completeConsent?(code: string): Promise<ConsentResult>;

  /** REDIRECT_CONSENT only: lists banks the user can pick from. */
  listInstitutions?(country: string): Promise<{ name: string; country: string; logo: string | null }[]>;

  /** Ends the consent at the provider (best effort). */
  revoke?(credentials: ConnectionCredentials): Promise<void>;

  listAccounts(credentials: ConnectionCredentials): Promise<ExternalBankAccount[]>;

  listTransactions(
    credentials: ConnectionCredentials,
    account: { externalId: string; iban: string | null },
    since: Date,
  ): Promise<ExternalBankTransaction[]>;
}

/** Raised for provider errors; `consentExpired` flips the connection to EXPIRED. */
export class BankProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly consentExpired = false,
  ) {
    super(message);
  }
}
