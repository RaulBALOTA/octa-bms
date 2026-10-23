-- Idempotent module-only permission setup. Does not seed users or demo data.
BEGIN;
INSERT INTO "permissions" ("id", "code", "module", "resource", "action", "name")
SELECT 'calendar-items-' || action, 'calendar.items.' || action, 'calendar', 'items', action,
       action || ' company calendar items'
FROM unnest(ARRAY['read','create','update','delete','approve','export']) AS action
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."deletedAt" IS NULL AND p."module" = 'calendar' AND (
  r."code" IN ('SYSTEM_ADMIN', 'MANAGING_DIRECTOR') OR
  (r."code" IN ('SALES_MANAGER', 'FINANCE_MANAGER', 'HR_MANAGER', 'EMPLOYEE') AND p."action" IN ('read','create','update'))
)
ON CONFLICT DO NOTHING;
COMMIT;
