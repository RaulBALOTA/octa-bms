# 07 — Frontend Architecture

React 18 · TypeScript strict · Vite · React Router v6 + TanStack Query · Tailwind CSS ·
Radix primitives (shadcn/ui pattern) · Zustand · i18next · Recharts.
(Scaffold ships React Router; migrating to TanStack Router for typed routes +
URL-serialized filters is a planned Phase-1 refinement.)

## Application Shell

```
┌──┬──────────────────────────────────────────────────────────────┐
│  │ Topbar: ⌘K search · company switcher · +New · 🔔 · avatar    │
│N ├──────────────────────────────────────────────────────────────┤
│a │ Breadcrumbs · Tabs (open records, Dynamics-style)            │
│v ├───────────────────────────────┬──────────────────────────────┤
│  │                               │  Detail side panel           │
│⭐ │   Route outlet                │  (split view, resizable)     │
│  │   (list / kanban / …)         │                              │
└──┴───────────────────────────────┴──────────────────────────────┘
```

- **Sidebar**: collapsible, favorites section on top, module groups from a data-driven nav
  tree filtered by permissions (doc 09). Persisted width/collapsed state.
- **Command palette (⌘K / Ctrl+K)**: global search (server) + navigation + quick actions
  ("New Invoice", "Go to Settings") — the primary power-user surface.
- **Tabs**: opened records appear as tabs above content (closable, pinnable) so users work
  Dynamics-style across records.
- **Split view**: list keeps context; row click opens record in resizable right panel;
  expand to full page. Implemented with `react-resizable-panels`.
- **Notification center**: bell → popover with filter chips (Unread/Approvals/Expiring/…),
  live via SSE.

## State Model

| Concern | Tool | Notes |
|---|---|---|
| Server data | TanStack Query | query keys `[entity, 'list', filters]` / `[entity, id]`; optimistic updates on mutations; SSE-driven invalidation |
| Auth session | Zustand `authStore` | tokens in memory + silent refresh; active company id |
| UI prefs | Zustand persisted | theme, sidebar, density, language |
| Notifications | Zustand + SSE | unread badge |
| Forms | react-hook-form + zod | zod schemas shared with API DTO shapes |
| URL | TanStack Router search params | filters/sort/view serialized to URL → shareable saved views |

## Feature Module Pattern

Every entity gets the same file set (generator-scaffolded):

```
features/contracts/
├── routes.tsx            # lazy-loaded route definitions
├── api.ts                # typed endpoints from generated client
├── queries.ts            # useContracts(), useContract(id), mutations
├── components/
│   ├── ContractListPage.tsx    # EntityPage wrapper: toolbar + views
│   ├── ContractDetail.tsx      # header, tabs (Overview, Obligations, …)
│   ├── ContractForm.tsx
│   └── ContractKanban.tsx      # status columns
└── i18n handled via de.json/en.json namespaces ("contracts.*")
```

`EntityPage` is the workhorse shared component: view switcher
(List/Kanban/Calendar/Timeline/Map), FilterBar (typed filter chips), grouping, saved views,
export (CSV/XLSX via API), import dialog, print stylesheet, bulk actions. Individual
features only supply column defs, card renderers and filter schemas.

## Theming & Design Tokens

Tailwind + CSS custom properties (`--background`, `--primary`, …) with `.dark` class scope;
`system` preference watcher. Density modes (comfortable/compact) as a root class. All colors
pass WCAG AA in both themes.

## i18n

i18next with `de` (default) and `en`; ICU plurals; `Intl.NumberFormat`/`DateTimeFormat`
per locale (1.234,56 € vs €1,234.56); backend sends `nameDe`/`name` pairs for reference data.
Language toggle in user menu, persisted to profile.

## Responsiveness

Desktop-first (enterprise data density) but fully responsive: sidebar → drawer under `lg`,
tables → card lists under `md`, split view → navigation push on mobile, touch-friendly 44px
targets. PWA manifest for installable mobile experience.

## Keyboard Shortcuts

`⌘K` palette · `g then c` go to CRM (Linear-style sequences) · `n` new record in context ·
`e` edit · `⌘S` save · `esc` close panel · `?` shortcut overlay. Central
`useShortcuts` registry so features declare their keys.

## Performance

Route-level code splitting (one chunk per feature), virtualized tables
(`@tanstack/react-virtual`) for 10k+ rows, `staleTime` tuning per entity volatility,
prefetch on row hover, memoized heavy charts, bundle budget < 300 kB gz initial.
