# Company Calendar — standalone release

Implemented within the existing OCTA business application at `/company-calendar` (sidebar: Company Calendar / Unternehmenskalender). The local database has the additive tables and module permissions installed; the local API feature flag is enabled. No demo calendar entries or external invitations were created.

## Available

- Executive Horizon with a 7/30/90-day lens, explainable attention, overdue/awaiting/missing-owner counts and agenda.
- Day/work-week/week/month/year calendar, quarter-based Business Timeline and paginated obligations/commitments register.
- Create/edit/assign/share, distinct hard deadline/internal target/forecast, timed appointments and all-day ranges, checklist, HTTPS evidence, guarded completion and history.
- Company isolation, module and sensitive-domain permissions, explicit private sharing, optimistic versions and transactional history.
- Date-only daily/weekly/monthly/yearly recurrence, original anchors, exclusive end dates and one next occurrence per successful completion.
- Validated non-destructive links to real contracts, invoices, opportunities, partners and employees. Searchable authorized record selection; source modules keep their own authority.
- DE/EN, existing light/dark tokens, native modal keyboard focus containment and mobile layouts. Personal filters persist in URL and browser storage scoped by user/company.

## Scope remaining

This is the prioritized standalone slice from Phases 0–2, not completion of the entire master specification. Phase 0 is complete; Phases 1–2 are delivered with the explicit deviations below. Phases 3–6 remain future work.

No Outlook/Graph synchronization, OAuth calendar consent, Teams invitation/notifications/tab, AI brief/extraction/inbox, statutory rule library, dependency graph, automatic module-date projections, automatic reminders/escalations, holiday adjustment, full RRULE or background recurrence materialization is implemented. Those integrations visibly report unconnected. Timed recurring appointments are intentionally refused. Dragging deadlines is unavailable; edits are explicit and audited. Personal views are browser-local; shared team views are deferred. Calendar details use accessible native modals instead of a drawer; Tailwind replaces the specification's MUI assumption to preserve the real app stack.

Horizon attention evaluates at most 1,000 authorized active items and explicitly discloses truncation. Calendar/timeline show a page of 100 records with visible pagination. Detailed history is limited to current owner/creator because previous snapshots can contain private information.

## Setup and validation

See [operations-runbook.md](operations-runbook.md) and [acceptance-tests.md](acceptance-tests.md). Feature flag defaults off in `.env.example`; every data endpoint enforces it server-side. Disabling preserves all stored calendar history.

Architecture: [architecture.md](architecture.md). API: [api.md](api.md). Model: [data-model.md](data-model.md). Security: [security-privacy.md](security-privacy.md).
