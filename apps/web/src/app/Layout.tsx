import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell,
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Languages,
  LogOut,
  Monitor,
  Moon,
  Search,
  Sparkles,
  Sun,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { api } from '../lib/api';
import { AiPanel } from '../components/ai';
import { setLanguage } from '../i18n';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { NAV_GROUPS, NAV_ITEMS, navItemFor } from './nav';
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
  const needsCompany = !!me?.isSystemAdmin && me.memberships.length === 0 && !['/group','/group/compare','/admin'].includes(location.pathname);
  const { theme, setTheme, sidebarCollapsed: collapsedPref, toggleSidebar } = useUiStore();
  // narrow windows always get the icon rail so content keeps its room
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1023px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)');
    const onChange = (e: MediaQueryListEvent) => setNarrow(e.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  const sidebarCollapsed = collapsedPref || narrow;
  useEffect(() => { void loadMe(); }, [loadMe]);
  useEffect(() => { void queryClient.invalidateQueries(); }, [companyId, queryClient]);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [bellOpen, setBellOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const bellRef = useRef<HTMLDivElement>(null);
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
        setUserOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (searchOpen) searchInputRef.current?.focus();
  }, [searchOpen]);

  // close header popovers on outside click
  useEffect(() => {
    if (!userOpen && !bellOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (userOpen && !userMenuRef.current?.contains(target)) setUserOpen(false);
      if (bellOpen && !bellRef.current?.contains(target)) setBellOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [userOpen, bellOpen]);

  const activeItem = navItemFor(location.pathname);
  const visibleItems = NAV_ITEMS.filter((item) => item.key !== 'data' || me?.isSystemAdmin);
  const fullName = [me?.firstName, me?.lastName].filter(Boolean).join(' ');
  const activeCompany = me?.memberships.find((m) => m.company.id === companyId)?.company.name;
  const ThemeIcon = theme === 'dark' ? Moon : theme === 'light' ? Sun : Monitor;
  const nextTheme = theme === 'light' ? 'dark' : theme === 'dark' ? 'system' : 'light';

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
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={clsx(
          'flex shrink-0 flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200',
          sidebarCollapsed ? 'w-[60px]' : 'w-60',
        )}
      >
        <div className="flex h-14 items-center gap-2.5 px-3.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[#3987e5] to-[#6250d6] text-sm font-black text-white shadow-lg shadow-black/20">
            O
          </span>
          {!sidebarCollapsed && (
            <div className="min-w-0 leading-tight">
              <div className="text-sm font-bold tracking-tight text-white">{t('app.name')}</div>
              {activeCompany && (
                <div className="truncate text-[11px] text-sidebar-foreground/80">{activeCompany}</div>
              )}
            </div>
          )}
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-3">
          {NAV_GROUPS.map((group) => {
            const items = visibleItems.filter((item) => item.group === group);
            if (!items.length) return null;
            return (
              <div key={group} className="mt-3 first:mt-1">
                {sidebarCollapsed ? (
                  <div className="mx-2 mb-1.5 border-t border-white/5" />
                ) : (
                  <div className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-sidebar-foreground/50">
                    {t(`shell.groups.${group}`)}
                  </div>
                )}
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const active = activeItem?.key === item.key;
                    return (
                      <Link
                        key={item.key}
                        to={item.path}
                        aria-current={active ? 'page' : undefined}
                        className={clsx(
                          'group relative flex items-center gap-3 rounded-md px-2.5 py-[7px] text-[13px] transition-colors',
                          active
                            ? 'bg-white/10 font-medium text-white'
                            : 'hover:bg-white/5 hover:text-white',
                          !item.implemented && 'opacity-50',
                          sidebarCollapsed && 'justify-center',
                        )}
                        title={t(`nav.${item.key}`)}
                      >
                        {active && (
                          <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r bg-[#3987e5]" />
                        )}
                        <item.icon
                          size={16}
                          className={clsx('shrink-0', active ? 'text-[#6da7ec]' : 'opacity-80')}
                        />
                        <span className={clsx(sidebarCollapsed ? 'sr-only' : 'truncate')}>
                          {t(`nav.${item.key}`)}
                        </span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
        <button
          onClick={toggleSidebar}
          className={clsx('m-2 items-center gap-2 rounded-md px-2.5 py-2 text-xs hover:bg-white/5 hover:text-white', narrow ? 'hidden' : 'flex')}
          
          aria-label={sidebarCollapsed ? t('shell.expand') : t('shell.collapse')}
          title={sidebarCollapsed ? t('shell.expand') : t('shell.collapse')}
        >
          {sidebarCollapsed ? <ChevronsRight size={15} className="mx-auto" /> : <><ChevronsLeft size={15} />{t('shell.collapse')}</>}
        </button>
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Topbar */}
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-card/80 px-5 backdrop-blur">
          {activeItem && (
            <div className="hidden min-w-0 items-center gap-1.5 whitespace-nowrap text-sm lg:flex">
              <span className="hidden text-muted-foreground 2xl:inline">{t(`shell.groups.${activeItem.group}`)}</span>
              <ChevronRight size={13} className="hidden text-muted-foreground/60 2xl:inline" />
              <span className="flex items-center gap-1.5 truncate font-semibold">
                <activeItem.icon size={14} className="text-primary" />
                {t(`nav.${activeItem.key}`)}
              </span>
            </div>
          )}
          <button
            onClick={() => setSearchOpen(true)}
            className="ml-2 flex w-72 min-w-0 shrink items-center gap-2 rounded-lg border border-border bg-background px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-primary/40"
          >
            <Search size={14} />
            <span className="flex-1 truncate text-left">{t('common.search')}</span>
            <kbd className="rounded border border-border bg-card px-1.5 text-[10px] font-medium">
              Ctrl K
            </kbd>
          </button>

          <div className="flex-1" />

          {/* Company switcher */}
          {me && me.memberships.length > 0 && (
            <div className="relative">
              <Building2
                size={14}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <select
                value={companyId ?? ''}
                onChange={(e) => {
                  setCompany(e.target.value);
                  void queryClient.invalidateQueries();
                }}
                className="appearance-none rounded-lg border border-border bg-background py-1.5 pl-8 pr-8 text-sm font-medium hover:border-primary/40"
                aria-label={t('shell.company')}
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
            className="inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg bg-gradient-to-r from-primary to-[#6250d6] px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:opacity-90"
            title={t('ai.title')}
          >
            <Sparkles size={14} />
            <span className="hidden xl:inline">{t('ai.title')}</span>
          </button>

          {/* Language */}
          <button
            onClick={() => setLanguage(i18n.language === 'de' ? 'en' : 'de')}
            className="flex items-center gap-1 rounded-md p-1.5 text-sm hover:bg-muted"
            title={t('common.language')}
          >
            <Languages size={16} />
            <span className="text-xs font-medium uppercase">{i18n.language}</span>
          </button>

          {/* Theme */}
          <button
            onClick={() => setTheme(nextTheme)}
            className="rounded-md p-1.5 hover:bg-muted"
            title={`${t('common.darkMode')}: ${t(`shell.theme.${theme}`)}`}
            aria-label={`${t('common.darkMode')}: ${t(`shell.theme.${theme}`)}`}
          >
            <ThemeIcon size={16} />
          </button>

          {/* Notifications */}
          <div className="relative" ref={bellRef}>
            <button
              onClick={() => setBellOpen((o) => !o)}
              className="relative rounded-md p-1.5 hover:bg-muted"
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
              <div className="absolute right-0 top-10 z-50 w-96 rounded-xl border border-border bg-card shadow-2xl">
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
          <div className="relative" ref={userMenuRef}>
            <button
              onClick={() => setUserOpen((o) => !o)}
              className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 hover:bg-muted"
              aria-expanded={userOpen}
              aria-haspopup="menu"
            >
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[#6250d6] text-[11px] font-semibold text-white">
                {me?.firstName?.[0]}
                {me?.lastName?.[0]}
              </span>
              <span className="hidden max-w-32 truncate text-sm font-medium 2xl:inline">{fullName}</span>
              <ChevronDown size={13} className="text-muted-foreground" />
            </button>
            {userOpen && (
              <div role="menu" className="absolute right-0 top-10 z-50 w-60 rounded-xl border border-border bg-card p-1.5 shadow-2xl">
                <div className="px-2.5 py-2">
                  <div className="text-[11px] text-muted-foreground">{t('shell.profile')}</div>
                  <div className="truncate text-sm font-semibold">{fullName}</div>
                  {activeCompany && <div className="truncate text-xs text-muted-foreground">{activeCompany}</div>}
                </div>
                <div className="my-1 border-t border-border" />
                <div className="flex gap-1 px-1.5 py-1">
                  {(['light', 'dark', 'system'] as const).map((option) => {
                    const Icon = option === 'light' ? Sun : option === 'dark' ? Moon : Monitor;
                    return (
                      <button
                        key={option}
                        onClick={() => setTheme(option)}
                        className={clsx(
                          'flex flex-1 flex-col items-center gap-1 rounded-md py-1.5 text-[11px]',
                          theme === option ? 'bg-accent font-medium text-primary' : 'text-muted-foreground hover:bg-muted',
                        )}
                      >
                        <Icon size={14} />
                        {t(`shell.theme.${option}`)}
                      </button>
                    );
                  })}
                </div>
                <div className="my-1 border-t border-border" />
                <button
                  role="menuitem"
                  onClick={() => {
                    logout();
                    navigate('/login');
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm text-destructive hover:bg-destructive/10"
                >
                  <LogOut size={15} />
                  {t('auth.logout')}
                </button>
              </div>
            )}
          </div>
        </header>

        {/* Content */}
        <main className="flex-1 overflow-y-auto bg-background px-6 py-5">
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
