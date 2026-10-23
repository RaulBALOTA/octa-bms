import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  ChevronDown,
  Languages,
  LogOut,
  Menu,
  Moon,
  Search,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';
import { AiPanel } from '../components/ai';
import { setLanguage } from '../i18n';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { NAV_ITEMS } from './nav';
import { MODULE_ARCHIVES, relatedModuleRecords } from './module-records';
import { ArchivedRecordsButton, ModuleRelatedRecords } from '../components/ModuleRecords';

interface SearchGroup {
  type: string;
  hits: { type: string; id: string; title: string; subtitle?: string | null; link: string }[];
}

interface Notification {
  id: string;
  title: string;
  body?: string | null;
  isRead: boolean;
  link?: string | null;
  createdAt: string;
}

export function Layout() {
  const location = useLocation();
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { me, companyId, setCompany, logout, loadMe } = useAuthStore();
  const needsCompany = !!me?.isSystemAdmin && me.memberships.length === 0 && !['/group','/group/compare','/admin','/admin/security','/security'].includes(location.pathname);
  const { theme, setTheme, sidebarCollapsed, toggleSidebar } = useUiStore();
  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void queryClient.invalidateQueries(); }, [companyId, queryClient]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [bellOpen, setBellOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ctrl+K / Cmd+K opens global search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setBellOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  const { data: searchResults } = useQuery({
    queryKey: ['global-search', searchTerm],
    queryFn: () =>
      api.get<{ groups: SearchGroup[] }>(
        `/search?q=${encodeURIComponent(searchTerm)}`,
      ),
    enabled: searchOpen && searchTerm.trim().length >= 2,
    staleTime: 10_000,
  });

  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  const { data: notifications } = useQuery({
    queryKey: ['notifications', 'list'],
    queryFn: () => api.get<Notification[]>('/notifications'),
    enabled: bellOpen,
  });

  return (
    <div className="flex h-screen overflow-hidden">
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex flex-col border-r border-border bg-card transition-all',
          sidebarCollapsed ? 'w-14' : 'w-56',
        )}
      >
        <div className="flex h-12 items-center gap-2 border-b border-border px-3">
          <button
            onClick={toggleSidebar}
            className="rounded p-1.5 hover:bg-muted"
            aria-label="Toggle sidebar"
          >
            <Menu size={16} />
          </button>
          {!sidebarCollapsed && (
            <span className="text-sm font-semibold">{t('app.name')}</span>
          )}
        </div>
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2">
          {NAV_ITEMS.filter((item) => item.key !== 'data' || me?.isSystemAdmin).map((item) => (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) =>
                clsx(
                  'flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm',
                  isActive
                    ? 'bg-accent font-medium text-primary'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  !item.implemented && 'opacity-50',
                )
              }
              title={t(`nav.${item.key}`)}
            >
              <item.icon size={16} className="shrink-0" />
              {!sidebarCollapsed && <span>{t(`nav.${item.key}`)}</span>}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex w-72 items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <Search size={14} />
            <span className="flex-1 text-left">{t('common.search')}</span>
            <kbd className="rounded border border-border px-1 text-[10px]">
              Ctrl K
            </kbd>
          </button>

          <div className="flex-1" />

          {/* Company switcher */}
          {me && me.memberships.length > 0 && (
            <div className="relative">
              <select
                value={companyId ?? ''}
                onChange={(e) => {
                  setCompany(e.target.value);
                  void queryClient.invalidateQueries();
                }}
                className="appearance-none rounded-md border border-border bg-background py-1.5 pl-3 pr-8 text-sm"
              >
                {me.memberships.map((m) => (
                  <option key={m.company.id} value={m.company.id}>
                    {m.company.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
            </div>
          )}

          {/* AI assistant */}
          <button
            onClick={() => setAiOpen(true)}
            className="rounded p-1.5 text-primary hover:bg-muted"
            title={t('ai.title')}
          >
            <Sparkles size={16} />
          </button>

          {/* Language */}
          <button
            onClick={() => setLanguage(i18n.language === 'de' ? 'en' : 'de')}
            className="flex items-center gap-1 rounded p-1.5 text-sm hover:bg-muted"
            title={t('common.language')}
          >
            <Languages size={16} />
            <span className="text-xs font-medium uppercase">{i18n.language}</span>
          </button>

          {/* Theme */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="rounded p-1.5 hover:bg-muted"
            title={t('common.darkMode')}
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Notifications */}
          <div className="relative">
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative rounded p-1.5 hover:bg-muted"
              title={t('common.notifications')}
            >
              <Bell size={16} />
              {(unread?.count ?? 0) > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {unread!.count}
                </span>
              )}
            </button>
            {bellOpen && (
              <div className="absolute right-0 top-9 z-50 w-96 rounded-lg border border-border bg-card shadow-xl">
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <span className="text-sm font-semibold">
                    {t('common.notifications')}
                  </span>
                  <button
                    className="text-xs text-primary hover:underline"
                    onClick={async () => {
                      await api.post('/notifications/read-all');
                      void queryClient.invalidateQueries({
                        queryKey: ['notifications'],
                      });
                    }}
                  >
                    {t('common.markAllRead')}
                  </button>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {notifications?.length ? (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        className={clsx(
                          'block w-full border-b border-border px-3 py-2 text-left text-sm hover:bg-muted',
                          !n.isRead && 'bg-accent/50',
                        )}
                        onClick={async () => {
                          await api.post(`/notifications/${n.id}/read`);
                          void queryClient.invalidateQueries({
                            queryKey: ['notifications'],
                          });
                          setBellOpen(false);
                          if (n.link) navigate(n.link);
                        }}
                      >
                        <div className="font-medium">{n.title}</div>
                        {n.body && (
                          <div className="text-xs text-muted-foreground">
                            {n.body}
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <div className="px-3 py-6 text-center text-sm text-muted-foreground">
                      {t('common.noNotifications')}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* User */}
          <div className="flex items-center gap-2">
            <Link
              to="/security"
              className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
              title={t('nav.security')}
              aria-label={t('nav.security')}
            >
              {me?.firstName?.[0]}
              {me?.lastName?.[0]}
            </Link>
            <button
              onClick={() => {
                void logout().then(() => navigate('/login'));
              }}
              className="rounded p-1.5 hover:bg-muted"
              title={t('auth.logout')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto p-5">
          {!me ? <p className="p-8 text-center text-muted-foreground">{t('common.loading')}</p> : needsCompany ? <section className="mx-auto mt-12 max-w-xl rounded-xl border border-border bg-card p-8 text-center">
            <h1 className="text-lg font-bold">{t('data.emptyWorkspace')}</h1>
            <p className="mt-2 text-sm text-muted-foreground">{t('data.createOwnCompany')}</p>
            <Link to="/group" className="mt-5 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">{t('data.setupCompany')}</Link>
          </section> : <>
            {me?.isSystemAdmin && MODULE_ARCHIVES[location.pathname] && <div className="mb-2 flex flex-wrap justify-end gap-2">{MODULE_ARCHIVES[location.pathname].map((resource) => <ArchivedRecordsButton key={resource} resource={resource} named />)}</div>}
            <Outlet />
            {relatedModuleRecords(location.pathname).length > 0 && <ModuleRelatedRecords key={location.pathname} resources={relatedModuleRecords(location.pathname)} />}
          </>}
        </main>
      </div>

      <AiPanel open={aiOpen} onClose={() => setAiOpen(false)} />

      {/* Global search overlay */}
      {searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 pt-24"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="w-full max-w-xl rounded-xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <Search size={16} className="text-muted-foreground" />
              <input
                ref={searchInputRef}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={t('common.search')}
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>
            <div className="max-h-96 overflow-y-auto p-2">
              {searchResults?.groups.length ? (
                searchResults.groups.map((group) => (
                  <div key={group.type} className="mb-2">
                    <div className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.type}
                    </div>
                    {group.hits.map((hit) => (
                      <Link
                        key={hit.id}
                        to={hit.link}
                        onClick={() => setSearchOpen(false)}
                        className="flex items-baseline gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
                      >
                        <span className="font-medium">{hit.title}</span>
                        {hit.subtitle && (
                          <span className="text-xs text-muted-foreground">
                            {hit.subtitle}
                          </span>
                        )}
                      </Link>
                    ))}
                  </div>
                ))
              ) : (
                <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                  {searchTerm.trim().length >= 2
                    ? t('common.noResults')
                    : t('common.searchShort')}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
