import { describe, expect, it, vi } from 'vitest';
import { mapQontoTransaction, QontoProvider } from './qonto.provider';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const creds = { login: 'octa-gmbh-1234', secretKey: 'sk' };

describe('QontoProvider', () => {
  it('lists open accounts with the Qonto login:secret header', async () => {
    const fetchImpl = vi.fn(async () =>
      json({
        organization: {
          bank_accounts: [
            { id: 'acc-1', name: 'Main', iban: 'FR7616958000011234567890123', bic: 'QNTOFRP1', currency: 'EUR', balance_cents: 1234567, updated_at: '2026-10-22T10:00:00Z', status: 'active' },
            { id: 'acc-2', name: 'Old', iban: 'FR76X', status: 'closed' },
          ],
        },
      }),
    );
    const accounts = await new QontoProvider('https://q.test', undefined, fetchImpl as any).listAccounts(creds);
    expect(accounts).toEqual([
      expect.objectContaining({ externalId: 'acc-1', iban: 'FR7616958000011234567890123', balance: '12345.67', currencyCode: 'EUR' }),
    ]);
    const init = (fetchImpl.mock.calls[0] as unknown as [URL, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe('octa-gmbh-1234:sk');
    expect(init.method).toBe('GET');
  });

  it('pages through transactions until next_page is empty', async () => {
    const tx = (id: string) => ({ id, amount_cents: 1000, side: 'credit', status: 'completed', settled_at: '2026-10-01T00:00:00Z' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ transactions: [tx('t1')], meta: { next_page: 2 } }))
      .mockResolvedValueOnce(json({ transactions: [tx('t2')], meta: { next_page: null } }));
    const lines = await new QontoProvider('https://q.test', undefined, fetchImpl).listTransactions(creds, { externalId: 'acc-1' }, new Date('2026-09-01'));
    expect(lines.map((l) => l.externalId)).toEqual(['t1', 't2']);
    const url = (fetchImpl.mock.calls[1] as [URL])[0];
    expect(url.searchParams.get('bank_account_id')).toBe('acc-1');
    expect(url.searchParams.get('current_page')).toBe('2');
  });

  it('maps sides to signed amounts and declined lines to VOID', () => {
    const debit = mapQontoTransaction({ id: 'd', amount: 49.9, side: 'debit', status: 'completed', label: 'AWS', reference: 'INV-1', settled_at: '2026-10-02T08:00:00Z', transfer: { counterparty_account_number: 'DE89370400440532013000' } });
    expect(debit).toMatchObject({ amount: '-49.90', status: 'BOOKED', counterpartyName: 'AWS', counterpartyIban: 'DE89370400440532013000', remittanceInfo: 'INV-1' });
    expect(mapQontoTransaction({ id: 'p', amount_cents: 500, side: 'credit', status: 'pending' })).toMatchObject({ amount: '5.00', status: 'PENDING', bookingDate: null });
    expect(mapQontoTransaction({ id: 'x', amount_cents: 500, side: 'debit', status: 'declined' }).status).toBe('VOID');
  });
});
