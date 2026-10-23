# OCTA Company Calendar — Codex Implementation Master Prompt

**Version:** 1.0  
**Date:** 2026-10-12  
**Project:** OCTA Business Management App  
**Target:** Existing React + TypeScript + Vite / MUI frontend, Express + Node.js / Prisma + PostgreSQL backend, pnpm monorepo.  
**Audience:** Codex acting as a senior full-stack architect, developer, QA engineer, and security reviewer.

> **Codex execution instruction:** Implement this specification in the existing repository incrementally, preserving existing functionality. Inspect the repository before making changes. Do not invent existing file paths, tables, services, permissions, or architectural conventions. Prefer reuse and integration over parallel frameworks. Execute one phase at a time; each phase must leave the application buildable, testable, and usable. Do not claim a phase is complete unless its acceptance criteria are met and verified. Maintain a progress log and document any deviations.

---

## 0. Product charter: scope and non-goals

Create an AI-powered, visual **company/business management calendar** and **executive control center**. The calendar is **NOT a project management scheduler**. Its remit is managing the business: corporate administration, statutory/compliance obligations, finance, contracts, sales/business development, HR, office operations, meetings and commitments. Project systems may publish *only business-relevant* dates (e.g. commercial invoicing, contract renewal, executive review), but do not reproduce project Gantt charts, engineering deliverable schedules, site construction plans, or task scheduling.

The end-user question is: **“What is important for my company, when must it happen, who owns it, what is missing, and what happens if I do nothing?”**

### Mandatory product principles

1. **One company-wide time-control plane, multiple lenses.** All applicable business dates appear in one normalized index, with domain, business entity, organization, owner, role, and confidentiality filters.
2. **Microsoft 365 native.** Fully integrate Outlook calendars and Teams meetings through Microsoft Graph with clear permissions, robust two-way event synchronization where authorized, and an eventual Teams-hosted experience. Never confuse Teams online meetings with standalone Graph onlineMeeting resources that do not automatically create Outlook calendar events.
3. **Source-of-truth discipline.** Outlook remains authoritative for Outlook-owned meetings, and OCTA remains authoritative for OCTA obligations and commitments. Cross-system links do not create multiple independent authoritative copies.
4. **AI assists; humans remain accountable.** AI may extract, classify, explain, score, and propose; it must not silently establish legal obligations, send external messages, alter authoritative deadlines, grant permissions, or cancel meetings. Human approval and auditable writes are required.
5. **Designed for Germany first, multi-jurisdiction ready.** Separate editable/verified legal deadline rules from generative AI. Never hardcode purported statutory deadlines without a source, effective dates, jurisdiction and review workflow.
6. **Privacy and least privilege.** Private calendar content is not made visible to managers because of company role. Respect delegated Microsoft permissions, sensitivity classes, RBAC/ABAC, tenant boundaries, employee access and retention.
7. **High-signal visual UX.** Executive Horizon first; traditional calendar is one of the views. Expose urgency, ownership, readiness, forecast, and source clearly; avoid fake precision or alarm fatigue.
8. **Accessible and responsive.** WCAG 2.2 AA target, keyboard/screen-reader interactions, reduced-motion support, mobile layouts, and German/English localization.
9. **No fabricated data.** Mock/demo data must be clearly marked and isolated from production.
10. **Idempotent, observable integrations.** Handle webhooks, deltas, pagination, retries, conflicts, and reconnections reliably.

### In scope
- Corporate & compliance, finance & accounting, sales & business development, HR, operations, meetings & business commitments.
- Day/week/month/year grid, rolling Management Horizon, Business Timeline, Obligations Register, AI Brief/Inbox.
- Team-specific views, multi-company support if the existing platform already supports multiple companies; otherwise design for future tenancy without exposing data across companies.
- Outlook calendar connection and sync, Teams meeting creation, Teams notification/in-app tab in later phase.
- Source-aware recurring obligations, approvals, evidence, escalations, audit trails, notifications.
- AI-assisted date discovery from approved sources with provenance and confirmation.

### Out of scope
- Primavera-style critical-path planning, detailed project schedules, construction/engineering delivery tracking.
- Full email client, replacement of Microsoft Teams, replacement of payroll/accounting software.
- Automatic financial transactions or tax submissions.
- Unapproved bulk ingestion of private mailboxes or Teams conversation content.

---

## 1. Repository reconnaissance before development

Codex must first:

1. Print a concise inventory of workspace layout, package manager, apps/services, Prisma schema, existing auth, multi-tenancy, RBAC, background jobs, notification systems, telemetry, i18n and UI design conventions.
2. Search for existing calendar/event/activity, contract, finance, HR, CRM, reminders, audit and Microsoft integration code. Prefer reuse or migrations over duplicates.
3. Identify whether the existing system uses REST, OpenAPI, tRPC, queue workers, Redis, existing LLM adapters/Ollama, and existing notification preferences. Integrate using native patterns.
4. Write `docs/company-calendar/architecture.md` describing the actual repository before implementation; include a dependency diagram and concise architecture decision records.
5. Identify build/test/lint commands. Run baseline checks and record existing failures separately from introduced regressions.
6. Determine deployment and webhook constraints: a reachable HTTPS URL, worker process, durable queue, secrets store and database migrations.
7. Never overwrite user data, drop existing tables, or introduce breaking schema changes without additive migration and rollback plan.

If a module does not exist, create an adapter with an explicit interface and mark the integration as unconnected. Do not make up fake finance/HR source data.

---

## 2. Information architecture and visual design

Place **Company Calendar** under the business-management workspace/top navigation, not Project Management.

### Primary navigation

- **Overview / Executive Horizon:** today; next 7, 30 and 90 days; number and severity of critical, overdue, upcoming and awaiting external response items; ownership, actionability and AI attention list.
- **Calendar:** day / work-week / week / month / year, multi-calendar overlays, privacy-aware Outlook items, drag-and-drop where permitted, event details and create/edit.
- **Business Timeline:** quarter/year bands by business category, milestone glyphs, fixed vs internal vs forecast dates, aggregated recurrence series.
- **Obligations & Commitments:** filterable register with saved views: deadlines, recurring obligations, awaiting responses, decisions, evidence required, completed, overdue.
- **AI Inbox:** extracted candidate dates, classification confidence, missing fields, approval/reject and duplicates.
- **Integrations & Settings:** Outlook account(s), calendar selection, sync status, consent scopes, Teams options, reminder rules, domains, access controls, legal rule library.

### Responsive Executive Horizon

Desktop hierarchy:
1. Header: company selector (if supported), period selector, search, add action, assistant, integration health.
2. High-signal summary cards (critical / overdue / awaiting / upcoming / decisions). Counts are computed from **authorized** records only.
3. Left/main: **Management attention feed** ranked by explainable rules; each item shows category icon, title, owner, due date, time remaining, readiness/blocked indicators and one-click action.
4. Right: agenda / next meetings (Outlook), upcoming key deadlines, external commitments.
5. Bottom: rolling timeline, category distribution, alerts about missing ownership and due-date collisions.

Mobile: vertically prioritize critical feed and upcoming dates before dense calendar; use bottom sheet/full-screen item details.

### Visual semantics

Represent type with **icon/shape + label** in addition to restrained color:
- Circle: meeting / appointment.
- Diamond: business milestone.
- Triangle: hard deadline.
- Square: recurring obligation.
- Flag: management decision.
- Hollow diamond: forecast date.
- Loop: recurrence.

Severity (normal, watch, high, critical, overdue) must be separate from business category. Accessibility: contrast, readable badges, hover + click tooltips, keyboard-operable controls.

### Item detail drawer

Tabs: **Overview**, **Preparation / Checklist**, **Dependencies & Follow-ups**, **People & Permissions**, **Source & Evidence**, **History**, **Microsoft Sync** (where applicable). Show:
- Date dimensions: external hard date, internal target, forecast, original timezone, all-day flag.
- Responsible owner, approver, observers and access sensitivity.
- Required action, checklist, attachments / links, status, readiness evidence.
- Source system with deep link; reason for any AI recommendation; sync state and external identifiers (IDs never as user-facing labels).
- Explicit controls: mark complete, assign, propose date, link business entity, publish Outlook reminder, create Teams meeting, snooze *reminder* without changing legal deadline.

### Filters

Business domain, business entity, organizational unit, team, owner, status, source, risk, date horizon, meeting/obligation/forecast type, confidence, confidentiality, Outlook calendar. URL query parameters and saved personal/team views. Authorized filter options only.

### User journeys to implement

1. Managing director opens Horizon and sees a tax-document preparation due this week and the responsible accountant.
2. Sales manager creates an offer-validity deadline linked to an opportunity and schedules a follow-up meeting in Outlook/Teams.
3. Employee connects Outlook calendar, selects allowed calendars, and sees their own appointments in OCTA without exposing private details to other users.
4. Finance owner completes a recurring obligation with evidence; next occurrence is generated according to the verified recurrence rule.
5. AI proposes a deadline detected in a permitted email; user validates title, date, company, owner, and source before creation.
6. Reconnection after a Microsoft token expiration recovers without duplicate meetings or data loss.

---

## 3. Domain model and database

Design Prisma models compatible with existing schema naming conventions. The following are **conceptual** tables, not literal migration commands. Follow repository naming and tenancy conventions.

### `BusinessCalendarItem`
- `id`, `organizationId`/`companyId` (if multi-company), `title`, `description`, `domain` (CORPORATE, FINANCE, SALES, HR, OPERATIONS, MEETING, COMMITMENT), `kind` (APPOINTMENT, DEADLINE, OBLIGATION, MILESTONE, DECISION, FORECAST, FOLLOW_UP), `status` (DRAFT, OPEN, IN_PROGRESS, AWAITING, AT_RISK, COMPLETED, CANCELED), `priority`, `sensitivity` (PUBLIC_INTERNAL, TEAM, RESTRICTED, PRIVATE).
- `startsAt`, `endsAt`, `hardDueAt`, `internalTargetAt`, `forecastAt`, `timezoneIana`, `allDay`, `dateOnly` (where appropriate). Define all-day and date-only semantics explicitly; do not silently convert local legal deadlines to UTC midnight.
- `ownerUserId`, `createdById`, `approvedById`, `completedAt`, `completedById`, `completionEvidenceRequired`, `readinessMode`, `readinessValue` (nullable), `readinessEvidence` (via linked records).
- `sourceKind` (MANUAL, MODULE_PROJECTION, MS_GRAPH, AI_APPROVED, VERIFIED_RULE), `sourceSystem`, `sourceEntityType`, `sourceEntityId`, `sourceUrl`, `sourceVersion`, `sourceSnapshotHash`, `sourceLastSeenAt`.
- `businessEntityType`, `businessEntityId`, `contractId` or normalized cross-entity link table. Preserve links to originating systems without taking control of their data.
- `recurrenceSeriesId`, `originalOccurrenceKey`, `estimatedFinancialExposureMinor`, `currency`, `impactNotes`, `riskScore` (nullable), `riskReasonsJson` with scorer version.
- `createdAt`, `updatedAt`, `deletedAt` nullable for internal archival, optimistic `version`.

### Related models
- `BusinessCalendarParticipant` (user / external email; role: owner, contributor, attendee, observer, approver).
- `BusinessCalendarDependency` (linked items, dependency type, reason; prevent cycles where logic requires DAG).
- `BusinessCalendarChecklistItem` and `BusinessCalendarEvidence` (file reference, source URI, creator, verification status, timestamps).
- `BusinessObligationDefinition` (name, company, jurisdiction, applicability, verified source URL/citation, reviewer, effectiveFrom/effectiveTo, ruleRevision, recurrence rule, authority, owner, preparationLeadTime, escalation policy, reviewStatus).
- `BusinessCalendarRecurrence` (RFC 5545 RRULE as applicable, timezone, exceptions, occurrence range, end rules, DST policies, idempotent occurrence keys).
- `BusinessCalendarReminderRule` / `BusinessCalendarNotification` (offset, channel, delivery state, deduplication key, recipient, last attempt, next retry).
- `BusinessCalendarExternalLink` (internal itemId, provider, tenantId, userId, calendarId, eventId, iCalUId if present, immutable Graph ID if requested/supported, changeKey/etag, syncOrigin, lastSync, syncState, version map).
- `MicrosoftConnection` (tenant, provider account/user OID, encrypted token reference, granted scopes, expiry, connection health; never expose secrets to client).
- `MicrosoftCalendarSubscription` (subscription ID, resource, expiration, clientState hash/secrets reference, renewal state, tenant/user, last notification).
- `MicrosoftCalendarSyncCursor` (calendar/owner + range bounded start/end, delta link, last successful sync, last failure, cursor generation, status).
- `BusinessCalendarSuggestion` (type, source and excerpt boundaries, detected date, locale/timezone, proposed title/domain/owner, confidence, explanation, pending/rejected/approved, fingerprint, AI model/prompt version, reviewer).
- `BusinessCalendarAuditLog` (actor, action, entity, version before/after or secured diff, source, requestId, timestamp).
- `BusinessCalendarAccessGrant` if existing RBAC cannot represent explicit item visibility.
- `BusinessCalendarOutbox` for transactional delivery of sync/notification jobs if the repo has no existing outbox.

### Mandatory invariants

- Every lookup and mutation is company/tenant scoped and authorization checked server-side. Index by company, owner, domain, type, dates, and status.
- Enforce appropriate uniqueness for `(connection, calendar, externalEventId)`, recurrence occurrence identity, source projections and idempotency keys.
- Audit authoritative deadline changes including old/new values and who approved.
- MS Graph/Outlook deletions do **not** delete unrelated OCTA obligations; preserve tombstones on external event mirror records.
- AI suggestions remain separate records until approved. They do not appear as authoritative obligations.
- Financial exposure is optional and explicitly user-sourced; do not calculate artificial exposure values.
- For a mirrored Outlook event, Outlook fields have provider ownership; use sync mapping and optimistic concurrency, not uncontrolled last-write-wins.
- Avoid storing email bodies, Teams chats, meeting transcripts or Graph access tokens in calendar event records.

### Date modeling

Support:
- Timed appointments with full UTC instants + original IANA timezone.
- All-day meetings as date ranges with exclusive end date where applicable.
- Date-only obligations in company-local calendar with a separately defined submission cutoff if known.
- Hard due date vs internal target vs forecast; visual comparison and buffer; avoid treating weekends as working days without configured calendars.
- German and English locale, Europe/Berlin by default at company setup, customizable per company/user.
- DST boundary tests, recurring meetings and exception instances.

---

## 4. API and permission boundaries

Implement REST endpoints per existing Express routing conventions, with validation (repo-standard Zod/Joi/etc.), pagination and comprehensive authorization.

Suggested routes (adapt naming to current repository):

```text
GET    /api/business-calendar/items
POST   /api/business-calendar/items
GET    /api/business-calendar/items/:id
PATCH  /api/business-calendar/items/:id
POST   /api/business-calendar/items/:id/complete
POST   /api/business-calendar/items/:id/reopen
POST   /api/business-calendar/items/:id/publish-outlook
GET    /api/business-calendar/horizon
GET    /api/business-calendar/timeline
GET    /api/business-calendar/agenda
GET    /api/business-calendar/obligations
POST   /api/business-calendar/obligation-definitions
PATCH  /api/business-calendar/obligation-definitions/:id
GET    /api/business-calendar/suggestions
POST   /api/business-calendar/suggestions/:id/approve
POST   /api/business-calendar/suggestions/:id/reject
GET    /api/business-calendar/integrations/microsoft/status
POST   /api/business-calendar/integrations/microsoft/connect
GET    /api/business-calendar/integrations/microsoft/callback
POST   /api/business-calendar/integrations/microsoft/disconnect
GET    /api/business-calendar/integrations/microsoft/calendars
PATCH  /api/business-calendar/integrations/microsoft/calendar-selection
POST   /api/business-calendar/integrations/microsoft/sync-now
POST   /api/business-calendar/integrations/microsoft/webhook
POST   /api/business-calendar/integrations/microsoft/webhook/lifecycle
GET    /api/business-calendar/audit
POST   /api/business-calendar/ai/brief
POST   /api/business-calendar/ai/query
```

Do not implement exact routes that conflict with current API or public webhook constraints. Keep Microsoft OAuth callback/state handling isolated. Calendar item collection APIs should take `from`, `to`, `domains`, `owners`, `status`, `source`, `calendarIds`, `search` with sensible maxima, performance indexes, and `ETag`/version checks on writes.

### Roles and privacy

Roles: company owner/admin; business manager; finance; HR; sales; operations; normal employee; optional guest. Derive from existing auth, never redefine global identity. Access is intersection of company scope + module permission + item sensitivity + Outlook delegated visibility. HR and personnel matters require dedicated access rules. Provide free/busy-only views where appropriate. Never show private Outlook meeting subjects in aggregated company views unless explicitly shared and authorized.

---

## 5. Microsoft 365: integration architecture

Use **Microsoft Entra ID + Microsoft Graph v1.0** and supported MSAL library. Prefer delegated user OAuth authorization-code flow with PKCE and incremental consent. Do not place client secrets in frontend; encrypt refresh tokens at rest (or use managed token cache/secret service). Clearly differentiate OCTA login from connecting Microsoft calendars. Support disconnection and consent revocation.

### Connection wizard

1. Connect Microsoft account.
2. Show tenant/account identity and currently granted scopes.
3. Fetch calendars the user can access, indicate ownership and read/write capability, and let user choose calendars to import. Default to minimal permissions and no import of nonselected mailboxes.
4. Choose sync behavior by calendar: read-only mirror or authorized two-way appointment editing.
5. Configure privacy (private events: busy-only for other users), initial history/future sync range, timezone and working hours.
6. Show health: last successful sync, delayed/error/reconnect state, subscription expiry and permissions.

### Permissions: least privilege

- Sign in and profile: `openid`, `profile`, `offline_access`, `User.Read` as appropriate.
- Outlook read: `Calendars.Read` with approval and capability checks; write appointments / invitations: `Calendars.ReadWrite` only for opt-in bidirectional integration.
- Shared calendars: permission and endpoint selection must follow provider's published requirements; no blanket application permission solely to make setup easy.
- Mail extraction is a separate opt-in feature with `Mail.Read` and explicit mailbox/folder policies; never request it in baseline calendar setup.
- Teams activities/tabs/bots and channel resources require separate capability-specific permissions and tenant admin approval if Microsoft requires it.
- Never use app-only access to every company mailbox by default. If future administrative shared-calendar service needs app permissions, require tenant administrator configuration, application access scoping, separate threat review and an explicit UI capability.

### Calendar sync engine

Build `MicrosoftCalendarAdapter` interface and service implementation. Maintain normalised mirror records and clear field ownership.

- Initial sync: Microsoft Graph calendar view for configurable date window (e.g. past 90 / future 365 days, configurable), one cursor per calendar and time range.
- Incremental sync: Graph **calendarView delta** on v1.0, following complete opaque `@odata.nextLink` / `@odata.deltaLink` URLs. Keep cursors with their ranges and do not assume beta-only unbounded event delta is generally available.
- Push: Graph change notification subscriptions to prompt an incremental sync; implement `validationToken` challenge response, clientState validation, HTTPS restrictions, lifecycle notifications, expiration renewal and missed-notification recovery.
- Background polling/reconciliation even with active webhooks; respect Graph throttling (`429`, `Retry-After`) and use exponential backoff with jitter.
- Deduplicate repeat/out-of-order webhooks using event identity, change keys and sync checkpointing.
- Use immutable Outlook IDs when supported/appropriate by request header; do not depend only on mutable event IDs. Preserve calendar, tenant, user, iCalUId and occurrence identity, noting that these identifiers have distinct semantics.
- Handle recurring series, occurrence exceptions, event moves, canceled meetings, deleted occurrences, time changes and multi-attendee meeting updates.
- Avoid feedback loops: record change origin and successful outbound version; webhook-triggered updates that reflect own changes must not re-publish.
- Changes from Outlook: update mirrored appointments and the associated **meeting** records if owned by Outlook; do not automatically alter independent OCTA legal/business deadlines.
- Changes from OCTA: only propagate allowed mutable Outlook event fields with explicit user intent / setting; use ETags/change keys and conflict handling with visible resolution UI.
- Maintain retries, dead-letter queue, idempotency and structured sync log. Use a durable queue/worker pattern if existing stack supports it; do not perform Graph sync synchronously inside user requests.
- On disconnect: revoke/clear local token references where possible, stop subscriptions/jobs, hide or remove cached personal event content according to policy, keep business-owned obligations intact, record audit event.

### Meetings and Teams

- Create an Outlook calendar event with `isOnlineMeeting: true` and `onlineMeetingProvider: teamsForBusiness` when calendar/user/tenant supports it. Persist the event and meeting join URL returned by Graph.
- Do not use standalone `/onlineMeetings` to represent calendar-backed appointments: such meetings do not automatically appear in the user's Outlook calendar.
- Support attendee list, timezones, location, updates, cancellation, invitation handling and deep link to Outlook/Teams.
- Phase 4: package a Teams personal app/tab to host OCTA views (Teams JS SDK as appropriate) and provide notifications/optional bot, subject to permissions and tenant approval. Make a real deployment manifest and instructions, not just an iframe URL.
- Teams chat or meeting transcript summarization is **not** enabled automatically; it is a separate, high-privacy opt-in with compliance review.

### Microsoft Graph official documentation (verify against current docs when implementing)

- [Calendar event creation](https://learn.microsoft.com/en-us/graph/api/calendar-post-events?view=graph-rest-1.0)
- [Delta queries for calendar view](https://learn.microsoft.com/en-us/graph/delta-query-events)
- [Outlook change notifications](https://learn.microsoft.com/en-us/graph/outlook-change-notifications-overview)
- [Graph throttling](https://learn.microsoft.com/en-us/graph/throttling)
- [Microsoft identity platform](https://learn.microsoft.com/en-us/entra/identity-platform/)
- [Teams platform](https://learn.microsoft.com/en-us/microsoftteams/platform/)

Read current API permissions and limitations directly before finalizing implementation; document version-dependent constraints in `docs/company-calendar/microsoft365.md`.

---

## 6. Business obligations and commitments

### Obligations register

Each definition must store: company, domain, jurisdiction, applicable legal/contractual basis, source evidence, effective dates, owner, backup owner, reviewer, fixed deadline determination method, preparation lead time, escalation rule, frequency, required documentation, completion evidence and history. Support provisional obligations pending review and verified rules; show the state clearly. Country presets are optional examples, never trusted automatic legal truth.

Example types (without automatically assigning legal due dates):
- Finance: VAT filings / payments, accounting closing, payroll, invoices due, cash review.
- Corporate: annual accounts, registrations, license renewals, insurance, legal/filing reminders.
- HR: contract renewals, probation evaluations, occupational training/certificates, leave.
- Commercial: proposal validity, customer follow-up, contract termination notice, supplier renewal.
- Operations: subscriptions, periodic reporting, board/management reviews.

### Commitment capture

Record who promised an action to whom, agreed due date, source (email/minutes/manual), owner, awaiting party, expected evidence and follow-up actions. Support external commitments pending counterpart response; distinguish *promise date* from a verified contractual/legal deadline.

### Recurrence engine

Use RRULE or equivalent configured business recurrence and company timezone; occurrence generation is idempotent; allow exceptions, modified individual occurrence, skipped occurrence, reviewed rule-version changes, holiday calendars and business-day adjustments only when verified/configured. Prevent double-generation after job retries and handle DST.

### Reminders and escalations

Per company / category / user: initial lead time, reminder channel (in-app, optional Outlook, email, Teams where enabled), overdue follow-up, escalation recipient, quiet hours, notification batching. A snoozed notification must not change the underlying obligation due date.

---

## 7. AI intelligence service

Follow the app's existing LLM provider abstraction if present; do not hardcode one model. Keep extraction, retrieval, scoring, recommendation and writes separated. Always annotate source, confidence and model versions. Use privacy-aware document retrieval and tool access; never feed unauthorized HR, private meeting, email or financial content to a general company query.

### AI capabilities

1. **Executive Brief**: top 3–7 actionable company priorities with *why*, owner, due window, blockers, linked source, recommended next step; avoid generic event lists.
2. **Natural language search**: “Which offers expire in 30 days?”, “Which obligations lack an owner?”, “What client follow-ups are overdue?”. Resolve company/timezone/permissions and link results to records.
3. **Deadline/commitment extraction** (separate opt-in): read explicitly connected/authorized email, document, contract or meeting notes; propose structured candidate with date/time, timezone, quoted evidence location, source link, confidence and uncertainty; show approval queue.
4. **Duplicate/conflict detection**: suggest merging candidate dates based on entity, normalized date/time, source and semantics; never auto-merge distinct legal obligations.
5. **Attention scoring**: deterministic explainable baseline using proximity, explicit criticality, missing owner, incomplete checklist, evidence requirements, waiting on third party, significance, recurrence failure; AI may enrich narrative, not invent a computed numeric score.
6. **Meeting assistance**: query Outlook free/busy only for authorized attendees and propose scheduling slots; require user confirmation to send invitations.
7. **Follow-up drafting**: prepare email/Teams text with user review, never send automatically without explicit authorized workflow.

### AI guardrails

- Every external extracted deadline is `SUGGESTED` until approved; no auto-authored statutory rule.
- Do not infer legal due dates from LLM memory. Legal rules must have source, reviewer, effective date and applicability.
- Never include raw sensitive records or access tokens in AI telemetry.
- Prompt injection resistance: treat emails, documents and meeting bodies as untrusted data; prohibit source text from instructing model/tools to change policy or send messages.
- Model output passes schema validation, authorization, timezone plausibility and source verification before persistence.
- Present uncertainty: “possible deadline”, “date not explicit”, “owner unknown”.
- Evaluate on a curated set of German + English samples including vague dates, future vs historical mentions, competing dates and contractual clauses.

### Explainable attention scoring

Implement a configurable rules-based `attentionScore` in 0..100 with documented weights: days remaining / overdue, item criticality, readiness completeness only when evidence exists, blocked/dependency signals, external deadline, financial exposure only if explicitly sourced, owner missing. Nullable where insufficient information. Generate reason codes and human-readable explanation. Do not misrepresent likelihood as calibrated probability. Unit-test scoring, suppress noisy duplicates and rate-limit repeated alerts.

---

## 8. Notifications, observability and security

### Notification channels

In-app first; email and Teams only after explicit connection and consent. Use a queue/outbox, retry policy, idempotency keys, per-user opt-outs, digest schedules, quiet hours, and delivery logs. Escalations should honor entity security even in notification previews.

### Security

- OAuth `state`, PKCE, nonce where relevant, redirect allowlist, session protections, secure cookies, CSRF protections and HTTPS.
- Tenant binding during OAuth; reject identity mismatch and cross-tenant token confusion.
- Encrypt tokens, webhooks secrets and delta link storage; secrets via environment/secret manager, never source control.
- Validate webhook token/challenge/clientState; accept notifications quickly and queue processing; avoid leaking secrets in logs.
- Explicit authorization on **every** read, write, export, AI retrieval, attachment and sync action.
- GDPR-oriented data minimization, defined retention/purge and data subject request workflows; ensure role-based protection for HR content.
- Record audit history for permissions, deadline changes, ownership changes, approvals, sync connect/disconnect and external writes.
- Threat model: mailbox overreach, prompt injection, calendar invitation spoofing, sync loops, provider outages, OAuth/token theft, tenant leakage, mass notification abuse, race/conflict scenarios.

### Reliability and telemetry

Expose dashboard and logs: connected accounts, calendar sync lag, last success, queued jobs, webhook success/expiration, delta cursor age, Graph 429 and 5xx rates, duplicate avoidance, notification outcomes, AI extraction precision/approval rates and error budgets. Use request IDs and scrub PII/secrets. Health should degrade gracefully when Microsoft is offline: keep OCTA obligations available and mark external calendar cache stale.

---

## 9. Phased implementation plan (execute sequentially)

### Phase 0 — Discovery and technical blueprint

**Deliverables:** repository inventory; actual existing-module integration map; UI sitemap/wireframe; ADRs covering source-of-truth, timezones, permissions, Graph integration and sync queue; feature flags; migration and rollback plan.

**Acceptance:** Codex can show precisely where the calendar will live and how it connects to current auth, company, CRM, finance, HR, contracts and notifications without deleting or duplicating functionality.

### Phase 1 — Core backend, obligation engine and APIs

**Deliverables:** Prisma additive migrations; domain services; ownership/RBAC; CRUD and status transitions; recurrence engine with idempotent occurrence generation; checklist/evidence; business entity links; audit log; server-side validation; unit and integration tests. Seed only separate demo/test data.

**Acceptance:** multi-user access enforced; date-only and timed records correct across DST; recurring obligations generate exactly once even on retries; deleting Outlook mirror has no effect on OCTA obligation; migrations succeed on a clean DB and existing DB fixtures.

### Phase 2 — Visual company calendar

**Deliverables:** Executive Horizon, agenda, month/week/day/year, Business Timeline, Obligations Register, quick-create, detail drawer, filters, search, saved views, responsive interactions, translations, accessibility tests. Use MUI and existing design tokens; choose a well-supported calendar visualization library only if aligned with repo and licensing.

**Acceptance:** manager can identify top priorities, add an obligation, assign an owner, set distinct external/internal dates, link a business entity, mark complete with evidence, and review the history. UI usable with keyboard and at mobile widths.

### Phase 3 — Outlook / Microsoft Graph foundation

**Deliverables:** Entra OAuth wizard, delegated permissions, secure token cache, selected-calendar discovery, initial calendarView sync, delta synchronization, webhook validation/subscriptions and renewal, reconciliation, conflict handling, reconnection, clear sync status, controlled two-way appointment edit/create, Teams online meeting URL via Outlook event, dedicated docs and integration tests with HTTP mocks.

**Acceptance:** Outlook-created event appears in OCTA within sync SLA; OCTA-created event appears in Outlook only with authorized user action; an external edit is reflected; retries do not create duplicates; canceled/recurring meetings reconcile; Graph outage is recoverable; private calendar content is not exposed to coworkers.

### Phase 4 — AI support and candidate inbox

**Deliverables:** AI executive briefing, rule-based attention scores, natural language query with permission-filtered retrieval, candidate extraction API and approval UI, approved document/email input adapters only when permissions granted, duplicate detection and evaluation suite.

**Acceptance:** extracted candidates include source and confidence; AI cannot silently create a binding obligation; results never leak HR/private data; unclear dates are flagged; actionable brief links to exact items; model outage never blocks core calendar.

### Phase 5 — Teams native experience and coordinated workflows

**Deliverables:** Teams manifest and personal-tab deployment guide, selected notifications, optional bot commands, Teams meeting controls, org settings, actionable follow-up/digest workflows. Evaluate tenant approval and Graph permissions for each capability before enabling.

**Acceptance:** user can access permitted OCTA view in Teams, open linked obligation from notification, and create an Outlook calendar-backed Teams meeting; no unapproved channel/chat reads.

### Phase 6 — Business integrations, hardening and rollout

**Deliverables:** finance/CRM/contracts/HR source adapters wherever current modules actually exist, non-destructive projections, end-to-end quality gate, Graph throttling/load tests, GDPR/security review, migration/backfill, admin setup wizard, monitoring, runbook and release documentation.

**Acceptance:** module-generated business dates retain source authority and update correctly; outages degrade gracefully; tests pass; deployment steps and rollbacks are reproducible; feature flags enable controlled rollout.

---

## 10. Test matrix and quality gates

### Required automated tests

- Date logic: all-day vs timed, leap years, Europe/Berlin DST, working-day calendars, recurrence rules, canceled/edited occurrences, internal target vs external due date.
- Authorization: organization isolation, company admin vs employee, HR confidentiality, finance restrictions, personal Outlook event visibility, AI retrieval privilege separation.
- Integrations: OAuth state/PKCE errors, expired tokens, revoked consent, delta paging and cursor persistence, lifecycle notifications, webhook replay/out-of-order, 429 throttling, eventual consistency, Graph 500 and network outage, duplicate events, bidirectional updates and conflict resolution.
- Business logic: obligation verification, immutable audit records, evidence completion, missed/overdue handling, reminder escalation, idempotency.
- AI: schema validation, fake dates, ambiguous references, prompt injections, inaccessible source, confidence disclosure, false-positive filtering.
- UI: interaction across horizon/calendar/timeline, timezones, large calendars, keyboard navigation, screen-reader labels, responsive behavior and dark/light themes.

### Release gate

Run typecheck, lint, tests and production build for affected apps. Fix introduced failures. Include migration dry run and rollback notes. Never declare integration production-ready without real-tenant smoke tests (with redacted logs and test account) and verification of tenant consent requirements.

---

## 11. Expected deliverables and working method for Codex

**Do not merely output a plan. Implement phase by phase directly in the repository.**

At the start of each phase:
1. Inspect relevant code and summarize discovered constraints in `docs/company-calendar/phase-N.md`.
2. List the exact files/services/models to add or change.
3. Implement a small vertical slice and run tests immediately.
4. Integrate with existing auth, UI and business entities; do not make another standalone demo app.
5. Update navigation, translations, changelog, docs and deployment configuration.
6. Report what was implemented, tests run with results, files changed, missing credentials/external dependencies and next phase.

Create/maintain these docs:

```text
docs/company-calendar/
  README.md
  architecture.md
  data-model.md
  api.md
  ux-spec.md
  microsoft365.md
  ai-governance.md
  security-privacy.md
  operations-runbook.md
  acceptance-tests.md
  phase-0.md ... phase-6.md
```

### Do not bypass blockers

If a phase requires unavailable Microsoft app registration, tenant admin consent, Graph webhook public HTTPS address, Teams package deployment, or real integration credentials, implement everything testable with mocks, feature-flag the blocked feature, and document the exact admin/user setup steps. Do not claim actual connection or end-to-end live verification without testing it.

### Prioritization

Deliver **Phase 0 through Phase 2** first as a valuable standalone Company Calendar. Next implement **Phase 3 Outlook/Teams meeting integration**; then AI; then native Teams UI. Do not allow Teams packaging or AI extraction complexity to compromise reliable obligations, privacy or Outlook synchronization.

---

## 12. Definition of done — overall product

The feature is complete when an authorized business user can:

1. See all relevant **business** deadlines, obligations, commitments and meetings in one attractive, responsive interface.
2. Understand what needs attention through an explainable executive view, not only a chronological list.
3. Manage recurring company obligations with verified rules, owners, evidence, reminders and history.
4. Link dates to business modules without source-of-truth drift.
5. Connect their Microsoft 365 account and select Outlook calendars to synchronize.
6. Create/edit Outlook-backed meetings and Teams online meetings with appropriate permissions and conflict handling.
7. Preserve private calendar confidentiality and manage Microsoft disconnect/reconnection safely.
8. Approve AI-suggested dates and receive sourced AI briefings without unauthorized external writes.
9. Use OCTA in Teams (where deployment/permissions are supported) for selected views and notifications.
10. Operate through downtime and recover sync through monitored, idempotent jobs.

## 13. First Codex execution command

**Begin now with Phase 0. Inspect the repository and implement the Phase 1 foundation only after documenting the current architecture and integration points. Continue sequentially through the phases as tool/context budget permits. Never replace business obligations with project milestone scheduling. Keep every change backward-compatible, tested and feature-flagged until validated.**
