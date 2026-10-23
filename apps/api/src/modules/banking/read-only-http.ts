import { BankProviderError } from './banking.types';

type Method = 'GET' | 'POST' | 'DELETE';

/**
 * HTTP client for bank APIs that enforces read-only access in code.
 *
 * GET is always allowed. Any other method must match an explicit allow-list
 * of consent-management routes (e.g. PSD2 "POST /auth", "POST /sessions");
 * everything else — payments, transfers, beneficiaries — is refused before a
 * request leaves the server.
 */
export class ReadOnlyHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly allowedWrites: { method: Exclude<Method, 'GET'>; path: RegExp }[] = [],
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  get<T>(path: string, headers: Record<string, string>, query?: Record<string, string | string[] | undefined>) {
    return this.send<T>('GET', path, headers, undefined, query);
  }

  post<T>(path: string, headers: Record<string, string>, body: unknown) {
    return this.send<T>('POST', path, headers, body);
  }

  delete<T>(path: string, headers: Record<string, string>) {
    return this.send<T>('DELETE', path, headers);
  }

  private async send<T>(
    method: Method,
    path: string,
    headers: Record<string, string>,
    body?: unknown,
    query?: Record<string, string | string[] | undefined>,
  ): Promise<T> {
    if (method !== 'GET' && !this.allowedWrites.some((w) => w.method === method && w.path.test(path))) {
      throw new BankProviderError(`Blocked ${method} ${path}: bank connections are read-only`);
    }

    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined) continue;
      for (const v of Array.isArray(value) ? value : [value]) url.searchParams.append(key, v);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method,
        headers: {
          Accept: 'application/json',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new BankProviderError(`Bank API unreachable: ${(error as Error).message}`);
    }

    const text = await res.text();
    if (!res.ok) {
      // never echo the request (it carries credentials); the bank's message is enough
      const detail = text.slice(0, 300);
      throw new BankProviderError(
        `Bank API ${method} ${url.pathname} failed with ${res.status}: ${detail}`,
        res.status,
        res.status === 401 || res.status === 403,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
