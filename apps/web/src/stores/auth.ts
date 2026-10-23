import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface CompanyRef {
  id: string;
  code: string;
  name: string;
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
}

/** UI-side permission check; the API re-checks on every request. */
export function hasPermission(me: Me | null, code: string): boolean {
  if (!me) return false;
  if (me.isSystemAdmin || me.permissions?.includes('*')) return true;
  return me.permissions?.includes(code) ?? false;
}

interface AuthState {
  /** Short-lived; kept in memory only and restored from the session cookie. */
  accessToken: string | null;
  /**
   * Only set while migrating a session stored by an older build in
   * localStorage; exchanged once for the httpOnly cookie, then dropped.
   */
  refreshToken: string | null;
  companyId: string | null;
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  loadMe: () => Promise<void>;
  tryRefresh: () => Promise<boolean>;
  setCompany: (companyId: string) => void;
  logout: () => void;
}

// One refresh at a time: refresh tokens rotate on use, so parallel requests
// that all hit 401 must share a single refresh instead of racing with the
// same (soon revoked) token.
let refreshInFlight: Promise<boolean> | null = null;

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      companyId: null,
      me: null,

      async login(email, password) {
        const res = await fetch('/api/v1/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) throw new Error('Login failed');
        const { accessToken } = (await res.json()) as { accessToken: string };
        set({ accessToken, refreshToken: null });
        await get().loadMe();
      },

      async loadMe() {
        const { accessToken } = get();
        if (!accessToken) return;
        const res = await fetch('/api/v1/auth/me', {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) return;
        const me = (await res.json()) as Me;
        const defaultCompany =
          me.memberships.find((m) => m.isDefault)?.company ??
          me.memberships[0]?.company;
        set((state) => ({
          me,
          companyId: me.memberships.some((membership) => membership.company.id === state.companyId)
            ? state.companyId : defaultCompany?.id ?? null,
        }));
      },

      tryRefresh() {
        refreshInFlight ??= (async () => {
          // the session cookie is sent automatically; a legacy stored token
          // is sent once so the server can move it into the cookie
          const legacy = get().refreshToken;
          const res = await fetch('/api/v1/auth/refresh', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify(legacy ? { refreshToken: legacy } : {}),
          }).catch(() => null);
          if (!res?.ok) {
            set({ accessToken: null, refreshToken: null });
            return false;
          }
          const { accessToken } = (await res.json()) as { accessToken: string };
          set({ accessToken, refreshToken: null });
          return true;
        })().finally(() => {
          refreshInFlight = null;
        });
        return refreshInFlight;
      },

      setCompany(companyId) {
        set({ companyId });
      },

      logout() {
        const legacy = get().refreshToken;
        // revoke the session server-side (and clear its cookie); local state
        // is cleared either way
        void fetch('/api/v1/auth/logout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(legacy ? { refreshToken: legacy } : {}),
        }).catch(() => undefined);
        set({ accessToken: null, refreshToken: null, me: null, companyId: null });
      },
    }),
    {
      name: 'octa-bms-auth',
      // tokens never touch localStorage; only the selected company persists
      partialize: (s) => ({ companyId: s.companyId }),
      // Sessions saved by older builds still hold tokens: take them into
      // memory (the refresh token is swapped for the cookie on first use).
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<AuthState>;
        return {
          ...current,
          companyId: saved.companyId ?? null,
          accessToken: saved.accessToken ?? null,
          refreshToken: saved.refreshToken ?? null,
        };
      },
    },
  ),
);
