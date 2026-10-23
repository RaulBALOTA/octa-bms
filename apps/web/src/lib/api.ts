import { useAuthStore } from '../stores/auth';

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  retry = true,
  responseType: 'json' | 'blob' = 'json',
): Promise<T> {
  const { accessToken, companyId } = useAuthStore.getState();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (companyId) headers['X-Company-Id'] = companyId;

  const res = await fetch(`${BASE}${path}`, { ...options, headers });

  if (res.status === 401 && retry) {
    const refreshed = await useAuthStore.getState().tryRefresh();
    if (refreshed) return request<T>(path, options, false, responseType);
    useAuthStore.getState().logout();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => undefined);
    throw new ApiError(
      res.status,
      (body as { message?: string })?.message ?? res.statusText,
      body,
    );
  }
  if (res.status === 204) return undefined as T;
  if (responseType === 'blob') return (await res.blob()) as T;
  return (await res.json()) as T;
}

function authHeaders(): Record<string, string> {
  const { accessToken, companyId } = useAuthStore.getState();
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (companyId) headers['X-Company-Id'] = companyId;
  return headers;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  blob: (path: string, signal?: AbortSignal) => request<Blob>(path, { signal }, true, 'blob'),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),

  /** multipart upload — browser sets the Content-Type boundary itself */
  async upload<T>(path: string, formData: FormData, retry = true): Promise<T> {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: authHeaders(),
      body: formData,
    });
    if (res.status === 401 && retry) {
      if (await useAuthStore.getState().tryRefresh()) return api.upload<T>(path, formData, false);
      useAuthStore.getState().logout();
    }
    if (!res.ok) {
      const body = await res.json().catch(() => undefined);
      throw new ApiError(
        res.status,
        (body as { message?: string })?.message ?? res.statusText,
        body,
      );
    }
    return (await res.json()) as T;
  },

  /** authenticated file download → triggers a browser save dialog */
  async download(path: string, fallbackName: string): Promise<void> {
    const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
    if (!res.ok) throw new ApiError(res.status, res.statusText);
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
