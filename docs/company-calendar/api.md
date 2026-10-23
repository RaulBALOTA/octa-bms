# Calendar API

Base: `/api/v1/business-calendar`. Existing JWT auth, X-Company-Id membership guard and permission guard apply to every route. DTO whitelist refuses caller-supplied company/source/author/status fields. No public callback is added.

| Method | Route | Permission / behavior |
| --- | --- | --- |
| GET | capabilities | calendar.items.read; available even when disabled |
| GET | members | calendar.items.read; active company members, minimal name fields |
| GET | entities?type=&search=&selectedId= | calendar.items.read plus linked module permission; at most 100 scoped references |
| GET | items | calendar.items.read; paginated authorized records |
| GET | horizon | calendar.items.read; authorized active attention/agenda |
| GET | items/:id | calendar.items.read; full authorized details + canEdit |
| POST | items | calendar.items.create; validated dates, owner, grants and business links |
| PATCH | items/:id | calendar.items.update + edit visibility; required integer version |
| POST | items/:id/transition | calendar.items.update; required version and allowed status |
| POST | items/:id/complete | calendar.items.update; version, checklist/evidence gates, transactional next recurrence |
| POST | items/:id/reopen | calendar.items.update; version, refuses completed recurring occurrence |
| POST | items/:id/evidence | calendar.items.update; version, title, HTTPS URL |
| POST | items/:id/archive | calendar.items.delete + edit authority; version, soft archival only |
| GET | items/:id/history | calendar.items.read + owner/creator; latest 100 immutable history entries |

Collection query: search (≤250 chars), domain, status, owner (`me` or user ID), from/to (ISO local dates), page (≥1), pageSize (1–500, default 100). Compound filters intersect visibility; search never replaces the company predicate. Range filtering includes multiple date dimensions and overlapping appointments; timed query bounds accommodate all timezone offsets. UI places instants using original timezone and excludes exclusive ends.

Stale versions: 409; unauthorized item IDs: 404; authorized but read-only writes: 403; invalid dates, owners, grants, linked entities, or evidence prerequisites: 400; disabled feature: 503. Current recurrence configuration is immutable per series. Status cannot be changed through PATCH.

Horizon ignores the status filter and excludes completed/canceled/draft records. Exact total is returned; summary and ranked feed are capped at 1,000 records with truncated=true disclosure. Rule weights: overdue 45, due in 7 days 25, due in 30 days 10, high priority 15/critical 25, missing owner 15, awaiting 10, at-risk 15, incomplete checklist 10, missing required evidence 10. Sum caps at 100; reasons accompany the score. No AI/financial exposure assumptions.
