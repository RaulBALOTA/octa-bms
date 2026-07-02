# 20 — Future Scalability Plan

## Scaling Dimensions & Levers (in order of need)

### 1. Vertical + replica scaling (0 → 500 users) — covered by current design
Stateless API → add replicas; Postgres vertical + read replica for BI/report queries
(Prisma read-replica extension); Redis-backed permission & reference-data cache;
list-endpoint keyset pagination for big tables; materialized-view KPIs refreshed by events
(dashboards never scan transactional tables).

### 2. Workload isolation (500 → 1500 users)
- Split worker classes: `worker-jobs` (mail/ocr/exports) vs `worker-events` (outbox relay,
  indexing) vs `worker-scheduler` — independent scaling.
- Move Redis streams → **NATS/RabbitMQ** if event volume demands (the EventBusPort makes
  this an adapter swap).
- Search: Meilisearch → Elasticsearch/OpenSearch cluster only if index size (>10 GB docs)
  requires; same SearchPort.
- DB: table partitioning for `audit_logs`, `activity_logs`, `notifications`, `outbox_events`
  (monthly range partitions + retention drop) — these grow 10× faster than business data.

### 3. Module extraction (organizational scaling / SaaS ambitions)
The modular monolith is pre-cut along these seams (each already owns tables, events, API):
1. **Documents/DMS** (I/O heavy, OCR CPU) — first extraction candidate
2. **Workflow engine** (generic, reusable by PMO app)
3. **Search + AI gateway** (GPU/latency profile differs)
4. **Finance** (compliance isolation, audit independence)

Extraction recipe: promote module's application-service interface to REST/gRPC, move
outbox topics to the shared broker, split schema (foreign keys → id references — already
polymorphic-friendly), dual-run behind a feature flag.

### 4. Multi-tenancy evolution (product-izing for multiple firms)
Today: multi-company in one DB (row-scoped). Path to SaaS: `tenantId` above `companyId`
(schema-per-tenant via Postgres schemas, Prisma multi-schema), per-tenant Meilisearch
indexes and MinIO buckets, tenant-aware job queues. The AsyncLocalStorage context and
Prisma extension already centralize scoping — the change is localized.

### 5. Data & AI growth
pgvector → dedicated vector DB (Qdrant) past ~5M embeddings; report workloads → OLAP
replica (or DuckDB/ClickHouse export) when Power BI direct queries strain OLTP;
event stream → data lake (Parquet) for ML forecasting features.

## Guardrails that keep scaling cheap
- All cross-module calls go through ports/events (no hidden coupling to break later)
- Polymorphic references avoid FK webs that block schema splits
- Stateless API + externalized files/search/cache from day one
- Load tests (k6, 500 VU) in nightly CI catch regressions before users do
- Capacity review each quarter: DB size, queue lag, p95 trends drive the next lever

## Explicit non-goals (avoid premature complexity)
No microservices at launch · no Kafka before event volume proves need · no GraphQL
(REST + saved views cover the UI) · no multi-region until a business driver exists.
