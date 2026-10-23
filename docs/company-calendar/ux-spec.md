# UX implementation

Navigation: business workspace sidebar → Company Calendar → Executive Horizon / Calendar / Business Timeline / Obligations & Commitments / Integrations & Settings.

Horizon prioritizes explainable attention over chronology; agenda supplements it. Type is always shape + text (circle appointment, triangle hard deadline, square obligation, diamond business milestone, flag decision, hollow diamond forecast, follow-up arrow). Severity is separate from category; overdue has a visible label. Recurrence shows a loop. No fabricated events or inferred financial exposure.

Calendar starts with Monday and supports day, five-day work-week, week, 42-cell month and year overview. Month/week scroll horizontally on narrow screens; Horizon/register creation and details remain responsive. Timeline uses business-domain lanes and quarter bands. Filters/search/view/date selection persist in URL, including deep-linked item details. Saved personal filters exclude the selected item and persist under a user/company-specific browser key.

Quick-create and detail/edit use native dialog with inert background, focus containment, Escape closure and explicit close control. Forms have labels, limits and server errors. Editor focuses title on opening. Checklist updates temporarily reflect the pending action and roll back on failure. Detail tabs include overview, preparation/evidence, people/permissions, source/sync and history. Completion refuses incomplete checklists/missing mandatory evidence and never shifts the hard deadline.

Strings are in separate calendar.de.json/calendar.en.json resources merged into existing i18next. Styling reuses Tailwind design tokens; no MUI dependency. No animated modal or drag operation is added. System-wide WCAG certification/axe audit remains a rollout task; native keyboard and 390px journeys are tested.
