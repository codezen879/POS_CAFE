-- Read-only verification for the per-store inventory cutover.
-- Expected result:
--   migration_complete = true
--   expected_balance_rows = actual_balance_rows
--   every column ending in _errors or _mismatches = 0

WITH ledger AS (
  SELECT
    store_ingredient."id",
    store_ingredient."stockQty",
    COALESCE(
      SUM(
        CASE
          WHEN movement."type" = 'PURCHASE' THEN ABS(movement."quantity")
          WHEN movement."type" IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement."quantity")
          ELSE movement."quantity"
        END
      ),
      0
    ) AS movement_balance
  FROM "store_ingredients" AS store_ingredient
  LEFT JOIN "stock_movements" AS movement
    ON movement."storeId" = store_ingredient."storeId"
   AND movement."storeIngredientId" = store_ingredient."id"
  WHERE store_ingredient."storeId" = 'store-main'
  GROUP BY store_ingredient."id", store_ingredient."stockQty"
),
checks AS (
  SELECT
    (SELECT COUNT(*) FROM "stores")
      * (SELECT COUNT(*) FROM "ingredients") AS expected_balance_rows,
    (SELECT COUNT(*) FROM "store_ingredients") AS actual_balance_rows,
    (
      SELECT COUNT(*)
      FROM "store_ingredients"
      WHERE "storeId" <> 'store-main'
        AND "stockQty" <> 0
    ) AS other_outlet_nonzero_errors,
    (
      SELECT COUNT(*)
      FROM "store_ingredients" AS store_ingredient
      INNER JOIN "ingredients" AS ingredient
        ON ingredient."id" = store_ingredient."ingredientId"
      WHERE store_ingredient."storeId" = 'store-main'
        AND store_ingredient."stockQty" <> ingredient."stockQty"
    ) AS main_legacy_balance_mismatches,
    (
      SELECT COUNT(*)
      FROM "stock_movements" AS movement
      LEFT JOIN "store_ingredients" AS store_ingredient
        ON store_ingredient."id" = movement."storeIngredientId"
       AND store_ingredient."storeId" = movement."storeId"
      WHERE store_ingredient."id" IS NULL
         OR store_ingredient."ingredientId" <> movement."ingredientId"
    ) AS invalid_movement_link_errors,
    (
      SELECT COUNT(*)
      FROM ledger
      WHERE "stockQty" <> movement_balance
    ) AS ledger_mismatches
)
SELECT
  (
    COALESCE(
      (
        SELECT attnotnull
        FROM pg_attribute
        WHERE attrelid = 'public.stock_movements'::regclass
          AND attname = 'storeId'
          AND attnum > 0
          AND NOT attisdropped
      ),
      false
    )
    AND COALESCE(
      (
        SELECT attnotnull
        FROM pg_attribute
        WHERE attrelid = 'public.stock_movements'::regclass
          AND attname = 'storeIngredientId'
          AND attnum > 0
          AND NOT attisdropped
      ),
      false
    )
    AND EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = 'public.stock_movements'::regclass
        AND conname = 'stock_movements_storeIngredientId_storeId_fkey'
        AND contype = 'f'
        AND convalidated
    )
  ) AS migration_complete,
  expected_balance_rows,
  actual_balance_rows,
  other_outlet_nonzero_errors,
  main_legacy_balance_mismatches,
  invalid_movement_link_errors,
  ledger_mismatches
FROM checks;
