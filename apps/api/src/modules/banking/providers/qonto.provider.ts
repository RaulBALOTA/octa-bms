import {
  BankProvider,
  BankProviderError,
  ConnectionCredentials,
  ExternalBankAccount,
  ExternalBankTransaction,
} from '../banking.types';
import { ReadOnlyHttpClient } from '../read-only-http';

interface QontoBankAccount {
  id: string;
  slug?: string;
  name?: string;
  iban?: string;
  bic?: string;
  currency?: string;
  balance?: number;
  balance_cents?: number;
  updated_at?: string;
  status?: string;
}

interface QontoTransaction {
  id: string;
  transaction_id?: string;
  amount?: number;
  amount_cents?: number;
  side: 'credit' | 'debit';
  currency?: string;
  label?: string;
  reference?: string | null;
  note?: string | null;
  status: 'pending' | 'declined' | 'completed' | string;
  settled_at?: string | null;
  emitted_at?: string | null;
  operation_type?: string;
  transfer?: { counterparty_account_number?: string | null } | null;
  income?: { counterparty_account_number?: string | null } | null;
}

interface QontoPage {
  transactions: QontoTransaction[];
  meta?: { next_page?: number | null };
}

const PER_PAGE = 100;
const MAX_PAGES = 200; // 20k lines per sync — a runaway guard, not a business limit

/** Qonto amounts come as cents (preferred) or a float in major units. */
function decimal(cents: number | undefined, units: number | undefined): string {
  if (typeof cents === 'number') return (cents / 100).toFixed(2);
  return (units ?? 0).toFixed(2);
}

export function mapQontoTransaction(tx: QontoTransaction): ExternalBankTransaction {
  const magnitude = decimal(tx.amount_cents, tx.amount).replace(/^-/, '');
  const settled = tx.settled_at ? new Date(tx.settled_at) : null;
  return {
    externalId: tx.id,
    status: tx.status === 'completed' ? 'BOOKED' : tx.status === 'pending' ? 'PENDING' : 'VOID',
    bookingDate: settled,
    valueDate: settled ?? (tx.emitted_at ? new Date(tx.emitted_at) : null),
    amount: tx.side === 'debit' ? `-${magnitude}` : magnitude,
    currencyCode: tx.currency ?? 'EUR',
    counterpartyName: tx.label ?? null,
    counterpartyIban:
      tx.transfer?.counterparty_account_number ?? tx.income?.counterparty_account_number ?? null,
    remittanceInfo: [tx.reference, tx.note].filter(Boolean).join(' · ') || null,
    bankReference: tx.transaction_id ?? null,
    raw: tx,
  };
}

/**
 * Qonto Business API (https://thirdparty.qonto.com/v2), authenticated with an
 * organization API key sent as `Authorization: <login>:<secret-key>`.
 * Only GET endpoints are called; the client refuses anything else.
 */
export class QontoProvider implements BankProvider {
  readonly info;
  private readonly http: ReadOnlyHttpClient;

  constructor(
    baseUrl = 'https://thirdparty.qonto.com',
    private readonly stagingToken?: string,
    fetchImpl?: typeof fetch,
  ) {
    this.http = new ReadOnlyHttpClient(baseUrl, [], fetchImpl);
    this.info = {
      code: 'QONTO' as const,
      name: 'Qonto',
      authKind: 'API_KEY' as const,
      configured: true,
      description: 'Direct Qonto Business API with an organization API key (read-only).',
    };
  }

  private headers(credentials: ConnectionCredentials) {
    const { login, secretKey } = credentials;
    if (!login || !secretKey) throw new BankProviderError('Qonto login and secret key are required');
    return {
      Authorization: `${login}:${secretKey}`,
      ...(this.stagingToken ? { 'X-Qonto-Staging-Token': this.stagingToken } : {}),
    };
  }

  async verifyCredentials(credentials: ConnectionCredentials) {
    await this.listAccounts(credentials);
  }

  async listAccounts(credentials: ConnectionCredentials): Promise<ExternalBankAccount[]> {
    const res = await this.http.get<{ organization: { bank_accounts?: QontoBankAccount[] } }>(
      '/v2/organization',
      this.headers(credentials),
    );
    return (res.organization?.bank_accounts ?? [])
      .filter((account) => account.status !== 'closed')
      .map((account) => ({
        externalId: account.id,
        name: account.name ?? account.slug ?? account.iban ?? 'Qonto',
        iban: account.iban ?? null,
        bic: account.bic ?? null,
        currencyCode: account.currency ?? 'EUR',
        balance: decimal(account.balance_cents, account.balance),
        balanceAt: account.updated_at ? new Date(account.updated_at) : new Date(),
      }));
  }

  async listTransactions(
    credentials: ConnectionCredentials,
    account: { externalId: string },
    since: Date,
  ): Promise<ExternalBankTransaction[]> {
    const headers = this.headers(credentials);
    const out: ExternalBankTransaction[] = [];
    let page: number | null | undefined = 1;
    for (let i = 0; page && i < MAX_PAGES; i++) {
      const res: QontoPage = await this.http.get<QontoPage>('/v2/transactions', headers, {
        bank_account_id: account.externalId,
        // declined lines are fetched only so an earlier pending copy gets removed
        'status[]': ['pending', 'completed', 'declined'],
        updated_at_from: since.toISOString(),
        'includes[]': ['transfer'],
        sort_by: 'updated_at:asc',
        per_page: String(PER_PAGE),
        current_page: String(page),
      });
      out.push(...res.transactions.map(mapQontoTransaction));
      page = res.meta?.next_page;
    }
    return out;
  }
}
