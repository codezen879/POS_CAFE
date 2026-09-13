-- Per-store inventory isolation for the local MySQL database.
--
-- This is a one-time manual cutover migration; it is not automatically run by
-- the application. Run it immediately before using the matching application
-- version because StockMovement.storeId and storeIngredientId become required.
-- It keeps the legacy Ingredient stock/config columns and
-- StockMovement.ingredientId relation for rollback compatibility.
--
-- Required precondition: a store with id `store-main` exists. This script
-- assigns every existing balance and movement to store-main. Other current
-- stores receive zero opening quantities. If that ownership is not correct,
-- stop and replace the backfill with a physical per-store count/allocation.

-- MySQL DDL commits implicitly, so the final composite foreign key is used as
-- a durable completion marker. Dynamic DDL guards let this script resume after
-- a partial cutover without attempting to add the same column/index twice.
SET @store_inventory_migration_complete := (
  SELECT COUNT(*) > 0
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'stock_movements'
    AND CONSTRAINT_NAME = 'stock_movements_storeIngredientId_storeId_fkey'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @store_main_guard_sql := IF(
  @store_inventory_migration_complete = 1
  OR EXISTS (SELECT 1 FROM `stores` WHERE `id` = 'store-main'),
  'SELECT 1',
  'SELECT * FROM `__store_inventory_migration_requires_store_main__`'
);
PREPARE store_main_guard_stmt FROM @store_main_guard_sql;
EXECUTE store_main_guard_stmt;
DEALLOCATE PREPARE store_main_guard_stmt;

CREATE TABLE IF NOT EXISTS `store_ingredients` (
  `id`                    VARCHAR(191)  NOT NULL,
  `storeId`               VARCHAR(191)  NOT NULL,
  `ingredientId`          VARCHAR(191)  NOT NULL,
  `stockQty`              DECIMAL(12,3) NOT NULL DEFAULT 0,
  `reorderLevel`          DECIMAL(12,3) NOT NULL DEFAULT 0,
  `costPerUnit`           DECIMAL(10,2) NULL,
  `preferredSupplierId`   VARCHAR(191)  NULL,
  `isActive`              BOOLEAN       NOT NULL DEFAULT TRUE,
  `version`               INT           NOT NULL DEFAULT 0,
  `createdAt`             DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`             DATETIME(3)   NOT NULL,
  CONSTRAINT `store_ingredients_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `store_ingredients_storeId_ingredientId_key` UNIQUE (`storeId`, `ingredientId`),
  CONSTRAINT `store_ingredients_id_storeId_key` UNIQUE (`id`, `storeId`),
  INDEX `store_ingredients_ingredientId_idx` (`ingredientId`),
  INDEX `store_ingredients_preferredSupplierId_idx` (`preferredSupplierId`),
  INDEX `store_ingredients_storeId_stockQty_idx` (`storeId`, `stockQty`),
  CONSTRAINT `store_ingredients_storeId_fkey`
    FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `store_ingredients_ingredientId_fkey`
    FOREIGN KEY (`ingredientId`) REFERENCES `ingredients`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `store_ingredients_preferredSupplierId_fkey`
    FOREIGN KEY (`preferredSupplierId`) REFERENCES `suppliers`(`id`) ON DELETE SET NULL ON UPDATE CASCADE
);

SET @add_store_id_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND COLUMN_NAME = 'storeId'
  ),
  'SELECT 1',
  'ALTER TABLE `stock_movements` ADD COLUMN `storeId` VARCHAR(191) NULL'
);
PREPARE add_store_id_stmt FROM @add_store_id_sql;
EXECUTE add_store_id_stmt;
DEALLOCATE PREPARE add_store_id_stmt;

SET @add_store_ingredient_id_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND COLUMN_NAME = 'storeIngredientId'
  ),
  'SELECT 1',
  'ALTER TABLE `stock_movements` ADD COLUMN `storeIngredientId` VARCHAR(191) NULL'
);
PREPARE add_store_ingredient_id_stmt FROM @add_store_ingredient_id_sql;
EXECUTE add_store_ingredient_id_stmt;
DEALLOCATE PREPARE add_store_ingredient_id_stmt;

START TRANSACTION;

-- Only store-main inherits the legacy quantity. Configuration defaults are
-- copied to each outlet, but all other outlets begin with zero stock.
INSERT INTO `store_ingredients` (
  `id`,
  `storeId`,
  `ingredientId`,
  `stockQty`,
  `reorderLevel`,
  `costPerUnit`,
  `preferredSupplierId`,
  `isActive`,
  `version`,
  `createdAt`,
  `updatedAt`
)
SELECT
  CONCAT('sii_', MD5(CONCAT(store.`id`, ':', ingredient.`id`))),
  store.`id`,
  ingredient.`id`,
  CASE WHEN store.`id` = 'store-main' THEN ingredient.`stockQty` ELSE 0 END,
  ingredient.`reorderLevel`,
  ingredient.`costPerUnit`,
  ingredient.`supplierId`,
  TRUE,
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `stores` AS store
CROSS JOIN `ingredients` AS ingredient
WHERE @store_inventory_migration_complete = 0
ON DUPLICATE KEY UPDATE `id` = `store_ingredients`.`id`;

SET @store_ingredient_coverage_errors := (
  SELECT COUNT(*)
  FROM `stores` AS store
  CROSS JOIN `ingredients` AS ingredient
  LEFT JOIN `store_ingredients` AS store_ingredient
    ON store_ingredient.`storeId` = store.`id`
   AND store_ingredient.`ingredientId` = ingredient.`id`
  WHERE @store_inventory_migration_complete = 0
    AND store_ingredient.`id` IS NULL
);
SET @store_ingredient_coverage_sql := IF(
  @store_ingredient_coverage_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__store_inventory_balance_backfill_failed__`'
);
PREPARE store_ingredient_coverage_stmt FROM @store_ingredient_coverage_sql;
EXECUTE store_ingredient_coverage_stmt;
DEALLOCATE PREPARE store_ingredient_coverage_stmt;

SET @store_ingredient_balance_errors := (
  SELECT COUNT(*)
  FROM `store_ingredients` AS store_ingredient
  INNER JOIN `ingredients` AS ingredient
    ON ingredient.`id` = store_ingredient.`ingredientId`
  WHERE @store_inventory_migration_complete = 0
    AND (
      (store_ingredient.`storeId` = 'store-main'
       AND store_ingredient.`stockQty` <> ingredient.`stockQty`)
      OR (store_ingredient.`storeId` <> 'store-main'
          AND store_ingredient.`stockQty` <> 0)
    )
);
SET @store_ingredient_balance_sql := IF(
  @store_ingredient_balance_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__store_inventory_opening_balance_backfill_failed__`'
);
PREPARE store_ingredient_balance_stmt FROM @store_ingredient_balance_sql;
EXECUTE store_ingredient_balance_stmt;
DEALLOCATE PREPARE store_ingredient_balance_stmt;

UPDATE `stock_movements` AS movement
INNER JOIN `store_ingredients` AS store_ingredient
  ON store_ingredient.`storeId` = 'store-main'
 AND store_ingredient.`ingredientId` = movement.`ingredientId`
SET
  movement.`storeId` = 'store-main',
  movement.`storeIngredientId` = store_ingredient.`id`
WHERE movement.`storeId` IS NULL
  AND movement.`storeIngredientId` IS NULL
  AND @store_inventory_migration_complete = 0;

-- Resume the two possible half-populated column states without overwriting a
-- fully scoped movement or silently moving a row from another outlet.
UPDATE `stock_movements` AS movement
INNER JOIN `store_ingredients` AS store_ingredient
  ON store_ingredient.`storeId` = 'store-main'
 AND store_ingredient.`ingredientId` = movement.`ingredientId`
 AND (
   movement.`storeIngredientId` IS NULL
   OR movement.`storeIngredientId` = store_ingredient.`id`
 )
SET
  movement.`storeId` = 'store-main',
  movement.`storeIngredientId` = store_ingredient.`id`
WHERE @store_inventory_migration_complete = 0
  AND (
    (movement.`storeId` = 'store-main' AND movement.`storeIngredientId` IS NULL)
    OR (movement.`storeId` IS NULL AND movement.`storeIngredientId` = store_ingredient.`id`)
  );

SET @stock_movement_assignment_errors := (
  SELECT COUNT(*)
  FROM `stock_movements` AS movement
  LEFT JOIN `store_ingredients` AS store_ingredient
    ON store_ingredient.`id` = movement.`storeIngredientId`
   AND store_ingredient.`storeId` = movement.`storeId`
  WHERE movement.`storeId` IS NULL
     OR movement.`storeIngredientId` IS NULL
     OR store_ingredient.`id` IS NULL
     OR store_ingredient.`ingredientId` <> movement.`ingredientId`
);
SET @stock_movement_wrong_store_errors := (
  SELECT COUNT(*)
  FROM `stock_movements`
  WHERE @store_inventory_migration_complete = 0
    AND `storeId` <> 'store-main'
);
SET @stock_movement_assignment_sql := IF(
  @stock_movement_assignment_errors = 0
  AND @stock_movement_wrong_store_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__stock_movement_store_backfill_failed__`'
);
PREPARE stock_movement_assignment_stmt FROM @stock_movement_assignment_sql;
EXECUTE stock_movement_assignment_stmt;
DEALLOCATE PREPARE stock_movement_assignment_stmt;

INSERT INTO `stock_movements` (
  `id`,
  `storeId`,
  `storeIngredientId`,
  `ingredientId`,
  `type`,
  `quantity`,
  `unitCost`,
  `supplierId`,
  `wasteRecordId`,
  `note`,
  `createdAt`
)
SELECT
  CONCAT('stk_recon_', LEFT(SHA2(CONCAT('store-inventory-cutover:v1:', store_ingredient.`id`), 256), 32)),
  store_ingredient.`storeId`,
  store_ingredient.`id`,
  store_ingredient.`ingredientId`,
  'STOCKTAKE',
  store_ingredient.`stockQty` - COALESCE(
    SUM(
      CASE
        WHEN movement.`type` = 'PURCHASE' THEN ABS(movement.`quantity`)
        WHEN movement.`type` IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement.`quantity`)
        ELSE movement.`quantity`
      END
    ),
    0
  ),
  store_ingredient.`costPerUnit`,
  NULL,
  NULL,
  'Per-store inventory cutover reconciliation',
  CURRENT_TIMESTAMP(3)
FROM `store_ingredients` AS store_ingredient
LEFT JOIN `stock_movements` AS movement
  ON movement.`storeId` = store_ingredient.`storeId`
 AND movement.`storeIngredientId` = store_ingredient.`id`
WHERE store_ingredient.`storeId` = 'store-main'
  AND @store_inventory_migration_complete = 0
GROUP BY
  store_ingredient.`id`,
  store_ingredient.`storeId`,
  store_ingredient.`ingredientId`,
  store_ingredient.`stockQty`,
  store_ingredient.`costPerUnit`
HAVING store_ingredient.`stockQty` - COALESCE(
  SUM(
    CASE
      WHEN movement.`type` = 'PURCHASE' THEN ABS(movement.`quantity`)
      WHEN movement.`type` IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement.`quantity`)
      ELSE movement.`quantity`
    END
  ),
  0
) <> 0
ON DUPLICATE KEY UPDATE `id` = `stock_movements`.`id`;

SET @store_inventory_ledger_errors := (
  SELECT COUNT(*)
  FROM (
    SELECT store_ingredient.`id`
    FROM `store_ingredients` AS store_ingredient
    LEFT JOIN `stock_movements` AS movement
      ON movement.`storeId` = store_ingredient.`storeId`
     AND movement.`storeIngredientId` = store_ingredient.`id`
    WHERE store_ingredient.`storeId` = 'store-main'
    GROUP BY store_ingredient.`id`, store_ingredient.`stockQty`
    HAVING store_ingredient.`stockQty` <> COALESCE(
      SUM(
        CASE
          WHEN movement.`type` = 'PURCHASE' THEN ABS(movement.`quantity`)
          WHEN movement.`type` IN ('CONSUMPTION', 'WASTAGE') THEN -ABS(movement.`quantity`)
          ELSE movement.`quantity`
        END
      ),
      0
    )
  ) AS ledger_mismatch
);
SET @store_inventory_ledger_sql := IF(
  @store_inventory_ledger_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__store_inventory_ledger_reconciliation_failed__`'
);
PREPARE store_inventory_ledger_stmt FROM @store_inventory_ledger_sql;
EXECUTE store_inventory_ledger_stmt;
DEALLOCATE PREPARE store_inventory_ledger_stmt;

COMMIT;

SET @require_store_columns_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND COLUMN_NAME IN ('storeId', 'storeIngredientId')
      AND IS_NULLABLE = 'YES'
  ),
  'ALTER TABLE `stock_movements` MODIFY COLUMN `storeId` VARCHAR(191) NOT NULL, MODIFY COLUMN `storeIngredientId` VARCHAR(191) NOT NULL',
  'SELECT 1'
);
PREPARE require_store_columns_stmt FROM @require_store_columns_sql;
EXECUTE require_store_columns_stmt;
DEALLOCATE PREPARE require_store_columns_stmt;

SET @store_created_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND INDEX_NAME = 'stock_movements_storeId_createdAt_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `stock_movements_storeId_createdAt_idx` ON `stock_movements` (`storeId`, `createdAt`)'
);
PREPARE store_created_index_stmt FROM @store_created_index_sql;
EXECUTE store_created_index_stmt;
DEALLOCATE PREPARE store_created_index_stmt;

SET @store_ingredient_store_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND INDEX_NAME = 'stock_movements_storeIngredientId_storeId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `stock_movements_storeIngredientId_storeId_idx` ON `stock_movements` (`storeIngredientId`, `storeId`)'
);
PREPARE store_ingredient_store_index_stmt FROM @store_ingredient_store_index_sql;
EXECUTE store_ingredient_store_index_stmt;
DEALLOCATE PREPARE store_ingredient_store_index_stmt;

SET @store_ingredient_created_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND INDEX_NAME = 'stock_movements_storeIngredientId_createdAt_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `stock_movements_storeIngredientId_createdAt_idx` ON `stock_movements` (`storeIngredientId`, `createdAt`)'
);
PREPARE store_ingredient_created_index_stmt FROM @store_ingredient_created_index_sql;
EXECUTE store_ingredient_created_index_stmt;
DEALLOCATE PREPARE store_ingredient_created_index_stmt;

SET @store_inventory_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND CONSTRAINT_NAME = 'stock_movements_storeIngredientId_storeId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_storeIngredientId_storeId_fkey` FOREIGN KEY (`storeIngredientId`, `storeId`) REFERENCES `store_ingredients` (`id`, `storeId`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE store_inventory_fk_stmt FROM @store_inventory_fk_sql;
EXECUTE store_inventory_fk_stmt;
DEALLOCATE PREPARE store_inventory_fk_stmt;
