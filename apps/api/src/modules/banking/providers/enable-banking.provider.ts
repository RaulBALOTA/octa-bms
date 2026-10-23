import { createHash, createPrivateKey, KeyObject } from 'node:crypto';
import { SignJWT } from 'jose';
import {
  BankProvider,
  BankProviderError,
  ConnectionCredentials,
  ConsentResult,
  ConsentStart,
  ExternalBankAccount,
  ExternalBankTransaction,
} from '../banking.types';
import { ReadOnlyHttpClient } from '../read-only-http';

interface EbAmount { amount: string; currency: string }
interface EbParty { name?: string | null }
interface EbAccountRef { iban?: string | null; other?: { identification?: string } | null }

interface EbTransaction {
  entry_reference?: string | null;
  transaction_id?: string | null;
  transaction_amount: EbAmount;
  credit_debit_indicator: 'CRDT' | 'DBIT';
  status?: string;
  booking_date?: string | null;
  value_date?: string | null;
  transaction_date?: string | null;
  creditor?: EbParty | null;
  creditor_account?: EbAccountRef | null;
  debtor?: EbParty | null;
  debtor_account?: EbAccountRef | null;
  remittance_information?: string[] | null;
  reference_number?: string | null;
}

interface EbSessionAccount {
  uid: string;
  account_id?: EbAccountRef | null;
  name?: string | null;
  details?: string | null;
  currency?: string | null;
  account_servicer?: { bic_fi?: string | null } | null;
}

/** Balance types in order of preference (ISO 20022 codes). */
const BALANCE_PREFERENCE = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV', 'OPBD'];
const MAX_PAGES = 200;
const DAY = 86_400_000;

export function mapEnableBankingTransaction(tx: EbTransaction): ExternalBankTransaction {
  const outgoing = tx.credit_debit_indicator === 'DBIT';
  const magnitude = Math.abs(Number(tx.transaction_amount.amount)).toFixed(2);
  const party = outgoing ? tx.creditor : tx.debtor;
  const partyAccount = outgoing ? tx.creditor_account : tx.debtor_account;
  const remittance = (tx.remittance_information ?? []).join(' ').trim() || null;
  const bookingDate = tx.booking_date ? new Date(tx.booking_date) : null;
  // banks without stable ids (frequent for pending lines) get a content hash
  const externalId =
    tx.entry_reference ??
    tx.transaction_id ??
    'h:' +
      createHash('sha256')
        .update([tx.booking_date, tx.value_date, tx.transaction_amount.amount, tx.credit_debit_indicator, party?.name, remittance].join('|'))
        .digest('hex')
        .slice(0, 32);
  return {
    externalId,
    status: tx.status === 'PDNG' ? 'PENDING' : 'BOOKED',
    bookingDate,
    valueDate: tx.value_date ? new Date(tx.value_date) : bookingDate,
    amount: outgoing ? `-${magnitude}` : magnitude,
    currencyCode: tx.transaction_amount.currency,
    counterpartyName: party?.name ?? null,
    counterpartyIban: partyAccount?.iban ?? null,
    remittanceInfo: remittance,
    bankReference: tx.reference_number ?? tx.transaction_id ?? null,
    raw: tx,
  };
}

/**
 * Enable Banking — licensed PSD2 account-information (AIS) aggregator that
 * reaches most German and European banks (Sparkasse, Volksbank, Deutsche
 * Bank, Commerzbank, ING, N26, …) through one API. The user approves a
 * time-limited, read-only consent at their bank; payment initiation is never
 * requested and the client blocks every write except the consent routes.
 */
export class EnableBankingProvider implements BankProvider {
  readonly info;
  private readonly http: ReadOnlyHttpClient;
  private key: KeyObject | null = null;

  constructor(
    private readonly appId: string | undefined,
    private readonly privateKeyPem: string | undefined,
    baseUrl = 'https://api.enablebanking.com',
    private readonly consentDays = 180,
    fetchImpl?: typeof fetch,
  ) {
    this.http = new ReadOnlyHttpClient(
      baseUrl,
      [
        { method: 'POST', path: /^\/auth$/ },
        { method: 'POST', path: /^\/sessions$/ },
        { method: 'DELETE', path: /^\/sessions\/[\w-]+$/ },
      ],
      fetchImpl,
    );
    this.info = {
      code: 'ENABLE_BANKING' as const,
      name: 'Other bank (PSD2 via Enable Banking)',
      authKind: 'REDIRECT_CONSENT' as const,
      configured: Boolean(appId && privateKeyPem),
      description: 'Any PSD2 bank in Europe. You approve a read-only consent at your bank (renew every ~180 days).',
    };
  }

  private async headers() {
    if (!this.appId || !this.privateKeyPem) {
      throw new BankProviderError('Enable Banking is not configured (ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY)');
    }
    this.key ??= createPrivateKey(this.privateKeyPem);
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: this.appId })
      .setIssuer('enablebanking.com')
      .setAudience('api.enablebanking.com')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(this.key);
    return { Authorization: `Bearer ${jwt}` };
  }

  async listInstitutions(country: string) {
    const res = await this.http.get<{ aspsps: { name: string; country: string; logo?: string | null; psu_types?: string[] }[] }>(
      '/aspsps',
      await this.headers(),
      { country: country.toUpperCase(), service: 'AIS' },
    );
    return res.aspsps
      .filter((aspsp) => !aspsp.psu_types || aspsp.psu_types.includes('business'))
      .map((aspsp) => ({ name: aspsp.name, country: aspsp.country, logo: aspsp.logo ?? null }));
  }

  async startConsent(input: { aspspName: string; aspspCountry: string; state: string; redirectUrl: string }): Promise<ConsentStart> {
    const consentExpiresAt = new Date(Date.now() + this.consentDays * DAY);
    const res = await this.http.post<{ url: string }>('/auth', await this.headers(), {
      // AIS only: balances + transactions; no payment scope exists on this call
      access: { valid_until: consentExpiresAt.toISOString(), balances: true, transactions: true },
      aspsp: { name: input.aspspName, country: input.aspspCountry.toUpperCase() },
      state: input.state,
      redirect_url: input.redirectUrl,
      psu_type: 'business',
    });
    return { redirectUrl: res.url, consentExpiresAt };
  }

  async completeConsent(code: string): Promise<ConsentResult> {
    const res = await this.http.post<{
      session_id: string;
      accounts: EbSessionAccount[];
      access?: { valid_until?: string };
    }>('/sessions', await this.headers(), { code });
    const accounts = res.accounts.map((account) => ({
      uid: account.uid,
      iban: account.account_id?.iban ?? null,
      name: account.name ?? account.details ?? null,
      currency: account.currency ?? 'EUR',
      bic: account.account_servicer?.bic_fi ?? null,
    }));
    return {
      credentials: { sessionId: res.session_id, accounts: JSON.stringify(accounts) },
      consentExpiresAt: res.access?.valid_until ? new Date(res.access.valid_until) : null,
    };
  }

  async revoke(credentials: ConnectionCredentials) {
    if (credentials.sessionId) await this.http.delete(`/sessions/${credentials.sessionId}`, await this.headers());
  }

  async listAccounts(credentials: ConnectionCredentials): Promise<ExternalBankAccount[]> {
    const accounts = JSON.parse(credentials.accounts ?? '[]') as {
      uid: string; iban: string | null; name: string | null; currency: string; bic: string | null;
    }[];
    const headers = await this.headers();
    return Promise.all(
      accounts.map(async (account) => {
        const res = await this.http.get<{
          balances: { balance_amount: EbAmount; balance_type?: string; reference_date?: string | null; last_change_date_time?: string | null }[];
        }>(`/accounts/${account.uid}/balances`, headers);
        const balance = [...res.balances].sort(
          (a, b) => rank(a.balance_type) - rank(b.balance_type),
        )[0];
        const at = balance?.last_change_date_time ?? balance?.reference_date;
        return {
          externalId: account.uid,
          name: account.name ?? account.iban ?? 'Bank account',
          iban: account.iban,
          bic: account.bic,
          currencyCode: balance?.balance_amount.currency ?? account.currency,
          balance: balance ? Number(balance.balance_amount.amount).toFixed(2) : null,
          balanceAt: at ? new Date(at) : new Date(),
        };
      }),
    );
  }

  async listTransactions(
    _credentials: ConnectionCredentials,
    account: { externalId: string },
    since: Date,
  ): Promise<ExternalBankTransaction[]> {
    const headers = await this.headers();
    const out: ExternalBankTransaction[] = [];
    let continuationKey: string | undefined;
    for (let i = 0; i < MAX_PAGES; i++) {
      const res: { transactions: EbTransaction[]; continuation_key?: string | null } = await this.http.get(
        `/accounts/${account.externalId}/transactions`,
        headers,
        { date_from: since.toISOString().slice(0, 10), continuation_key: continuationKey },
      );
      out.push(...res.transactions.map(mapEnableBankingTransaction));
      continuationKey = res.continuation_key ?? undefined;
      if (!continuationKey) break;
    }
    return out;
  }
}

function rank(type: string | undefined) {
  const index = BALANCE_PREFERENCE.indexOf(type ?? '');
  return index === -1 ? BALANCE_PREFERENCE.length : index;
}
