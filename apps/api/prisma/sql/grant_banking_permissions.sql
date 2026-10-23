-- Idempotent permission setup for bank connections. Does not seed users or demo data.
BEGIN;
INSERT INTO "permissions" ("id", "code", "module", "resource", "action", "name")
SELECT 'finance-banking-' || action, 'finance.banking.' || action, 'finance', 'banking', action,
       action || ' banking (finance)'
FROM unnest(ARRAY['read','create','update','delete','approve','export']) AS action
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."deletedAt" IS NULL AND p."module" = 'finance' AND p."resource" = 'banking' AND (
  r."code" IN ('SYSTEM_ADMIN', 'FINANCE_MANAGER') OR
  (r."code" = 'MANAGING_DIRECTOR' AND p."action" IN ('read','approve','export'))
)
ON CONFLICT DO NOTHING;
COMMIT;
