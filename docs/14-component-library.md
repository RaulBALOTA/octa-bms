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

## Composition rule

Features never style raw HTML for shared patterns — if a pattern appears twice, it becomes a
`data/` component. Storybook + Chromatic visual regression gate changes to both tiers.
