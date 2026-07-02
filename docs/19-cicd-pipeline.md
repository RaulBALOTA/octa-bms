# 19 — CI/CD Pipeline

GitHub Actions. Live workflow: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

## Pipeline Stages

```
PR / push to main
 ├─ setup (pnpm cache)
 ├─ lint + typecheck            (parallel per workspace)
 ├─ prisma validate + migration-safety check (fails on destructive SQL
 │                              without ALLOW_DATA_LOSS marker)
 ├─ unit tests (Vitest, coverage upload)
 ├─ integration tests           (services: postgres, redis via GH services)
 ├─ build api + web             (artifacts)
 ├─ openapi export + diff       (breaking-change gate vs. main)
 ├─ security: pnpm audit · Trivy fs scan · gitleaks
 └─ [PR] done — required checks

merge to main (additionally)
 ├─ docker build+push  ghcr.io/octa/bms-api:{sha} · bms-web:{sha}  (Trivy image scan)
 ├─ deploy → staging   (compose pull+up via SSH / kubectl apply)
 ├─ E2E (Playwright) against staging + k6 smoke
 └─ ⏸ manual approval environment → deploy production (tag vX.Y.Z, changelog)
```

## Policies
- Required checks on `main`: lint, typecheck, unit, integration, build, openapi-diff, security.
- Migrations run as a pre-deploy job (`prisma migrate deploy`) with backward-compatible
  policy (expand→migrate→contract); deploy aborts if migration fails.
- Images immutable by SHA; `latest` never deployed; rollback = previous tag redeploy.
- Secrets via GitHub Environments (staging/production) with reviewers on production.
- Renovate bot: weekly dependency PRs auto-merged when all checks pass (patch/minor only).
- Nightly scheduled workflow: full E2E, k6 load, ZAP baseline, backup-restore verification.
