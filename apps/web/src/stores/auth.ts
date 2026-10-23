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
  accessToken: string | null;
  refreshToken: string | null;
  companyId: string | null;
  me: Me | null;
  login: (email: string, password: string) => Promise<void>;
  loadMe: () => Promise<void>;
  tryRefresh: () => Promise<boolean>;
  setCompany: (companyId: string) => void;
  logout: () => void;
}

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
          body: JSON.stringify({ email, password }),
        });
        if (!res.ok) throw new Error('Login failed');
        const tokens = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
        };
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
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

      async tryRefresh() {
        const { refreshToken } = get();
        if (!refreshToken) return false;
        const res = await fetch('/api/v1/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return false;
        const tokens = (await res.json()) as {
          accessToken: string;
          refreshToken: string;
        };
        set({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
        return true;
      },

      setCompany(companyId) {
        set({ companyId });
      },

      logout() {
        set({ accessToken: null, refreshToken: null, me: null, companyId: null });
      },
    }),
    {
      name: 'octa-bms-auth',
      partialize: (s) => ({
        accessToken: s.accessToken,
        refreshToken: s.refreshToken,
        companyId: s.companyId,
      }),
    },
  ),
);
