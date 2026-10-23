# Phase 2 — standalone visual calendar delivered

Files: CompanyCalendarPage, features/company-calendar/*, dedicated DE/EN calendar resources and i18n merge, sidebar/route registration, browser tests.

Implemented Horizon, agenda, day/work-week/week/month/year, quarter timeline, obligations register, create/edit/detail, owner/sharing, distinct dates, checklist/evidence completion/history, business-record search/select, URL filters, browser-local saved views and responsive native dialogs. Production web build and desktop/mobile keyboard journeys pass.

Deviations: actual app uses Tailwind, not MUI. Native accessible modal replaces detail drawer. No drag-and-drop, shared saved views, source/risk/confidence filter facets, year recurrence aggregation, dependencies/follow-ups tab, or AI inbox. Full WCAG/axe audit is not claimed. Large date collections use explicit pagination; Horizon discloses the 1,000-record cap.
