# Security & quality audit — October 2026

Scope: the API (`apps/api`), the web client (`apps/web`), CI and container setup.
Before the audit, typecheck and unit tests were green (208 tests). Lint did not
run, and the CI seed step could not succeed on a fresh database.

## Fixed

### Critical — data could leak or change across companies (IDOR)

Many handlers loaded or changed a record by its id alone. Any user holding a
module permission in *any* company could read or modify another company's
records. Affected areas:

- CRM contacts and activities
- contract obligations, milestones, claims and variation orders (an approved
  variation order also raised the foreign contract's value)
- bank guarantees and proposal fee lines
- employees
- leave requests: list, create and decide (deciding also booked days on the
  foreign leave balance)
- meeting action items
- user administration: list, view and deactivate users of any company

Body foreign keys were not checked either: a partner, employee, contract,
cost center or bank account from another company could be linked into
invoices, contracts, opportunities, payments, budgets, assets and employees.

**Fix:** records are now looked up through their company, or through their
parent's company, and answer 404 otherwise. Body references are validated
against the active company (`src/common/tenant-scope.ts`).
`test/tenant-isolation.postgres.ts` exercises all of this over HTTP against
PostgreSQL. It fails on the previous code and now runs in CI.

### High

- **RBAC without a company context granted every company-scoped role.**
  `companyId: undefined` removed the Prisma filter entirely. Now only global
  assignments apply in that case.
- **Role grants.** A company admin could assign global roles, or roles in
  other companies. Assignment and revocation are now limited to the active
  company for non-system admins, and the target user must be a member of it.
  The permission cache is invalidated immediately; before, revoked rights
  lasted up to 60 s.
- **JWT secret.**
  - `JwtModule.register` read `JWT_SECRET` before `.env` was loaded, so tokens
    were signed with `dev-only-secret` while the strategy verified with the
    configured secret.
  - Production now refuses to start with a missing, placeholder or short
    secret.
- **Refresh tokens.**
  - Rotation is now atomic. Before, two concurrent refreshes with the same
    token both succeeded.
  - Replaying a long-rotated token revokes all of the user's sessions. A 30 s
    grace window allows for two tabs refreshing at once.
- **OIDC.**
  - An Entra login could take over an existing account by email even when that
    account was bound to a different Entra identity. This is now rejected.
  - Lookups prefer the Entra object id over the email.

### Medium

- Login is limited to 10 requests per minute per IP. Unknown accounts take
  the same time to reject as wrong passwords.
- Concurrent leave approvals can no longer book vacation days twice.
- In production, CORS no longer reflects arbitrary origins.
- Proxy hops on private networks are trusted, so rate limits and audit logs
  see real client IPs.
- Swagger is off in production unless `API_DOCS_ENABLED=true`.
- A missing company context returns 400 instead of 500.
- **Web client.**
  - Token refresh is single-flight, so parallel 401s no longer race the
    rotating token and log the user out.
  - Logout now revokes the refresh token on the server.
- **CI.** The seed step now has bootstrap admin credentials; it needs them on
  a fresh database.

## Follow-up — resolved

Each point the first pass left open:

1. **Documents are company-scoped.**
   - `Folder` and `Document` carry a `companyId`. Every document and folder
     endpoint filters by the active company, including download, preview,
     bulk move/delete and upload of new versions.
   - New folders and documents, including contract files, record their
     company.
2. **Legal and insurance are company-scoped.** The same applies to
   `LegalCase`, `ComplianceItem`, `DataProcessingActivity`,
   `WhistleblowerReport`, `ProfessionalLicense` and `InsurancePolicy`.
   - `prisma/sql/add_company_scope_documents_legal.sql` (idempotent)
     attributes existing rows from:
     - the only company, on single-company installs
     - folder ancestry
     - the linked contract, invoice, partner, employee, asset, opportunity or
       proposal
     - a legal case's partner
   - Unattributable rows stay hidden from company users and are counted for
     manual assignment.
3. **Global catalogs follow the permission matrix**
   (`docs/10-permission-matrix.md`):
   - Creating roles and editing email templates now requires a system
     administrator, via a new `@SystemAdminOnly()` guard. The web app hides
     template editing for everyone else.
   - Knowledge articles stay a group-wide wiki on purpose: search indexes them
     as `shared`, and publishing requires `knowledge.articles.approve`.
4. **Company and office changes** must target the active company, which is
   where the caller's permissions were resolved. Being a plain member of
   another company no longer carries admin rights over to it.
5. **Tokens no longer live in `localStorage`.**
   - The refresh token is an httpOnly, `SameSite=Strict` cookie on
     `/api/v1/auth`. The access token is kept in memory and restored from the
     cookie on reload.
   - Sessions saved by older builds are exchanged for the cookie once.
   - Non-browser clients can opt into body tokens with
     `X-Auth-Transport: body`.
   - SSO no longer puts tokens in the URL.
6. **The OIDC state is a short-lived httpOnly cookie** compared in constant
   time, so SSO works with any number of API replicas.
   - The RBAC permission cache stays in-process. With several replicas, a role
     change made on one replica reaches the others within its 60 s TTL.
7. **Lint works.**
   - ESLint 9 and typescript-eslint use a shared flat config
     (`eslint.config.mjs`).
   - The five real findings are fixed.
   - `pnpm lint` runs in CI.
8. **`test/records-crud.postgres.ts` passes.** Asset categories were only
   seeded in demo mode, so on a real install no asset could be created (the
   category is required). They are now seeded as reference data.

Verification:
- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass.
- All 67 Playwright e2e tests pass.
- These PostgreSQL suites pass:
  - `tenant-isolation` (now also covering documents, legal, insurance,
    catalogs and company settings)
  - `records-crud`
  - `org-chart --http`
  - `company-calendar.integration`
