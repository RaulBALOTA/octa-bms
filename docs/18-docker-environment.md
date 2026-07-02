# 18 — Docker Environment

## Dev Stack (`docker-compose.yml` at repo root)

Services:

| Service | Image | Port | Purpose |
|---|---|---|---|
| postgres | postgres:16-alpine | 5432 | system of record |
| redis | redis:7-alpine | 6379 | cache, queues, events |
| meilisearch | getmeili/meilisearch:v1.8 | 7700 | global search |
| minio | minio/minio | 9000/9001 | S3 file storage (+console) |
| mailpit | axllent/mailpit | 8025/1025 | SMTP catcher for notification mails |
| api | build `infra/docker/api.Dockerfile` | 3000 | NestJS (hot-reload via bind mount in dev override) |
| worker | same image, `node dist/worker.js` | — | queues & scanners |
| web | build `infra/docker/web.Dockerfile` | 5180/80 | SPA |

Volumes: `pg_data`, `minio_data`, `meili_data`. Healthchecks on postgres/redis gate api start.
`docker compose up -d postgres redis minio meilisearch mailpit` is enough for local
`pnpm dev` (api/web on host); full-stack compose used by E2E and review apps.

## Dockerfiles (multi-stage, in `infra/docker/`)

**api.Dockerfile**
```dockerfile
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @octa-bms/api prisma:generate && pnpm --filter @octa-bms/api build

FROM node:20-alpine AS runtime
RUN addgroup -S app && adduser -S app -G app
WORKDIR /app
COPY --from=build --chown=app /app/apps/api/dist ./dist
COPY --from=build --chown=app /app/node_modules ./node_modules
COPY --from=build --chown=app /app/apps/api/prisma ./prisma
USER app
EXPOSE 3000
HEALTHCHECK CMD wget -qO- http://localhost:3000/api/v1/health || exit 1
CMD ["node", "dist/main.js"]
```

**web.Dockerfile**: build stage (`pnpm --filter @octa-bms/web build`) → `nginx:alpine`
serving `dist/` with SPA fallback (`try_files $uri /index.html`), gzip/brotli,
long-cache hashed assets, `/api` proxied to api service.

## Environment Variables (`.env.example`)

```
DATABASE_URL=postgresql://octa:octa@localhost:5432/octa_bms
REDIS_URL=redis://localhost:6379
MEILI_HOST=http://localhost:7700          MEILI_MASTER_KEY=dev-master-key
S3_ENDPOINT=http://localhost:9000         S3_BUCKET=octa-bms
S3_ACCESS_KEY=octa  S3_SECRET_KEY=octa-secret
JWT_SECRET=change-me  JWT_ACCESS_TTL=900  JWT_REFRESH_TTL=604800
ENTRA_TENANT_ID=  ENTRA_CLIENT_ID=  ENTRA_CLIENT_SECRET=   # empty = local auth only
SMTP_HOST=localhost SMTP_PORT=1025 MAIL_FROM=bms@octa.example
AI_PROVIDER=anthropic  ANTHROPIC_API_KEY=
APP_URL=http://localhost:5180  API_URL=http://localhost:3000
```

Prod overrides via compose `env_file`/K8s secrets — never baked into images.
