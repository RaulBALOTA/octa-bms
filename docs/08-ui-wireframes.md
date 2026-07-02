# 08 — UI Wireframes

Low-fi wireframes for the key screens. Visual language: Linear/Notion cleanliness with
Dynamics information density. 8px grid, Inter font, 1px hairline borders.

## 1. Executive Dashboard (home for management role)

```
┌────┬────────────────────────────────────────────────────────────────────┐
│ ≡  │ 🔍 Search everything (Ctrl+K)      [OCTA GmbH ▾]  [+ New]  🔔3  RB │
├────┼────────────────────────────────────────────────────────────────────┤
│⭐Fav│ Executive Dashboard                          [2026 ▾] [⚙ Widgets]  │
│    │ ┌──────────┐┌──────────┐┌──────────┐┌──────────┐┌──────────┐      │
│ 🏠 │ │ Revenue  ││ EBIT     ││ Cash     ││ Backlog  ││ Utiliza- │      │
│ 👥 │ │ 4.2M €   ││ 12.4%    ││ 890k €   ││ 7.1M €   ││ tion 84% │      │
│ 💼 │ │ ▲+8% YoY ││ ▼-0.6pp  ││ 90d ▁▃▅▆ ││ ▲+15%    ││ ▲+2pp    │      │
│ 📄 │ └──────────┘└──────────┘└──────────┘└──────────┘└──────────┘      │
│ 💶 │ ┌───────────────────────────┐┌───────────────────────────────┐    │
│ 🧑 │ │ Revenue vs Budget (bars)  ││ Sales Pipeline (funnel)       │    │
│ ⚖  │ │ ██▁██▁██▁ …               ││ Lead 12 ▸ Qual 8 ▸ Prop 5 ▸ 2 │    │
│ 🛒 │ └───────────────────────────┘└───────────────────────────────┘    │
│ 🖥 │ ┌───────────────────────────┐┌───────────────────────────────┐    │
│ 📚 │ │ Expiring contracts (list) ││ Company goals progress (bars) │    │
│ ⚙  │ └───────────────────────────┘└───────────────────────────────┘    │
└────┴────────────────────────────────────────────────────────────────────┘
```

## 2. Entity List (pattern for every module — here: Clients)

```
┌ CRM ▸ Clients ──────────────────────────────────────────────────────────┐
│ [List|Kanban|Cards|Map]  🔍 filter…  [Status ▾][Segment ▾][Owner ▾][+]  │
│ Saved views: ★ My key accounts · A-clients DE · All        [⤓ Export]  │
├─────────────────────────────────────────────────────────────────────────┤
│ □ │ N°      │ Name              │ City     │ Segment │ Owner │ Revenue │
│ □ │ C-00012 │ Hochtief AG       │ Essen    │ A       │ MK    │ 820k €  │
│ ▣ │ C-00034 │ Bayer AG          │ Leverk.  │ A       │ RB    │ 1.2M €  │◄ selected
│ □ │ C-00087 │ Stadtwerke München│ München  │ B       │ TS    │ 340k €  │
├──────────────────────────────────┬──────────────────────────────────────┤
│ 412 records · grouped by Segment │ SPLIT PANEL: Bayer AG                │
│ ◀ 1 2 3 … ▶                      │ [Overview|Contacts|Activities|Docs]  │
│                                  │ AM: R. Balota · A-Segment · Chemie   │
│                                  │ ⏱ Timeline: call 28.06, visit 12.06 │
└──────────────────────────────────┴──────────────────────────────────────┘
```

## 3. Record Detail (pattern — here: Contract)

```
┌ Contracts ▸ CT-2026-0018 ✕ │ CT-2026-0021 ✕ │ + ─────────────────────────┐
│ ⬤ ACTIVE  Rahmenvertrag TGA-Planung — Bayer AG          [Actions ▾][✎]  │
│ Value 450.000 € · 01.02.2026 → 31.01.2028 · Owner: R. Balota · ⚠ 90d    │
├─[Overview]─[Obligations 4]─[Milestones]─[VOs 2]─[Claims]─[Versions]─────│
│ ┌ Key data ───────────────┐ ┌ Payment milestones ─────────────────────┐ │
│ │ Type   Rahmenvertrag    │ │ ▸ 30% Advance      135k €   ✓ invoiced  │ │
│ │ Notice 6 months         │ │ ▸ 40% Design frozen 180k €  ◷ open      │ │
│ │ Renewal auto +12m       │ │ ▸ 30% Final         135k €  ◷ open      │ │
│ └─────────────────────────┘ └─────────────────────────────────────────┘ │
│ ┌ Activity ──────────────────────────┐ ┌ Sidebar ──────────────────────┐│
│ │ ● RB changed status → ACTIVE 01.02 │ │ 🏷 Tags: TGA, Frame           ││
│ │ ● Workflow approved (CFO) 28.01    │ │ 📎 Attachments (3)            ││
│ │ ● v2 uploaded by MK 25.01          │ │ ☑ Tasks (1 open)              ││
│ │ 💬 Comment: "AGB geprüft" — Legal  │ │ 🤖 AI: Summarize contract     ││
│ └────────────────────────────────────┘ └───────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

## 4. Sales Pipeline Kanban

```
┌ Sales ▸ Pipeline ──────────────── Σ weighted: 2.34M € ── [List|Kanban] ──┐
│ LEAD 12·480k   QUALIFIED 8·920k   PROPOSAL 5·1.4M   NEGOTIATION 2·600k  │
│ ┌───────────┐  ┌───────────┐      ┌───────────┐     ┌───────────┐       │
│ │ Chemiepark│  │ Klinikum  │      │ ⚠ Due 3d  │     │ Netz Süd  │       │
│ │ Revamp    │  │ Neubau HLS│      │ Wasserstoff│    │ 380k · 75%│       │
│ │ 120k · 10%│  │ 340k · 40%│      │ 800k · 60%│     └───────────┘       │
│ └───────────┘  └───────────┘      └───────────┘  (drag → stage change   │
│  + Add        (cards: value·%·owner avatar·due badge)  with guard rails)│
└──────────────────────────────────────────────────────────────────────────┘
```

## 5. Approvals Inbox (workflow)

```
┌ My Approvals (6) ────────────────────────────────────────────────────────┐
│ [All][Invoices 3][Purchases 2][Leave 1]           sort: due date ▲      │
│ ┌──────────────────────────────────────────────────────────────────────┐│
│ │ 💶 Incoming invoice ER-2026-0231 · IT-Haus GmbH · 4.820,00 €         ││
│ │    Cost center: IT-100 · due in 2d · requested by S. Weber           ││
│ │    [👁 Preview PDF]                        [✓ Approve] [✗ Reject]    ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ 🌴 Leave request · M. Kraus · 14.–25.09. (9d) · balance ok           ││
│ │                                            [✓ Approve] [✗ Reject]    ││
│ └──────────────────────────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

## 6. Global Search overlay (⌘K)

```
┌──────────────────────────────────────────────┐
│ 🔍 bayer rahmen                              │
├──────────────────────────────────────────────┤
│ CLIENTS      🏢 Bayer AG — Leverkusen        │
│ CONTRACTS    📄 CT-2026-0018 Rahmenvertrag…  │
│ CONTACTS     👤 Dr. Weber, Bayer AG          │
│ INVOICES     💶 AR-2026-0102 Bayer AG 45k €  │
│ DOCUMENTS    📎 Rahmenvertrag_signed_v2.pdf  │
├──────────────────────────────────────────────┤
│ ACTIONS      + New opportunity for "Bayer"   │
│              🤖 Ask AI: "bayer rahmen…"      │
└──────────────────────────────────────────────┘
```

## 7. Employee 360° (HR)

```
┌ HR ▸ Employees ▸ Maria Kraus ────────────────────────────────────────────┐
│ 🧑 Maria Kraus · Senior Structural Engineer · München · since 2019       │
│ [Profile][Contract][Skills][Certificates ⚠1][Leave][Trips][Equipment][Docs]
│ Skills matrix:  Statik ●●●●● · Revit ●●●●○ · EN ●●●○○ · Python ●●○○○    │
│ Leave 2026: ████████░░ 18/30 taken · 2 pending                          │
│ Certificates: SiGeKo (⚠ expires 15.08.2026) · Schweißfaching. ✓         │
│ Equipment: 💻 NB-0142 ThinkPad · 📱 PH-0088 iPhone · 🚗 pool access      │
└──────────────────────────────────────────────────────────────────────────┘
```

Common patterns across all screens: toolbar (view switcher, filters, saved views, export),
right sidebar rail (tags/attachments/tasks/AI), activity timeline bottom-left, breadcrumbs +
record tabs on top, context menus on every row (open/open in split/favorite/copy link/…).
