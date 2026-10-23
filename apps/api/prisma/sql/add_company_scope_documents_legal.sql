-- Company ownership for documents, folders, legal records and insurance policies.
--
-- Adds a nullable "companyId" to every table that lacked one and attributes
-- existing rows where the owner is unambiguous:
--   * a database with exactly one company: every row belongs to it
--   * folders: inherited from the nearest attributed ancestor
--   * documents: from their folder, else from the contract/invoice/partner/
--     employee/asset/opportunity/proposal they are linked to
--   * legal cases: from their business partner
-- Rows that stay NULL are hidden from company users (system administrators
-- still see them under Data management). The final SELECT counts them;
-- assign each one explicitly, e.g.
--   UPDATE "documents" SET "companyId" = '<company id>' WHERE "id" IN (...);
-- Idempotent: safe to run again.
BEGIN;

ALTER TABLE "folders"                    ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "documents"                  ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "legal_cases"                ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "compliance_items"           ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "data_processing_activities" ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "whistleblower_reports"      ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "professional_licenses"      ADD COLUMN IF NOT EXISTS "companyId" TEXT;
ALTER TABLE "insurance_policies"         ADD COLUMN IF NOT EXISTS "companyId" TEXT;

DO $$
DECLARE
  tbl TEXT;
  only_company TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['folders','documents','legal_cases','compliance_items',
    'data_processing_activities','whistleblower_reports','professional_licenses','insurance_policies']
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_companyId_fkey') THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE',
        tbl, tbl || '_companyId_fkey');
    END IF;
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %I ("companyId")', tbl || '_companyId_idx', tbl);
  END LOOP;

  -- single-company installations: everything belongs to that company
  IF (SELECT count(*) FROM "companies") = 1 THEN
    SELECT "id" INTO only_company FROM "companies";
    FOREACH tbl IN ARRAY ARRAY['folders','documents','legal_cases','compliance_items',
      'data_processing_activities','whistleblower_reports','professional_licenses','insurance_policies']
    LOOP
      EXECUTE format('UPDATE %I SET "companyId" = $1 WHERE "companyId" IS NULL', tbl) USING only_company;
    END LOOP;
  END IF;
END $$;

-- folders inherit from their nearest attributed ancestor
WITH RECURSIVE tree AS (
  SELECT "id", "companyId" FROM "folders" WHERE "companyId" IS NOT NULL
  UNION ALL
  SELECT f."id", t."companyId" FROM "folders" f JOIN tree t ON f."parentId" = t."id" WHERE f."companyId" IS NULL
)
UPDATE "folders" f SET "companyId" = t."companyId" FROM tree t
WHERE f."id" = t."id" AND f."companyId" IS NULL;

-- documents: folder first, then the linked business record
UPDATE "documents" d SET "companyId" = f."companyId"
FROM "folders" f WHERE d."folderId" = f."id" AND d."companyId" IS NULL AND f."companyId" IS NOT NULL;
UPDATE "documents" d SET "companyId" = c."companyId" FROM "contracts" c
WHERE d."companyId" IS NULL AND d."entityType" = 'contract' AND d."entityId" = c."id";
UPDATE "documents" d SET "companyId" = i."companyId" FROM "invoices" i
WHERE d."companyId" IS NULL AND d."entityType" = 'invoice' AND d."entityId" = i."id";
UPDATE "documents" d SET "companyId" = p."companyId" FROM "business_partners" p
WHERE d."companyId" IS NULL AND d."entityType" IN ('partner', 'businessPartner') AND d."entityId" = p."id";
UPDATE "documents" d SET "companyId" = e."companyId" FROM "employees" e
WHERE d."companyId" IS NULL AND d."entityType" = 'employee' AND d."entityId" = e."id";
UPDATE "documents" d SET "companyId" = a."companyId" FROM "assets" a
WHERE d."companyId" IS NULL AND d."entityType" = 'asset' AND d."entityId" = a."id";
UPDATE "documents" d SET "companyId" = o."companyId" FROM "opportunities" o
WHERE d."companyId" IS NULL AND d."entityType" = 'opportunity' AND d."entityId" = o."id";
UPDATE "documents" d SET "companyId" = p."companyId" FROM "proposals" p
WHERE d."companyId" IS NULL AND d."entityType" = 'proposal' AND d."entityId" = p."id";

-- legal cases: from their counterparty
UPDATE "legal_cases" l SET "companyId" = p."companyId" FROM "business_partners" p
WHERE l."companyId" IS NULL AND l."partnerId" = p."id";

COMMIT;

-- rows that still need a company (assign them as shown at the top)
SELECT 'folders' AS "table", count(*) AS unassigned FROM "folders" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'documents', count(*) FROM "documents" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'legal_cases', count(*) FROM "legal_cases" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'compliance_items', count(*) FROM "compliance_items" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'data_processing_activities', count(*) FROM "data_processing_activities" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'whistleblower_reports', count(*) FROM "whistleblower_reports" WHERE "companyId" IS NULL
UNION ALL SELECT 'professional_licenses', count(*) FROM "professional_licenses" WHERE "companyId" IS NULL AND "deletedAt" IS NULL
UNION ALL SELECT 'insurance_policies', count(*) FROM "insurance_policies" WHERE "companyId" IS NULL AND "deletedAt" IS NULL;
