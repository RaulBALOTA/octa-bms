/**
 * HTTP client for the PMO application (RaulBALOTA/PMO-Web, services/api).
 *
 * The PMO API authenticates with its own JWT: POST /api/auth/login with a
 * service account returns `{ token }`. Endpoints used:
 *   GET /api/workforce/timesheets?days=N → { rows: PmoTimesheetRow[], totals }
 *     (TimeEntry joined to Task → Project and User; newest first, max 500 rows)
 *   GET /api/users                       → [{ id, email, name, isActive }]
 *   GET /api/projects?archived=include   → [{ id, code, name, status, archivedAt }]
 */

export interface PmoConfig {
  baseUrl: string;
  email: string;
  password: string;
  /** Rolling window pulled on each sync. */
  days: number;
  timeoutMs: number;
}

export interface PmoTimesheetRow {
  id: number;
  userId: number;
  resourceName: string;
  projectCode: string | null;
  projectName: string | null;
  taskTitle: string | null;
  discipline: string | null;
  activity: string;
  hours: number;
  date: string;
  billable: boolean;
}

export interface PmoUser {
  id: number;
  email: string;
  name: string | null;
  isActive?: boolean;
}

export interface PmoProjectRow {
  id: number;
  code: string | null;
  name: string;
  status: string | null;
  archivedAt?: string | null;
}

/** PMO caps /workforce/timesheets at this many rows (prisma `take: 500`). */
export const PMO_TIMESHEET_ROW_CAP = 500;

export function pmoConfigFromEnv(env: NodeJS.ProcessEnv = process.env): PmoConfig | null {
  const baseUrl = env.PMO_API_URL?.trim();
  const email = env.PMO_SERVICE_EMAIL?.trim();
  const password = env.PMO_SERVICE_PASSWORD;
  if (!baseUrl || !email || !password) return null;
  const days = Number(env.PMO_SYNC_DAYS ?? 35);
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    email,
    password,
    days: Number.isFinite(days) ? Math.min(Math.max(Math.round(days), 1), 365) : 35,
    timeoutMs: 20_000,
  };
}

export class PmoApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class PmoClient {
  private token: string | null = null;

  constructor(private readonly config: PmoConfig, private readonly fetcher: FetchLike = fetch) {}

  get baseUrl() {
    return this.config.baseUrl;
  }

  private async call<T>(path: string, init: RequestInit = {}, authenticated = true): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string>) };
    if (init.body) headers['Content-Type'] = 'application/json';
    if (authenticated) headers.Authorization = `Bearer ${await this.login()}`;
    let response: Response;
    try {
      response = await this.fetcher(`${this.config.baseUrl}${path}`, { ...init, headers, signal: AbortSignal.timeout(this.config.timeoutMs) });
    } catch (error) {
      throw new PmoApiError(`PMO is unreachable at ${this.config.baseUrl}: ${error instanceof Error ? error.message : 'network error'}`);
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new PmoApiError(`PMO ${init.method ?? 'GET'} ${path} failed (${response.status})${body?.error ? `: ${body.error}` : ''}`, response.status);
    }
    return (await response.json()) as T;
  }

  async login(): Promise<string> {
    if (this.token) return this.token;
    const body = await this.call<{ token?: string }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: this.config.email, password: this.config.password }),
    }, false);
    if (!body.token) throw new PmoApiError('PMO login returned no token');
    this.token = body.token;
    return body.token;
  }

  async timesheets(days = this.config.days): Promise<PmoTimesheetRow[]> {
    const body = await this.call<{ rows?: PmoTimesheetRow[] }>(`/api/workforce/timesheets?days=${days}`);
    if (!Array.isArray(body.rows)) throw new PmoApiError('Unexpected PMO timesheet response');
    return body.rows;
  }

  async users(): Promise<PmoUser[]> {
    const body = await this.call<PmoUser[]>('/api/users');
    if (!Array.isArray(body)) throw new PmoApiError('Unexpected PMO users response');
    return body;
  }

  async projects(): Promise<PmoProjectRow[]> {
    const body = await this.call<PmoProjectRow[]>('/api/projects?archived=include');
    if (!Array.isArray(body)) throw new PmoApiError('Unexpected PMO projects response');
    return body;
  }
}
