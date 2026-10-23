import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CompanyRef {
  id: string;
  code: string;
  name: string;
}

export interface MfaSummary {
  enrolled: boolean;
  enrolledAt?: string | null;
  lastUsedAt?: string | null;
  recoveryCodesRemaining: number;
  pendingEnrollment?: boolean;
  required: boolean;
  enrollmentDue?: string | null;
}

export interface Me {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  displayName?: string | null;
  isSystemAdmin: boolean;
  permissions?: string[];
  memberships: { isDefault: boolean; company: CompanyRef }[];
  mfa?: MfaSummary;
}

/** Position in the server-side sign-in state machine (GET /auth/state). */
export type AuthStatus = 'UNKNOWN' | 'ANONYMOUS' | 'MFA_PENDING' | 'MFA_ENROLLMENT_REQUIRED' | 'AUTHENTICATED';

/** UI-side permission check; the API re-checks on every request. */
export function hasPermission(me: Me | null, code: string): boolean {
  if (!me) return false;
  if (me.isSystemAdmin || me.permissions?.includes('*')) return true;
  return me.permissions?.includes(code) ?? false;
}

export interface LoginResult {
  status: Exclude<AuthStatus, 'UNKNOWN' | 'ANONYMOUS'>;
  csrfToken: string;
  enrollmentDue?: string | null;
}

interface AuthState {
  status: AuthStatus;
  /** CSRF synchronizer token — memory only, re-fetched from /auth/state after reload */
  csrfToken: string | null;
  companyId: string | null;
  me: Me | null;
  challengeExpiresAt: string | null;
  signedOutReason: string | null;
  refreshState: () => Promise<AuthStatus>;
  login: (email: string, password: string) => Promise<LoginResult>;
  applyResult: (result: { status: AuthStatus; csrfToken?: string }) => void;
  loadMe: () => Promise<void>;
  setCsrf: (token: string) => void;
  setCompany: (companyId: string) => void;
  logout: () => Promise<void>;
  /** Called by the API client on 401: drop all in-memory identity, never retry. */
  markSignedOut: (reason?: string) => void;
}

// Cross-tab coordination: a logout or sign-in in one tab updates the others.
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('octa-bms-auth') : null;

async function json<T>(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; body: T }> {
  const res = await fetch(`/api/v1${path}`, { credentials: 'same-origin', ...init });
  const body = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, body };
}

export class AuthRequestError extends Error {
  constructor(public status: number, public body: { code?: string; message?: string; retryAfterSeconds?: number; attemptsRemaining?: number }) {
    super(body?.message ?? 'Request failed');
  }
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'UNKNOWN',
      csrfToken: null,
      companyId: null,
      me: null,
      challengeExpiresAt: null,
      signedOutReason: null,

      async refreshState() {
        const { body } = await json<{ state: AuthStatus; csrfToken?: string; expiresAt?: string }>('/auth/state');
        const status = body.state ?? 'ANONYMOUS';
        set({ status, csrfToken: body.csrfToken ?? null, challengeExpiresAt: body.expiresAt ?? null, ...(status === 'AUTHENTICATED' ? {} : { me: null }) });
        return status;
      },

      async login(email, password) {
        const res = await json<LoginResult & { code?: string; message?: string }>('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        if (!res.ok) throw new AuthRequestError(res.status, res.body);
        get().applyResult(res.body);
        return res.body;
      },

      applyResult(result) {
        set({ status: result.status, csrfToken: result.csrfToken ?? null, signedOutReason: null });
        if (result.status === 'AUTHENTICATED') channel?.postMessage({ type: 'signed-in' });
      },

      async loadMe() {
        if (get().status !== 'AUTHENTICATED') return;
        const res = await json<Me>('/auth/me');
        if (!res.ok) {
          if (res.status === 401) get().markSignedOut((res.body as { code?: string }).code);
          return;
        }
        const me = res.body;
        const defaultCompany = me.memberships.find((m) => m.isDefault)?.company ?? me.memberships[0]?.company;
        set((state) => ({
          me,
          companyId: me.memberships.some((membership) => membership.company.id === state.companyId)
            ? state.companyId : defaultCompany?.id ?? null,
        }));
      },

      setCsrf(token) {
        set({ csrfToken: token });
      },

      setCompany(companyId) {
        set({ companyId });
      },

      async logout() {
        const { csrfToken } = get();
        await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) },
        }).catch(() => undefined);
        get().markSignedOut();
        channel?.postMessage({ type: 'signed-out' });
      },

      markSignedOut(reason) {
        set({ status: 'ANONYMOUS', csrfToken: null, me: null, challengeExpiresAt: null, signedOutReason: reason ?? null });
      },
    }),
    {
      name: 'octa-bms-auth',
      version: 2,
      // only the selected company survives reloads; credentials live in HttpOnly cookies
      partialize: (s) => ({ companyId: s.companyId }),
      // v1 stored access/refresh tokens in localStorage — drop them on upgrade
      migrate: (persisted) => ({ companyId: (persisted as { companyId?: string | null } | undefined)?.companyId ?? null }),
    },
  ),
);

channel?.addEventListener('message', (event: MessageEvent<{ type: string }>) => {
  if (event.data?.type === 'signed-out') useAuthStore.getState().markSignedOut('SIGNED_OUT_ELSEWHERE');
  if (event.data?.type === 'signed-in') void useAuthStore.getState().refreshState();
});

/** Allow-listed post-login redirect: internal, relative, not an auth page (prevents open redirects). */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next)) return '/';
  if (/^\/(login|auth\/|forgot-password|reset-password|invite|oidc)/.test(next)) return '/';
  return next;
}
