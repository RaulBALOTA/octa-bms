# 14 — Component Library

Two tiers in `apps/web/src/components`: `ui/` (design-system primitives, shadcn-style,
Radix-based) and `data/` (enterprise composites). Storybook documents both.

## Design Tokens

```css
:root { --background --foreground --card --primary --primary-foreground
        --secondary --muted --accent --destructive --success --warning
        --border --input --ring --radius(6px)
        --sidebar-bg --topbar-h(48px) --sidebar-w(240px) }
.dark { …inverted set, AA-checked }
```
Typography: Inter; 13px base (enterprise density), 4/8px spacing grid.
Status colors are semantic tokens (`--status-active`, `--status-draft`, …) mapped per theme.

## Tier 1 — `ui/` primitives

Button (variants: default/secondary/outline/ghost/destructive; sizes sm/md/lg/icon) ·
Input, Textarea, Select, Combobox (async search), MultiSelect, DatePicker, DateRangePicker,
NumberInput (locale-aware), CurrencyInput, Checkbox, Switch, RadioGroup, Slider ·
Dialog, Sheet (side panel), Popover, Tooltip, DropdownMenu, ContextMenu, Command (palette) ·
Tabs, Accordion, Breadcrumbs, Pagination · Badge, StatusBadge, Avatar, AvatarGroup, Tag ·
Card, Separator, Skeleton, Spinner, Progress, EmptyState, ErrorState · Toast/Sonner ·
Form primitives (FormField wrapper binding RHF + zod + error i18n).

## Tier 2 — `data/` enterprise composites

| Component | Purpose |
|---|---|
| **DataTable** | TanStack Table: server pagination/sort, column resize/reorder/pin/hide, row selection, inline edit, grouping, aggregation footer, virtualization, sticky header, export hook, density toggle |
| **EntityPage** | the module workhorse: toolbar (view switcher, FilterBar, saved views, export/import/print, bulk actions) + view renderers |
| **FilterBar** | typed filter chips from a zod filter schema; operators per field type; URL-serialized |
| **KanbanBoard** | dnd-kit columns from status enum; WIP guards; card renderer prop; column aggregates |
| **CalendarView** | month/week/agenda; entity → event adapter |
| **TimelineView** | horizontal time axis (contracts, trips, leave) |
| **MapView** | MapLibre GL + clustering (partners, offices) |
| **SplitView** | resizable list+detail panels, persisted sizes |
| **RecordHeader** | title, status badge, key facts strip, Actions menu, favorite star |
| **RecordTabs** | detail tabs with lazy mount + badge counts |
| **ActivityTimeline** | audit/activity/comment merged feed with filters |
| **CommentThread** | mentions (@user), replies, edit window |
| **AttachmentPanel** | drag&drop upload (pre-signed), previews, versions |
| **TagPicker** | inline tag create/assign |
| **TaskPanel** | linked tasks with quick add |
| **ApprovalCard** | workflow task with approve/reject/delegate + preview |
| **NotificationCenter** | popover, filter chips, SSE live, mark-all |
| **GlobalSearch** | ⌘K overlay: grouped results, recent, actions, Ask-AI row |
| **OrgChart** | d3-hierarchy zoomable tree |
| **KpiTile / StatCard** | value, delta arrow, sparkline (dataviz-compliant) |
| **ChartCard** | Recharts wrapper with theme tokens, export PNG |
| **DashboardGrid** | react-grid-layout dockable/resizable widgets, edit mode |
| **WizardDialog** | multi-step forms (imports, onboarding) |
| **ImportDialog** | CSV/XLSX mapping UI with validation preview |
| **PdfPreview / OfficePreview** | pdf.js; Office via server-rendered PDF |
| **QrLabel** | asset QR code print sheet |
| **AiAssistantPanel** | per-record AI actions (summarize/draft/translate) with streaming |
| **AuditDrawer** | field-level change history viewer |

## Implemented today — tables, pivots & infographics

What ships in `apps/web/src/components` now (dependency-free; Recharts/TanStack Table above
remain the target where noted):

| Component | File | Purpose |
|---|---|---|
| **DataTable** | `DataTable.tsx` | client-side enhanced table: sortable headers, quick filter, column chooser, density toggle (persisted), in-cell magnitude bars, totals footer, CSV export (`;` + BOM for German Excel), sticky actions column, **Table ⇄ Pivot** switch. Server paging plugs in via `footer` + `Pager`. |
| **ListPage** | `ListPage.tsx` | server-paginated module list on top of DataTable; columns may declare `value` / `type` / `bar` / `total` so dates and amounts sort, total and pivot correctly. |
| **PivotTable** | `PivotTable.tsx` + `lib/pivot.ts` | rows × columns × measure with sum/avg/min/max/count, date → month grouping, swap axes, heatmap, % of total, grid or stacked-bar chart mode, CSV export. Picks a sensible grouping field by default (skips ID-like columns). |
| **Charts** | `charts.tsx` | `BarChart`, `AreaChart` (crosshair), `DivergingBarChart` (in/out on one axis), `DonutChart`, `RingGauge`, `SegmentBar`, `Funnel`, `Sparkline`, `HBarList`, `heatStyle`. Responsive, hover tooltips, legends with values. |
| **Infographics** | `infographics.tsx` | `PageHeader`, `Panel`, `KpiTile` (delta, sparkline, meter, link/button), `Meter`, `ViewSwitch`, `Pill`, `DaysLeft`, `EmptyState`. |
| **OpenItemsSummary** | `OpenItemsSummary.tsx` | receivables/payables KPI strip + aging bar from server totals. |

Chart colors are CSS tokens: categorical `--chart-1…8` (fixed order, validated for CVD and
contrast in light and dark), ordinal `--ord-1…5` (e.g. aging buckets) and the sequential
heat ramp `--seq-lo/--seq-hi`. Status colors (`--success/--warning/--destructive`) stay reserved
for state and always ship with a label.

## Composition rule

Features never style raw HTML for shared patterns — if a pattern appears twice, it becomes a
`data/` component. Storybook + Chromatic visual regression gate changes to both tiers.
