# 16 — Testing Strategy

## Pyramid & Targets

| Level | Tooling | Scope | Gate |
|---|---|---|---|
| Unit | Vitest | domain entities (transitions, invariants, VOs), command/query handlers with mocked ports, utils | ≥ 80 % on `domain/` + `application/` |
| Integration | Vitest + Supertest + **Testcontainers** (real Postgres/Redis) | controller→DB slices per module: RBAC enforcement, tenancy isolation, audit rows written, outbox emission | every endpoint has ≥ 1 happy + 1 authz + 1 validation test |
| Contract | OpenAPI diff + Schemathesis fuzz; consumer-driven contracts for the PMO integration (Pact) | API stability | breaking change fails CI |
| E2E | Playwright against docker-compose stack | 12 critical journeys (below) | green before deploy to stage |
| Visual | Storybook + Chromatic | ui/ + data/ components, light & dark | review on diff |
| Performance | k6 | list endpoints @ 500 VUs, search, dashboard aggregates | p95 < 300 ms, error rate < 0.1 % |
| Security | OWASP ZAP baseline in CI; annual external pen test; `pnpm audit` + Trivy image scan | — | high findings block release |
| Accessibility | axe-core in Playwright | shell + top 10 pages | serious violations block |

## Critical E2E Journeys
1. Entra SSO login → company switch → dashboard renders
2. Create client → add contact → log activity → appears in timeline & global search
3. Lead → opportunity → go/no-go → proposal → mark WON
4. Contract draft → approval workflow (2 stages) → ACTIVE → expiry notification fires
5. Outgoing invoice from milestone → approve → number sequence gap-free → PDF/XRechnung
6. Incoming invoice upload → AI extraction → threshold routing → approve → DATEV export
7. Leave request → manager approval → balance updated → calendar shows absence
8. Purchase request → order → receipt → invoice matched
9. Asset assign via QR → employee equipment list → return
10. Document check-out/in → new version → OCR → found in full-text search
11. Notification center: expiring certificate scanner → bell → deep link
12. RBAC: EMPLOYEE role cannot read salaries/invoices (API + UI)

## Special Areas
- **Tenancy isolation tests**: every module's integration suite proves company A cannot read
  company B (fixture pair, automated for all list/detail endpoints via test harness).
- **German finance golden files**: DATEV EXTF export and XRechnung XML compared against
  approved fixtures; VAT rounding property-based tests (fast-check).
- **Workflow engine**: table-driven tests per definition JSON (approve/reject/escalate/timer).
- **Migration safety**: CI job runs `prisma migrate diff` against production schema snapshot
  and fails on destructive operations without an `ALLOW_DATA_LOSS` marker in the migration.
- **Seed-based demo env**: deterministic seed powers E2E and review apps.

## Process
TDD encouraged for domain logic; bug fixes require a failing test first; flaky tests
quarantined within 24 h (tracked issue) — never deleted silently; nightly full suite +
k6 + ZAP on `main`.
