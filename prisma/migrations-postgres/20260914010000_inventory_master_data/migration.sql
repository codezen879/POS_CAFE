-- Inventory master-data lifecycle support for PostgreSQL/Supabase.
-- This migration is additive, preserves every existing row, and is safe to rerun.

BEGIN;

ALTER TABLE "ingredients"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "ingredients"
SET "isActive" = true
WHERE "isActive" IS NULL;

ALTER TABLE "ingredients"
  ALTER COLUMN "isActive" SET DEFAULT true,
  ALTER COLUMN "isActive" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ingredients_isActive_name_idx"
  ON "ingredients"("isActive", "name");

CREATE INDEX IF NOT EXISTS "suppliers_isActive_name_idx"
  ON "suppliers"("isActive", "name");

COMMIT;

-- Supabase SQL Editor confirmation. A successful migration returns true / 0.
SELECT
  (
    EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ingredients'
        AND column_name = 'isActive'
        AND is_nullable = 'NO'
    )
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'ingredients'
        AND indexname = 'ingredients_isActive_name_idx'
    )
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'suppliers'
        AND indexname = 'suppliers_isActive_name_idx'
    )
  ) AS migration_complete,
  (SELECT COUNT(*) FROM "ingredients" WHERE "isActive" IS NULL) AS invalid_status_rows;
