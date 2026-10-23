-- Optional document titles. Existing filenames, versions and file contents are unchanged.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "title" TEXT;
