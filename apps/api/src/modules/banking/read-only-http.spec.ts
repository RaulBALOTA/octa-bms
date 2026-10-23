import { describe, expect, it, vi } from 'vitest';
import { BankProviderError } from './banking.types';
import { ReadOnlyHttpClient } from './read-only-http';

const ok = (body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }));

describe('ReadOnlyHttpClient', () => {
  it('sends GET requests with repeated array query params', async () => {
    const fetchImpl = ok({ ok: true });
    const http = new ReadOnlyHttpClient('https://bank.test', [], fetchImpl as any);
    await http.get('/v2/transactions', { Authorization: 'x' }, { 'status[]': ['pending', 'completed'], page: '2', skip: undefined });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.toString()).toBe('https://bank.test/v2/transactions?status%5B%5D=pending&status%5B%5D=completed&page=2');
    expect(init.method).toBe('GET');
  });

  it('refuses every write that is not an allow-listed consent route', async () => {
    const fetchImpl = ok({});
    const http = new ReadOnlyHttpClient('https://bank.test', [{ method: 'POST', path: /^\/auth$/ }], fetchImpl as any);
    await expect(http.post('/v2/sepa/transfers', {}, { amount: 1 })).rejects.toThrow(/read-only/);
    await expect(http.post('/payments', {}, {})).rejects.toThrow(/read-only/);
    await expect(http.delete('/auth', {})).rejects.toThrow(/read-only/);
    expect(fetchImpl).not.toHaveBeenCalled();
    await http.post('/auth', {}, { state: 's' });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('flags 401/403 as an invalid consent without echoing credentials', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"message":"unauthorized"}', { status: 401 }));
    const http = new ReadOnlyHttpClient('https://bank.test', [], fetchImpl as any);
    const error = (await http.get('/v2/organization', { Authorization: 'login:SECRET' }).catch((e) => e)) as BankProviderError;
    expect(error).toBeInstanceOf(BankProviderError);
    expect(error.consentExpired).toBe(true);
    expect(error.message).not.toContain('SECRET');
  });
});
