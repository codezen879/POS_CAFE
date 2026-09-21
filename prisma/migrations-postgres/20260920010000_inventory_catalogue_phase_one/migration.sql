-- Outlet-owned inventory catalogue and FIFO opening layers for PostgreSQL/Supabase.
--
-- Run after 20260914010000_inventory_master_data. This cutover preserves the
-- legacy Ingredient catalogue for recipes, but StoreIngredient becomes the
-- canonical outlet-owned inventory product. Existing suppliers are copied to
-- every outlet before their operational references are changed to composite
-- outlet-safe foreign keys.

BEGIN;

DO $phase_one_prerequisite_guard$
BEGIN
  IF EXISTS (SELECT 1 FROM "suppliers")
     AND NOT EXISTS (SELECT 1 FROM "stores") THEN
    RAISE EXCEPTION 'At least one store is required to scope legacy suppliers';
  END IF;
END
$phase_one_prerequisite_guard$;

CREATE TABLE IF NOT EXISTS "inventory_categories" (
  "id"          TEXT         NOT NULL,
  "storeId"     TEXT         NOT NULL,
  "name"        TEXT         NOT NULL,
  "nameKey"     TEXT         NOT NULL,
  "description" TEXT,
  "sortOrder"   INTEGER      NOT NULL DEFAULT 0,
  "isActive"    BOOLEAN      NOT NULL DEFAULT true,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "inventory_categories_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_categories_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "inventory_categories_name_check"
    CHECK (btrim("name") <> '' AND btrim("nameKey") <> ''),
  CONSTRAINT "inventory_categories_sortOrder_check" CHECK ("sortOrder" >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS "inventory_categories_id_storeId_key"
  ON "inventory_categories"("id", "storeId");
CREATE UNIQUE INDEX IF NOT EXISTS "inventory_categories_storeId_nameKey_key"
  ON "inventory_categories"("storeId", "nameKey");
CREATE INDEX IF NOT EXISTS "inventory_categories_storeId_isActive_sortOrder_idx"
  ON "inventory_categories"("storeId", "isActive", "sortOrder");

INSERT INTO "inventory_categories" (
  "id", "storeId", "name", "nameKey", "description", "sortOrder",
  "isActive", "createdAt", "updatedAt"
)
SELECT
  'icat_uncategorized_' || md5(store."id"),
  store."id",
  'Uncategorized',
  'uncategorized',
  'Items migrated before inventory categories were introduced',
  0,
  true,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "stores" AS store
ON CONFLICT ("storeId", "nameKey") DO NOTHING;

ALTER TABLE "store_ingredients"
  ADD COLUMN IF NOT EXISTS "name" TEXT,
  ADD COLUMN IF NOT EXISTS "nameKey" TEXT,
  ADD COLUMN IF NOT EXISTS "unit" TEXT,
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT,
  ADD COLUMN IF NOT EXISTS "dailyStockTracking" BOOLEAN NOT NULL DEFAULT false;

UPDATE "store_ingredients" AS store_ingredient
SET
  "name" = COALESCE(NULLIF(btrim(store_ingredient."name"), ''), ingredient."name"),
  "unit" = COALESCE(NULLIF(btrim(store_ingredient."unit"), ''), ingredient."unit"),
  "categoryId" = COALESCE(store_ingredient."categoryId", category."id")
FROM "ingredients" AS ingredient,
     "inventory_categories" AS category
WHERE ingredient."id" = store_ingredient."ingredientId"
  AND category."storeId" = store_ingredient."storeId"
  AND category."nameKey" = 'uncategorized';

WITH normalized AS (
  SELECT
    store_ingredient."id",
    store_ingredient."storeId",
    left(
      COALESCE(
        NULLIF(
          lower(regexp_replace(btrim(store_ingredient."name"), '[[:space:]]+', ' ', 'g')),
          ''
        ),
        'inventory-item'
      ),
      170
    ) AS base_key
  FROM "store_ingredients" AS store_ingredient
), ranked AS (
  SELECT
    normalized.*,
    row_number() OVER (
      PARTITION BY normalized."storeId", normalized.base_key
      ORDER BY normalized."id"
    ) AS duplicate_number
  FROM normalized
), resolved AS (
  SELECT
    ranked."id",
    CASE
      WHEN ranked.duplicate_number = 1 THEN ranked.base_key
      ELSE ranked.base_key || '--legacy-' || left(md5(ranked."id"), 12)
    END AS resolved_key
  FROM ranked
)
UPDATE "store_ingredients" AS store_ingredient
SET "nameKey" = resolved.resolved_key
FROM resolved
WHERE resolved."id" = store_ingredient."id"
  AND (store_ingredient."nameKey" IS NULL OR btrim(store_ingredient."nameKey") = '');

DO $store_ingredient_catalogue_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "store_ingredients"
    WHERE "name" IS NULL OR btrim("name") = ''
       OR "nameKey" IS NULL OR btrim("nameKey") = ''
       OR "unit" IS NULL OR btrim("unit") = ''
       OR "categoryId" IS NULL
  ) THEN
    RAISE EXCEPTION 'Store ingredient catalogue backfill is incomplete';
  END IF;
END
$store_ingredient_catalogue_guard$;

ALTER TABLE "store_ingredients"
  ALTER COLUMN "name" SET NOT NULL,
  ALTER COLUMN "nameKey" SET NOT NULL,
  ALTER COLUMN "unit" SET NOT NULL,
  ALTER COLUMN "categoryId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "store_ingredients_storeId_nameKey_key"
  ON "store_ingredients"("storeId", "nameKey");
CREATE INDEX IF NOT EXISTS "store_ingredients_storeId_categoryId_isActive_idx"
  ON "store_ingredients"("storeId", "categoryId", "isActive");

DO $store_ingredient_catalogue_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_ingredients_categoryId_storeId_fkey'
      AND conrelid = 'store_ingredients'::regclass
  ) THEN
    ALTER TABLE "store_ingredients"
      ADD CONSTRAINT "store_ingredients_categoryId_storeId_fkey"
      FOREIGN KEY ("categoryId", "storeId")
      REFERENCES "inventory_categories"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_ingredients_catalogue_text_check'
      AND conrelid = 'store_ingredients'::regclass
  ) THEN
    ALTER TABLE "store_ingredients"
      ADD CONSTRAINT "store_ingredients_catalogue_text_check"
      CHECK (btrim("name") <> '' AND btrim("nameKey") <> '' AND btrim("unit") <> '');
  END IF;
END
$store_ingredient_catalogue_constraints$;

-- Scope the formerly global supplier catalogue. Each original row is retained
-- for the first referenced outlet (or the first store when it was unreferenced)
-- so Ingredient.supplierId stays valid. Deterministic copies serve the other
-- outlets.
ALTER TABLE "suppliers"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT,
  ADD COLUMN IF NOT EXISTS "nameKey" TEXT;

WITH normalized AS (
  SELECT
    supplier."id",
    left(
      COALESCE(
        NULLIF(lower(regexp_replace(btrim(supplier."name"), '[[:space:]]+', ' ', 'g')), ''),
        'supplier'
      ),
      170
    ) AS base_key
  FROM "suppliers" AS supplier
  WHERE supplier."storeId" IS NULL
), ranked AS (
  SELECT
    normalized.*,
    row_number() OVER (PARTITION BY normalized.base_key ORDER BY normalized."id") AS duplicate_number
  FROM normalized
)
UPDATE "suppliers" AS supplier
SET "nameKey" = CASE
  WHEN ranked.duplicate_number = 1 THEN ranked.base_key
  ELSE ranked.base_key || '--legacy-' || left(md5(ranked."id"), 12)
END
FROM ranked
WHERE ranked."id" = supplier."id"
  AND (supplier."nameKey" IS NULL OR btrim(supplier."nameKey") = '');

WITH supplier_references AS (
  SELECT "preferredSupplierId" AS supplier_id, "storeId" AS store_id
  FROM "store_ingredients"
  WHERE "preferredSupplierId" IS NOT NULL
  UNION ALL
  SELECT "supplierId" AS supplier_id, "storeId" AS store_id
  FROM "stock_movements"
  WHERE "supplierId" IS NOT NULL
), supplier_primary AS (
  SELECT
    supplier."id" AS supplier_id,
    COALESCE(MIN(supplier_reference.store_id), (SELECT MIN(store."id") FROM "stores" AS store)) AS primary_store_id
  FROM "suppliers" AS supplier
  LEFT JOIN supplier_references AS supplier_reference
    ON supplier_reference.supplier_id = supplier."id"
  WHERE supplier."storeId" IS NULL
  GROUP BY supplier."id"
)
INSERT INTO "suppliers" (
  "id", "storeId", "name", "nameKey", "contact", "phone", "email",
  "address", "isActive", "createdAt"
)
SELECT
  'sup_scope_' || md5(source_supplier."id" || ':' || store."id"),
  store."id",
  source_supplier."name",
  source_supplier."nameKey",
  source_supplier."contact",
  source_supplier."phone",
  source_supplier."email",
  source_supplier."address",
  source_supplier."isActive",
  source_supplier."createdAt"
FROM supplier_primary AS primary_store
INNER JOIN "suppliers" AS source_supplier
  ON source_supplier."id" = primary_store.supplier_id
CROSS JOIN "stores" AS store
WHERE source_supplier."storeId" IS NULL
  AND store."id" <> primary_store.primary_store_id
ON CONFLICT ("id") DO NOTHING;

WITH supplier_references AS (
  SELECT "preferredSupplierId" AS supplier_id, "storeId" AS store_id
  FROM "store_ingredients"
  WHERE "preferredSupplierId" IS NOT NULL
  UNION ALL
  SELECT "supplierId" AS supplier_id, "storeId" AS store_id
  FROM "stock_movements"
  WHERE "supplierId" IS NOT NULL
), supplier_primary AS (
  SELECT
    supplier."id" AS supplier_id,
    COALESCE(MIN(supplier_reference.store_id), (SELECT MIN(store."id") FROM "stores" AS store)) AS primary_store_id
  FROM "suppliers" AS supplier
  LEFT JOIN supplier_references AS supplier_reference
    ON supplier_reference.supplier_id = supplier."id"
  WHERE supplier."storeId" IS NULL
  GROUP BY supplier."id"
)
UPDATE "store_ingredients" AS store_ingredient
SET "preferredSupplierId" = scoped_supplier."id"
FROM supplier_primary AS primary_store,
     "suppliers" AS scoped_supplier
WHERE primary_store.supplier_id = store_ingredient."preferredSupplierId"
  AND store_ingredient."storeId" <> primary_store.primary_store_id
  AND scoped_supplier."id" = 'sup_scope_' || md5(primary_store.supplier_id || ':' || store_ingredient."storeId");

WITH supplier_references AS (
  SELECT "preferredSupplierId" AS supplier_id, "storeId" AS store_id
  FROM "store_ingredients"
  WHERE "preferredSupplierId" IS NOT NULL
  UNION ALL
  SELECT "supplierId" AS supplier_id, "storeId" AS store_id
  FROM "stock_movements"
  WHERE "supplierId" IS NOT NULL
), supplier_primary AS (
  SELECT
    supplier."id" AS supplier_id,
    COALESCE(MIN(supplier_reference.store_id), (SELECT MIN(store."id") FROM "stores" AS store)) AS primary_store_id
  FROM "suppliers" AS supplier
  LEFT JOIN supplier_references AS supplier_reference
    ON supplier_reference.supplier_id = supplier."id"
  WHERE supplier."storeId" IS NULL
  GROUP BY supplier."id"
)
UPDATE "stock_movements" AS movement
SET "supplierId" = scoped_supplier."id"
FROM supplier_primary AS primary_store,
     "suppliers" AS scoped_supplier
WHERE primary_store.supplier_id = movement."supplierId"
  AND movement."storeId" <> primary_store.primary_store_id
  AND scoped_supplier."id" = 'sup_scope_' || md5(primary_store.supplier_id || ':' || movement."storeId");

WITH supplier_references AS (
  SELECT "preferredSupplierId" AS supplier_id, "storeId" AS store_id
  FROM "store_ingredients"
  WHERE "preferredSupplierId" IS NOT NULL
  UNION ALL
  SELECT "supplierId" AS supplier_id, "storeId" AS store_id
  FROM "stock_movements"
  WHERE "supplierId" IS NOT NULL
), supplier_primary AS (
  SELECT
    supplier."id" AS supplier_id,
    COALESCE(MIN(supplier_reference.store_id), (SELECT MIN(store."id") FROM "stores" AS store)) AS primary_store_id
  FROM "suppliers" AS supplier
  LEFT JOIN supplier_references AS supplier_reference
    ON supplier_reference.supplier_id = supplier."id"
  WHERE supplier."storeId" IS NULL
  GROUP BY supplier."id"
)
UPDATE "suppliers" AS supplier
SET "storeId" = primary_store.primary_store_id
FROM supplier_primary AS primary_store
WHERE supplier."id" = primary_store.supplier_id;

DO $supplier_scope_guard$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "suppliers"
    WHERE "storeId" IS NULL OR "nameKey" IS NULL OR btrim("nameKey") = ''
  ) THEN
    RAISE EXCEPTION 'Supplier outlet/name-key backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "suppliers" AS supplier
      ON supplier."id" = store_ingredient."preferredSupplierId"
     AND supplier."storeId" = store_ingredient."storeId"
    WHERE store_ingredient."preferredSupplierId" IS NOT NULL
      AND supplier."id" IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM "stock_movements" AS movement
    LEFT JOIN "suppliers" AS supplier
      ON supplier."id" = movement."supplierId"
     AND supplier."storeId" = movement."storeId"
    WHERE movement."supplierId" IS NOT NULL
      AND supplier."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'A supplier reference could not be scoped to its outlet';
  END IF;
END
$supplier_scope_guard$;

ALTER TABLE "suppliers"
  ALTER COLUMN "storeId" SET NOT NULL,
  ALTER COLUMN "nameKey" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_id_storeId_key"
  ON "suppliers"("id", "storeId");
CREATE UNIQUE INDEX IF NOT EXISTS "suppliers_storeId_nameKey_key"
  ON "suppliers"("storeId", "nameKey");
CREATE INDEX IF NOT EXISTS "suppliers_storeId_isActive_name_idx"
  ON "suppliers"("storeId", "isActive", "name");
CREATE INDEX IF NOT EXISTS "store_ingredients_preferredSupplierId_storeId_idx"
  ON "store_ingredients"("preferredSupplierId", "storeId");
CREATE INDEX IF NOT EXISTS "stock_movements_supplierId_storeId_idx"
  ON "stock_movements"("supplierId", "storeId");

ALTER TABLE "store_ingredients"
  DROP CONSTRAINT IF EXISTS "store_ingredients_preferredSupplierId_fkey";
ALTER TABLE "stock_movements"
  DROP CONSTRAINT IF EXISTS "stock_movements_supplierId_fkey";

DO $supplier_scope_constraints$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'suppliers_storeId_fkey'
      AND conrelid = 'suppliers'::regclass
  ) THEN
    ALTER TABLE "suppliers"
      ADD CONSTRAINT "suppliers_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "stores"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'store_ingredients_preferredSupplierId_storeId_fkey'
      AND conrelid = 'store_ingredients'::regclass
  ) THEN
    ALTER TABLE "store_ingredients"
      ADD CONSTRAINT "store_ingredients_preferredSupplierId_storeId_fkey"
      FOREIGN KEY ("preferredSupplierId", "storeId")
      REFERENCES "suppliers"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'stock_movements_supplierId_storeId_fkey'
      AND conrelid = 'stock_movements'::regclass
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_supplierId_storeId_fkey"
      FOREIGN KEY ("supplierId", "storeId")
      REFERENCES "suppliers"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$supplier_scope_constraints$;

CREATE TABLE IF NOT EXISTS "inventory_stock_layers" (
  "id"                TEXT           NOT NULL,
  "storeId"           TEXT           NOT NULL,
  "storeIngredientId" TEXT           NOT NULL,
  "sourceMovementId"  TEXT,
  "sourceType"        TEXT           NOT NULL,
  "openingKey"        TEXT,
  "originalQty"       DECIMAL(12, 3) NOT NULL,
  "remainingQty"      DECIMAL(12, 3) NOT NULL,
  "unitCost"          DECIMAL(10, 2) NOT NULL,
  "receivedAt"        TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version"           INTEGER        NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "inventory_stock_layers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "inventory_stock_layers_sourceMovementId_key" UNIQUE ("sourceMovementId"),
  CONSTRAINT "inventory_stock_layers_openingKey_key" UNIQUE ("openingKey"),
  CONSTRAINT "inventory_stock_layers_storeIngredientId_storeId_fkey"
    FOREIGN KEY ("storeIngredientId", "storeId")
    REFERENCES "store_ingredients"("id", "storeId")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "inventory_stock_layers_sourceMovementId_fkey"
    FOREIGN KEY ("sourceMovementId") REFERENCES "stock_movements"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "inventory_stock_layers_quantity_check"
    CHECK ("originalQty" > 0 AND "remainingQty" >= 0 AND "remainingQty" <= "originalQty"),
  CONSTRAINT "inventory_stock_layers_unitCost_check" CHECK ("unitCost" >= 0),
  CONSTRAINT "inventory_stock_layers_sourceType_check" CHECK (btrim("sourceType") <> '')
);

-- The second FIFO index is also the durable completion marker. On a complete
-- rerun it prevents current, post-migration stock from becoming a second
-- migration opening layer.
INSERT INTO "inventory_stock_layers" (
  "id", "storeId", "storeIngredientId", "sourceMovementId", "sourceType",
  "openingKey", "originalQty", "remainingQty", "unitCost", "receivedAt",
  "version", "createdAt", "updatedAt"
)
SELECT
  'isl_migration_' || md5(store_ingredient."id"),
  store_ingredient."storeId",
  store_ingredient."id",
  NULL,
  'MIGRATION_OPENING',
  'migration-opening:' || md5(store_ingredient."id"),
  store_ingredient."stockQty",
  store_ingredient."stockQty",
  GREATEST(
    COALESCE(
      store_ingredient."costPerUnit",
      (
        SELECT movement."unitCost"
        FROM "stock_movements" AS movement
        WHERE movement."storeId" = store_ingredient."storeId"
          AND movement."storeIngredientId" = store_ingredient."id"
          AND movement."unitCost" IS NOT NULL
        ORDER BY movement."createdAt" DESC, movement."id" DESC
        LIMIT 1
      ),
      ingredient."costPerUnit",
      0
    ),
    0
  ),
  CURRENT_TIMESTAMP,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "store_ingredients" AS store_ingredient
INNER JOIN "ingredients" AS ingredient
  ON ingredient."id" = store_ingredient."ingredientId"
WHERE store_ingredient."stockQty" > 0
  AND NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'inventory_stock_layers'
      AND indexname = 'inventory_stock_layers_store_item_remaining_idx'
  )
ON CONFLICT ("openingKey") DO NOTHING;

CREATE INDEX IF NOT EXISTS "inventory_stock_layers_storeIngredientId_receivedAt_id_idx"
  ON "inventory_stock_layers"("storeIngredientId", "receivedAt", "id");
CREATE INDEX IF NOT EXISTS "inventory_stock_layers_store_item_remaining_idx"
  ON "inventory_stock_layers"("storeId", "storeIngredientId", "remainingQty");

DO $phase_one_final_guard$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "inventory_categories" AS category
      ON category."id" = store_ingredient."categoryId"
     AND category."storeId" = store_ingredient."storeId"
    WHERE category."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'An inventory product has an invalid outlet category';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "inventory_stock_layers" AS layer
      ON layer."storeIngredientId" = store_ingredient."id"
     AND layer."storeId" = store_ingredient."storeId"
    WHERE store_ingredient."stockQty" > 0
      AND layer."id" IS NULL
  ) THEN
    RAISE EXCEPTION 'A positive balance is missing its FIFO stock layer';
  END IF;
END
$phase_one_final_guard$;

COMMIT;

-- Supabase SQL Editor confirmation. migration_complete should be true and the
-- three error counts should be 0. zero_cost_legacy_layers is informational:
-- legacy rows without any trustworthy cost are retained at zero cost.
SELECT
  (
    to_regclass('public.inventory_categories') IS NOT NULL
    AND to_regclass('public.inventory_stock_layers') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'inventory_stock_layers'
        AND indexname = 'inventory_stock_layers_store_item_remaining_idx'
    )
    AND (
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'store_ingredients'
        AND column_name IN ('name', 'nameKey', 'unit', 'categoryId')
        AND is_nullable = 'NO'
    ) = 4
    AND (
      SELECT COUNT(*) FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'suppliers'
        AND column_name IN ('storeId', 'nameKey')
        AND is_nullable = 'NO'
    ) = 2
    AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'store_ingredients_categoryId_storeId_fkey'
        AND conrelid = 'store_ingredients'::regclass
        AND contype = 'f'
        AND convalidated
    )
    AND EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = 'stock_movements_supplierId_storeId_fkey'
        AND conrelid = 'stock_movements'::regclass
        AND contype = 'f'
        AND convalidated
    )
  ) AS migration_complete,
  (
    SELECT COUNT(*)
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "inventory_categories" AS category
      ON category."id" = store_ingredient."categoryId"
     AND category."storeId" = store_ingredient."storeId"
    WHERE category."id" IS NULL
  ) AS invalid_category_links,
  (
    SELECT COUNT(*)
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "inventory_stock_layers" AS layer
      ON layer."storeIngredientId" = store_ingredient."id"
     AND layer."storeId" = store_ingredient."storeId"
    WHERE store_ingredient."stockQty" > 0
      AND layer."id" IS NULL
  ) AS missing_opening_layers,
  (
    SELECT COUNT(*)
    FROM "inventory_stock_layers"
    WHERE "sourceType" = 'MIGRATION_OPENING'
      AND "unitCost" = 0
  ) AS zero_cost_legacy_layers,
  (
    SELECT COUNT(*)
    FROM "stock_movements" AS movement
    LEFT JOIN "suppliers" AS supplier
      ON supplier."id" = movement."supplierId"
     AND supplier."storeId" = movement."storeId"
    WHERE movement."supplierId" IS NOT NULL
      AND supplier."id" IS NULL
  ) AS invalid_supplier_links;
