-- Idempotent module-only permission setup for the Business Engine. Does not seed users or business data.
-- Resources: services, resources, portfolio, economics (confidential cost/margin data), scenarios,
-- optimization, intelligence (alerts, actions, recommendations, decisions), settings.
BEGIN;
INSERT INTO "permissions" ("id", "code", "module", "resource", "action", "name")
SELECT 'engine-' || resource || '-' || action, 'engine.' || resource || '.' || action, 'engine', resource, action,
       action || ' ' || resource || ' (engine)'
FROM unnest(ARRAY['services','resources','portfolio','economics','scenarios','optimization','intelligence','settings']) AS resource
CROSS JOIN unnest(ARRAY['read','create','update','delete','approve','export']) AS action
ON CONFLICT ("code") DO NOTHING;

INSERT INTO "role_permissions" ("roleId", "permissionId")
SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
WHERE r."deletedAt" IS NULL AND p."module" = 'engine' AND (
  r."code" IN ('SYSTEM_ADMIN', 'MANAGING_DIRECTOR') OR
  (r."code" = 'FINANCE_MANAGER' AND (p."resource" IN ('economics','scenarios','optimization','intelligence','portfolio') OR p."action" = 'read')) OR
  (r."code" = 'SALES_MANAGER' AND (
     (p."resource" IN ('services','portfolio') AND p."action" IN ('read','create','update')) OR
     (p."resource" IN ('scenarios','intelligence') AND p."action" = 'read'))) OR
  (r."code" = 'HR_MANAGER' AND p."resource" = 'resources' AND p."action" IN ('read','create','update'))
)
ON CONFLICT DO NOTHING;
COMMIT;
