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

## Open — needs a product or schema decision

1. **Documents are not company-scoped.**
   - `Document` has no `companyId`, `Folder.companyId` is optional and never
     set, and every document and folder endpoint is global. This includes
     downloads of contract files.
   - Recommended: add `companyId` to `Document`, set it on folders, backfill
     from `Folder` / `entityType`+`entityId`, then scope every endpoint.
2. **Legal and insurance are not company-scoped.** `LegalCase`,
   `ComplianceItem`, `DataProcessingActivity`, `WhistleblowerReport`,
   `ProfessionalLicense` and `InsurancePolicy` have no `companyId`. They need
   the same migration as documents.
3. **Global catalogs are editable by any company's admin.** This applies to
   `EmailTemplate`, knowledge articles and categories, and `Role` creation
   with any permission codes. Decide whether these are group-wide (then
   require a system admin) or per company (then add `companyId`).
4. **Office endpoints check the wrong company.**
   `master/companies/:companyId/offices*` checks membership of the route
   company, but permissions are resolved for the `X-Company-Id` company.
5. **Tokens live in `localStorage`.** Any XSS exposes them. Consider httpOnly
   refresh cookies.
6. **The OIDC state store is in-process.** SSO breaks behind more than one
   API replica. Move it to Redis together with the RBAC cache.
7. **`pnpm lint` cannot run.** ESLint is not installed and there is no
   config. CI does not run lint.
8. **`test/records-crud.postgres.ts` fails** on `assets.categoryId` with no
   reference data. This predates the audit.
