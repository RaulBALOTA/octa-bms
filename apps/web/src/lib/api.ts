import { useAuthStore } from '../stores/auth';
import { requestStepUp } from '../stores/step-up';

const BASE = '/api/v1';
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }

  get code(): string | undefined {
    return (this.body as { code?: string } | undefined)?.code;
  }
}

function headersFor(method: string, extra: Record<string, string> = {}, json = true): Record<string, string> {
  const { companyId, csrfToken } = useAuthStore.getState();
  const headers: Record<string, string> = { ...(json ? { 'Content-Type': 'application/json' } : {}), ...extra };
  if (companyId) headers['X-Company-Id'] = companyId;
  if (UNSAFE.has(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

/**
 * Handles auth-related failures in one place:
 *  401 → identity dropped, route guard sends the user to /login (no retry loop);
 *  403 STEP_UP_REQUIRED → step-up dialog, then exactly one retry;
 *  403 CSRF_REJECTED → refresh the CSRF token once, then exactly one retry.
 */
async function handleFailure(res: Response, attempt: number): Promise<'retry' | ApiError> {
  const body = await res.json().catch(() => undefined) as { code?: string; message?: string; method?: 'totp' | 'password' } | undefined;
  if (res.status === 401) {
    useAuthStore.getState().markSignedOut(body?.code);
  } else if (res.status === 403 && attempt === 0) {
    if (body?.code === 'STEP_UP_REQUIRED' && (await requestStepUp(body.method ?? 'totp'))) return 'retry';
    if (body?.code === 'CSRF_REJECTED') {
      await useAuthStore.getState().refreshState();
      return 'retry';
    }
  }
  return new ApiError(res.status, body?.message ?? res.statusText, body);
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  responseType: 'json' | 'blob' = 'json',
  attempt = 0,
): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();
  const isForm = options.body instanceof FormData;
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: headersFor(method, options.headers as Record<string, string>, !isForm),
  });
  if (!res.ok) {
    const outcome = await handleFailure(res, attempt);
    if (outcome === 'retry') return request<T>(path, options, responseType, attempt + 1);
    throw outcome;
  }
  if (res.status === 204) return undefined as T;
  if (responseType === 'blob') return (await res.blob()) as T;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  blob: (path: string, signal?: AbortSignal) => request<Blob>(path, { signal }, 'blob'),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** multipart upload — browser sets the Content-Type boundary itself */
  upload<T>(path: string, formData: FormData): Promise<T> {
    return request<T>(path, { method: 'POST', body: formData });
  },

  /** authenticated file download → triggers a browser save dialog */
  async download(path: string, fallbackName: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin', headers: headersFor('GET', {}, false) });
    if (!res.ok) {
      const outcome = await handleFailure(res, 1);
      throw outcome === 'retry' ? new ApiError(res.status, res.statusText) : outcome;
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition') ?? '';
    const match = /filename="?([^";]+)"?/.exec(disposition);
    const name = match ? decodeURIComponent(match[1]) : fallbackName;
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    URL.revokeObjectURL(url);
  },
};

export interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}
