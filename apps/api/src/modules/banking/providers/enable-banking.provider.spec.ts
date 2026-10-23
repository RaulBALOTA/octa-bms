import { generateKeyPairSync } from 'node:crypto';
import { decodeProtectedHeader, decodeJwt } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import { EnableBankingProvider, mapEnableBankingTransaction } from './enable-banking.provider';

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

describe('EnableBankingProvider', () => {
  it('is unconfigured without app credentials', () => {
    expect(new EnableBankingProvider(undefined, undefined).info.configured).toBe(false);
    expect(new EnableBankingProvider('app-1', pem).info.configured).toBe(true);
  });

  it('starts an AIS-only consent signed with an RS256 JWT carrying the app id', async () => {
    const fetchImpl = vi.fn(async () => json({ url: 'https://bank.example/consent', authorization_id: 'a1' }));
    const provider = new EnableBankingProvider('app-1', pem, 'https://eb.test', 90, fetchImpl as any);
    const res = await provider.startConsent({ aspspName: 'Sparkasse', aspspCountry: 'de', state: 'st', redirectUrl: 'https://bms/cb' });
    expect(res.redirectUrl).toBe('https://bank.example/consent');

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.pathname).toBe('/auth');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ aspsp: { name: 'Sparkasse', country: 'DE' }, state: 'st', redirect_url: 'https://bms/cb', psu_type: 'business' });
    expect(body.access).toMatchObject({ balances: true, transactions: true });
    expect(JSON.stringify(body)).not.toMatch(/payment/i);

    const jwt = (init.headers as Record<string, string>).Authorization.replace('Bearer ', '');
    expect(decodeProtectedHeader(jwt)).toMatchObject({ alg: 'RS256', kid: 'app-1' });
    expect(decodeJwt(jwt)).toMatchObject({ iss: 'enablebanking.com', aud: 'api.enablebanking.com' });
  });

  it('stores the session accounts and reads balances from them', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ session_id: 's-1', accounts: [{ uid: 'u-1', account_id: { iban: 'DE02120300000000202051' }, name: 'Geschäftskonto', currency: 'EUR' }], access: { valid_until: '2027-04-01T00:00:00Z' } }))
      .mockResolvedValueOnce(json({ balances: [
        { balance_amount: { amount: '99.00', currency: 'EUR' }, balance_type: 'ITAV' },
        { balance_amount: { amount: '100.50', currency: 'EUR' }, balance_type: 'CLBD', reference_date: '2026-10-22' },
      ] }));
    const provider = new EnableBankingProvider('app-1', pem, 'https://eb.test', 180, fetchImpl);
    const consent = await provider.completeConsent('code-1');
    expect(consent.credentials.sessionId).toBe('s-1');
    expect(consent.consentExpiresAt?.toISOString()).toBe('2027-04-01T00:00:00.000Z');

    const accounts = await provider.listAccounts(consent.credentials);
    expect(accounts).toEqual([expect.objectContaining({ externalId: 'u-1', iban: 'DE02120300000000202051', balance: '100.50' })]);
  });

  it('follows continuation keys', async () => {
    const line = (ref: string) => ({ entry_reference: ref, transaction_amount: { amount: '1.00', currency: 'EUR' }, credit_debit_indicator: 'CRDT', status: 'BOOK', booking_date: '2026-10-01' });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ transactions: [line('r1')], continuation_key: 'k2' }))
      .mockResolvedValueOnce(json({ transactions: [line('r2')] }));
    const provider = new EnableBankingProvider('app-1', pem, 'https://eb.test', 180, fetchImpl);
    const lines = await provider.listTransactions({}, { externalId: 'u-1' }, new Date('2026-09-15T12:00:00Z'));
    expect(lines.map((l) => l.externalId)).toEqual(['r1', 'r2']);
    const first = (fetchImpl.mock.calls[0] as [URL])[0];
    expect(first.searchParams.get('date_from')).toBe('2026-09-15');
    expect((fetchImpl.mock.calls[1] as [URL])[0].searchParams.get('continuation_key')).toBe('k2');
  });

  it('maps debits to the creditor and hashes lines without a bank id', () => {
    const tx = {
      transaction_amount: { amount: '250.00', currency: 'EUR' },
      credit_debit_indicator: 'DBIT' as const,
      status: 'PDNG',
      booking_date: null,
      value_date: '2026-10-03',
      creditor: { name: 'Stadtwerke' },
      creditor_account: { iban: 'DE44500105175407324931' },
      remittance_information: ['Abschlag', 'Oktober'],
    };
    const mapped = mapEnableBankingTransaction(tx);
    expect(mapped).toMatchObject({ amount: '-250.00', status: 'PENDING', counterpartyName: 'Stadtwerke', counterpartyIban: 'DE44500105175407324931', remittanceInfo: 'Abschlag Oktober' });
    expect(mapped.externalId).toMatch(/^h:[0-9a-f]{32}$/);
    expect(mapEnableBankingTransaction(tx).externalId).toBe(mapped.externalId);
  });
});
