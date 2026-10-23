# Phase 1 — core foundation delivered with bounded recurrence

Files: Prisma schema and additive SQL/setup script; calendar-domain.ts, calendar.dto.ts, calendar.service.ts, calendar.controller.ts, calendar.module.ts; AppModule registration; shared/seed permission catalog. No existing source-domain data was replaced.

Implemented company/sensitivity/domain intersection, validated CRUD/status operations, checklist/evidence, validated links, optimistic versions, transactional immutable history and date-only daily/weekly/monthly/yearly recurrence with occurrence uniqueness. Completion creates the next pending occurrence and resets preparation/evidence. Provider-owned records reject edits; mirror tombstoning cannot affect unrelated obligations.

Validation: date/DTO/privacy unit tests and real PostgreSQL clean/existing fixtures, including concurrent edits/completion and single next occurrence. Local database additive migration applied with backup; feature enabled. No calendar demo data seeded.

Acceptance deviations: full RRULE, verified legal rule models/review, dependency DAG, recurring background materialization, reminders/escalations/outbox delivery and retention/purge are not implemented. This is a usable foundation, not an assertion that every Phase 1 deliverable is complete.
