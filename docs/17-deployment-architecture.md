# 17 — Deployment Architecture

## Environments

| Env | Purpose | Infra | Data |
|---|---|---|---|
| dev | local development | docker-compose | seed |
| review | per-PR preview (optional) | compose on CI runner | seed |
| staging | pre-prod validation | mirrors prod, small | anonymized prod copy |
| production | live | see below | real, backed up |

## Production Topology (recommended: German cloud/on-prem for data residency)

Target: Hetzner/IONOS/Azure Germany West Central — GDPR data residency. Two deployment
profiles; start with A, move to B when load or HA demands it.

### Profile A — Docker Compose on 2 VMs (launch profile, ≤200 active users)

```
            Internet
               │
        ┌──────▼──────┐   VM1 (app, 8 vCPU/32 GB)
        │ Caddy/Traefik│  TLS (Let's Encrypt), HTTP/2, rate limit
        ├──────────────┤
        │ web (nginx serving SPA)            │
        │ api ×2 replicas (NestJS)           │
        │ worker (BullMQ consumers, scanners)│
        │ meilisearch · redis                │
        └──────┬───────┘
               │ private network
        ┌──────▼──────┐   VM2 (data, 8 vCPU/32 GB, NVMe)
        │ postgres 16 (+ streaming replica optional)
        │ minio (versioned buckets)
        └─────────────┘
Backups: pgBackRest → offsite object storage (daily full, WAL archiving, PITR;
         restore drill quarterly) · MinIO bucket replication
```

### Profile B — Kubernetes (500+ users / HA)

- 3-node k3s/AKS cluster; api Deployment (HPA 2–8 pods), worker Deployment, web via CDN
- PostgreSQL: managed (Azure Flexible Server zone-redundant) or CloudNativePG operator
- Redis: managed/Sentinel; MinIO → Azure Blob/S3; Meilisearch StatefulSet
- Ingress-nginx + cert-manager; secrets via Key Vault CSI/SealedSecrets
- Manifests in `infra/k8s/` (kustomize overlays per env)

## Runtime Concerns

| Concern | Implementation |
|---|---|
| Zero-downtime deploy | rolling replicas behind proxy; readiness `/api/v1/admin/health`; migrations run as pre-deploy job (backward-compatible, expand→migrate→contract) |
| Observability | pino JSON → Loki; Prometheus metrics (`/metrics`: http, queue depth, event lag); Grafana dashboards; Sentry (API+SPA); alerting: error rate, p95, queue backlog, disk, cert expiry, backup success |
| Security | TLS 1.2+; HSTS; CSP; secrets never in images; DB/Redis on private network only; fail2ban/WAF on proxy; image scan (Trivy) in CI; least-privilege DB users (app vs. migration user) |
| Sessions/scale-out | stateless API (JWT); SSE sticky not required (Redis pub/sub fan-out) |
| File uploads | direct-to-MinIO pre-signed URLs — API never proxies large bodies |
| Cron/scanners | worker container runs BullMQ repeatables — exactly one scheduler instance (leader lock in Redis) |
| DR | RPO ≤ 15 min (WAL), RTO ≤ 4 h (documented runbook, restore into standby VM); config as code, rebuildable from repo + backups |

## Release Flow

`main` → CI (doc 19) → image `ghcr.io/octa/bms-{api,web}:sha` → auto-deploy **staging** →
smoke E2E → manual approval gate → **production** (tagged release, changelog generated).
Rollback = redeploy previous tag (DB migrations backward-compatible by policy).
