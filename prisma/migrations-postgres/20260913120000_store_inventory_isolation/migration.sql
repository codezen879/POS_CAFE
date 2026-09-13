-- Per-store inventory isolation for the Vercel/Supabase PostgreSQL database.
--
-- This is a manual cutover migration. Run it immediately before deploying the
-- matching application version because StockMovement.storeId and
-- StockMovement.storeIngredientId become required by the end of the script.
-- It intentionally keeps the legacy Ingredient stock/config columns and the
-- StockMovement.ingredientId relation for rollback compatibility.
--
-- Legacy ownership assumption: every existing balance and movement belongs to
-- store-main. Every other existing store receives a zero opening balance. If
-- that assumption is not true, stop and replace this backfill with a physical
-- per-store count/allocation before running the migration.

BEGIN;

-- A completed composite movement FK is the durable completion marker. Every
-- guarded statement checks that marker directly instead of relying on a
-- temporary table, because selected fragments or separate SQL Editor runs do
-- not share temporary-table session state.
-- On a full rerun, data backfill statements are skipped so a later catalogue
-- row can never inherit a stale legacy Ingredient.stockQty value.

DO $inventory_guard$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "stores" WHERE "id" = 'store-main') THEN
    RAISE EXCEPTION 'store-main is required for the legacy inventory backfill';
  END IF;
END
$inventory_guard$;

CREATE TABLE IF NOT EXISTS "store_ingredients" (
  "id"                    TEXT           NOT NULL,
  "storeId"               TEXT           NOT NULL,
  "ingredientId"          TEXT           NOT NULL,
  "stockQty"              DECIMAL(12, 3) NOT NULL DEFAULT 0,
  "reorderLevel"          DECIMAL(12, 3) NOT NULL DEFAULT 0,
  "costPerUnit"           DECIMAL(10, 2),
  "preferredSupplierId"   TEXT,
  "isActive"              BOOLEAN        NOT NULL DEFAULT true,
  "version"               INTEGER        NOT NULL DEFAULT 0,
  "createdAt"             TIMESTAMP(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)   NOT NULL,
  CONSTRAINT "store_ingredients_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "store_ingredients_storeId_fkey"
    FOREIGN KEY ("storeId") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "store_ingredients_ingredientId_fkey"
    FOREIGN KEY ("ingredientId") REFERENCES "ingredients"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "store_ingredients_preferredSupplierId_fkey"
    FOREIGN KEY ("preferredSupplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "store_ingredients_storeId_ingredientId_key"
  ON "store_ingredients"("storeId", "ingredientId");
CREATE UNIQUE INDEX IF NOT EXISTS "store_ingredients_id_storeId_key"
  ON "store_ingredients"("id", "storeId");
CREATE INDEX IF NOT EXISTS "store_ingredients_ingredientId_idx"
  ON "store_ingredients"("ingredientId");
CREATE INDEX IF NOT EXISTS "store_ingredients_preferredSupplierId_idx"
  ON "store_ingredients"("preferredSupplierId");
CREATE INDEX IF NOT EXISTS "store_ingredients_storeId_stockQty_idx"
  ON "store_ingredients"("storeId", "stockQty");

-- Create an outlet configuration for every current store and ingredient. Only
-- store-main inherits the legacy operational quantity; all other stores start
-- at zero. Re-running this INSERT never resets an existing outlet balance.
INSERT INTO "store_ingredients" (
  "id",
  "storeId",
  "ingredientId",
  "stockQty",
  "reorderLevel",
  "costPerUnit",
  "preferredSupplierId",
  "isActive",
  "version",
  "createdAt",
  "updatedAt"
)
SELECT
  'sii_' || md5(store."id" || ':' || ingredient."id"),
  store."id",
  ingredient."id",
  CASE WHEN store."id" = 'store-main' THEN ingredient."stockQty" ELSE 0 END,
  ingredient."reorderLevel",
  ingredient."costPerUnit",
  ingredient."supplierId",
  true,
  0,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "stores" AS store
CROSS JOIN "ingredients" AS ingredient
WHERE NOT EXISTS (
  SELECT 1
  FROM pg_constraint
  WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
    AND conrelid = 'stock_movements'::regclass
    AND contype = 'f'
    AND convalidated
)
ON CONFLICT ("storeId", "ingredientId") DO NOTHING;

DO $inventory_coverage_guard$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
         AND conrelid = 'stock_movements'::regclass
         AND contype = 'f'
         AND convalidated
     )
     AND EXISTS (
       SELECT 1
       FROM "stores" AS store
       CROSS JOIN "ingredients" AS ingredient
       LEFT JOIN "store_ingredients" AS store_ingredient
         ON store_ingredient."storeId" = store."id"
        AND store_ingredient."ingredientId" = ingredient."id"
       WHERE store_ingredient."id" IS NULL
     ) THEN
    RAISE EXCEPTION 'Some store/ingredient balance rows could not be created';
  END IF;
END
$inventory_coverage_guard$;

DO $inventory_balance_guard$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
         AND conrelid = 'stock_movements'::regclass
         AND contype = 'f'
         AND convalidated
     )
     AND EXISTS (
       SELECT 1
       FROM "store_ingredients" AS store_ingredient
       INNER JOIN "ingredients" AS ingredient
         ON ingredient."id" = store_ingredient."ingredientId"
       WHERE (store_ingredient."storeId" = 'store-main'
              AND store_ingredient."stockQty" <> ingredient."stockQty")
          OR (store_ingredient."storeId" <> 'store-main'
              AND store_ingredient."stockQty" <> 0)
     ) THEN
    RAISE EXCEPTION 'Store ingredient opening balances do not match the declared legacy allocation';
  END IF;
END
$inventory_balance_guard$;

ALTER TABLE "stock_movements"
  ADD COLUMN IF NOT EXISTS "storeId" TEXT,
  ADD COLUMN IF NOT EXISTS "storeIngredientId" TEXT;

-- Existing movement rows contain no trustworthy outlet identity. Per the
-- declared cutover assumption, assign every unmigrated row to store-main.
UPDATE "stock_movements" AS movement
SET
  "storeId" = 'store-main',
  "storeIngredientId" = store_ingredient."id"
FROM "store_ingredients" AS store_ingredient
WHERE store_ingredient."storeId" = 'store-main'
  AND store_ingredient."ingredientId" = movement."ingredientId"
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
      AND conrelid = 'stock_movements'::regclass
      AND contype = 'f'
      AND convalidated
  )
  AND (
    (movement."storeId" IS NULL AND movement."storeIngredientId" IS NULL)
    OR (movement."storeId" = 'store-main' AND movement."storeIngredientId" IS NULL)
    OR (movement."storeId" IS NULL AND movement."storeIngredientId" = store_ingredient."id")
  );

DO $inventory_movement_guard$
BEGIN
  IF NOT EXISTS (
       SELECT 1
       FROM pg_constraint
       WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
         AND conrelid = 'stock_movements'::regclass
         AND contype = 'f'
         AND convalidated
     )
     AND EXISTS (
       SELECT 1 FROM "stock_movements" WHERE "storeId" <> 'store-main'
     ) THEN
    RAISE EXCEPTION 'A legacy stock movement was assigned outside store-main';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "stock_movements" AS movement
    LEFT JOIN "store_ingredients" AS store_ingredient
      ON store_ingredient."id" = movement."storeIngredientId"
     AND store_ingredient."storeId" = movement."storeId"
    WHERE movement."storeId" IS NULL
       OR movement."storeIngredientId" IS NULL
       OR store_ingredient."id" IS NULL
       OR store_ingredient."ingredientId" <> movement."ingredientId"
  ) THEN
    RAISE EXCEPTION 'Some stock movements have an invalid store/ingredient assignment';
  END IF;
END
$inventory_movement_guard$;

-- Historical movement quantities use the existing convention:
-- PURCHASE is inbound, CONSUMPTION/WASTAGE are outbound magnitudes, and
-- ADJUSTMENT/STOCKTAKE are signed. This deterministic reconciliation row makes
-- the normalized ledger delta equal the copied StoreIngredient balance without
-- rewriting historical audit records.
INSERT INTO "stock_movements" (
  "id",
  "storeId",
  "storeIngredientId",
  "ingredientId",
  "type",
  "quantity",
  "unitCost",
  "supplierId",
  "wasteRecordId",
  "note",
  "createdAt"
)
SELECT
  'stk_recon_' || md5('store-inventory-cutover:v1:' || store_ingredient."id"),
  store_ingredient."storeId",
  store_ingredient."id",
  store_ingredient."ingredientId",
  'STOCKTAKE',
  store_ingredient."stockQty" - COALESCE(
    SUM(
      CASE
        WHEN movement."type" = 'PURCHASE' THEN ABS(movement."quantity")
        WHEN movement."type" IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement."quantity")
        ELSE movement."quantity"
      END
    ),
    0
  ),
  store_ingredient."costPerUnit",
  NULL,
  NULL,
  'Per-store inventory cutover reconciliation',
  CURRENT_TIMESTAMP
FROM "store_ingredients" AS store_ingredient
LEFT JOIN "stock_movements" AS movement
  ON movement."storeId" = store_ingredient."storeId"
 AND movement."storeIngredientId" = store_ingredient."id"
WHERE store_ingredient."storeId" = 'store-main'
  AND NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
      AND conrelid = 'stock_movements'::regclass
      AND contype = 'f'
      AND convalidated
  )
GROUP BY
  store_ingredient."id",
  store_ingredient."storeId",
  store_ingredient."ingredientId",
  store_ingredient."stockQty",
  store_ingredient."costPerUnit"
HAVING store_ingredient."stockQty" - COALESCE(
  SUM(
    CASE
      WHEN movement."type" = 'PURCHASE' THEN ABS(movement."quantity")
      WHEN movement."type" IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement."quantity")
      ELSE movement."quantity"
    END
  ),
  0
) <> 0
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "stock_movements"
  ALTER COLUMN "storeId" SET NOT NULL,
  ALTER COLUMN "storeIngredientId" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "stock_movements_storeId_createdAt_idx"
  ON "stock_movements"("storeId", "createdAt");
CREATE INDEX IF NOT EXISTS "stock_movements_storeIngredientId_storeId_idx"
  ON "stock_movements"("storeIngredientId", "storeId");
CREATE INDEX IF NOT EXISTS "stock_movements_storeIngredientId_createdAt_idx"
  ON "stock_movements"("storeIngredientId", "createdAt");

DO $inventory_ledger_guard$
BEGIN
  IF EXISTS (
    SELECT store_ingredient."id"
    FROM "store_ingredients" AS store_ingredient
    LEFT JOIN "stock_movements" AS movement
      ON movement."storeId" = store_ingredient."storeId"
     AND movement."storeIngredientId" = store_ingredient."id"
    WHERE store_ingredient."storeId" = 'store-main'
    GROUP BY store_ingredient."id", store_ingredient."stockQty"
    HAVING store_ingredient."stockQty" <> COALESCE(
      SUM(
        CASE
          WHEN movement."type" = 'PURCHASE' THEN ABS(movement."quantity")
          WHEN movement."type" IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement."quantity")
          ELSE movement."quantity"
        END
      ),
      0
    )
  ) THEN
    RAISE EXCEPTION 'Store-main stock balances do not reconcile to normalized movement history';
  END IF;
END
$inventory_ledger_guard$;

DO $inventory_fk$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'stock_movements_storeIngredientId_storeId_fkey'
      AND conrelid = 'stock_movements'::regclass
      AND contype = 'f'
      AND convalidated
  ) THEN
    ALTER TABLE "stock_movements"
      ADD CONSTRAINT "stock_movements_storeIngredientId_storeId_fkey"
      FOREIGN KEY ("storeIngredientId", "storeId")
      REFERENCES "store_ingredients"("id", "storeId")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END
$inventory_fk$;

COMMIT;
