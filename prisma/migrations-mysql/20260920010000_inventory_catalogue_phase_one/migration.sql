-- Outlet-owned inventory catalogue and FIFO opening layers for MySQL.
-- Run after 20260914010000_inventory_master_data.

-- This standard FIFO index is created last and doubles as a durable completion
-- marker. That prevents a rerun from snapshotting post-migration stock as a
-- second MIGRATION_OPENING layer.
SET @inventory_catalogue_phase_one_complete := (
  SELECT COUNT(*) > 0
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'inventory_stock_layers'
    AND INDEX_NAME = 'inventory_stock_layers_store_item_remaining_idx'
);

SET @phase_one_store_guard_sql := IF(
  NOT EXISTS (SELECT 1 FROM `suppliers`)
  OR EXISTS (SELECT 1 FROM `stores`),
  'SELECT 1',
  'SELECT * FROM `__inventory_catalogue_phase_one_requires_a_store__`'
);
PREPARE phase_one_store_guard_stmt FROM @phase_one_store_guard_sql;
EXECUTE phase_one_store_guard_stmt;
DEALLOCATE PREPARE phase_one_store_guard_stmt;

CREATE TABLE IF NOT EXISTS `inventory_categories` (
  `id`          VARCHAR(191) NOT NULL,
  `storeId`     VARCHAR(191) NOT NULL,
  `name`        VARCHAR(191) NOT NULL,
  `nameKey`     VARCHAR(191) NOT NULL,
  `description` TEXT         NULL,
  `sortOrder`   INT          NOT NULL DEFAULT 0,
  `isActive`    BOOLEAN      NOT NULL DEFAULT TRUE,
  `createdAt`   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`   DATETIME(3)  NOT NULL,
  CONSTRAINT `inventory_categories_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `inventory_categories_id_storeId_key` UNIQUE (`id`, `storeId`),
  CONSTRAINT `inventory_categories_storeId_nameKey_key` UNIQUE (`storeId`, `nameKey`),
  INDEX `inventory_categories_storeId_isActive_sortOrder_idx` (`storeId`, `isActive`, `sortOrder`),
  CONSTRAINT `inventory_categories_storeId_fkey`
    FOREIGN KEY (`storeId`) REFERENCES `stores`(`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `inventory_categories_name_check`
    CHECK (TRIM(`name`) <> '' AND TRIM(`nameKey`) <> ''),
  CONSTRAINT `inventory_categories_sortOrder_check` CHECK (`sortOrder` >= 0)
);

INSERT INTO `inventory_categories` (
  `id`, `storeId`, `name`, `nameKey`, `description`, `sortOrder`,
  `isActive`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('icat_uncategorized_', SHA2(store.`id`, 256)),
  store.`id`,
  'Uncategorized',
  'uncategorized',
  'Items migrated before inventory categories were introduced',
  0,
  TRUE,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `stores` AS store
ON DUPLICATE KEY UPDATE `id` = `inventory_categories`.`id`;

SET @add_store_ingredient_name_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'name'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `name` VARCHAR(191) NULL'
);
PREPARE add_store_ingredient_name_stmt FROM @add_store_ingredient_name_sql;
EXECUTE add_store_ingredient_name_stmt;
DEALLOCATE PREPARE add_store_ingredient_name_stmt;

SET @add_store_ingredient_name_key_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'nameKey'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `nameKey` VARCHAR(191) NULL'
);
PREPARE add_store_ingredient_name_key_stmt FROM @add_store_ingredient_name_key_sql;
EXECUTE add_store_ingredient_name_key_stmt;
DEALLOCATE PREPARE add_store_ingredient_name_key_stmt;

SET @add_store_ingredient_unit_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'unit'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `unit` VARCHAR(191) NULL'
);
PREPARE add_store_ingredient_unit_stmt FROM @add_store_ingredient_unit_sql;
EXECUTE add_store_ingredient_unit_stmt;
DEALLOCATE PREPARE add_store_ingredient_unit_stmt;

SET @add_store_ingredient_description_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'description'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `description` TEXT NULL'
);
PREPARE add_store_ingredient_description_stmt FROM @add_store_ingredient_description_sql;
EXECUTE add_store_ingredient_description_stmt;
DEALLOCATE PREPARE add_store_ingredient_description_stmt;

SET @add_store_ingredient_category_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'categoryId'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `categoryId` VARCHAR(191) NULL'
);
PREPARE add_store_ingredient_category_stmt FROM @add_store_ingredient_category_sql;
EXECUTE add_store_ingredient_category_stmt;
DEALLOCATE PREPARE add_store_ingredient_category_stmt;

SET @add_store_ingredient_daily_tracking_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME = 'dailyStockTracking'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD COLUMN `dailyStockTracking` BOOLEAN NOT NULL DEFAULT FALSE'
);
PREPARE add_store_ingredient_daily_tracking_stmt FROM @add_store_ingredient_daily_tracking_sql;
EXECUTE add_store_ingredient_daily_tracking_stmt;
DEALLOCATE PREPARE add_store_ingredient_daily_tracking_stmt;

UPDATE `store_ingredients` AS store_ingredient
INNER JOIN `ingredients` AS ingredient
  ON ingredient.`id` = store_ingredient.`ingredientId`
INNER JOIN `inventory_categories` AS category
  ON category.`storeId` = store_ingredient.`storeId`
 AND category.`nameKey` = 'uncategorized'
SET
  store_ingredient.`name` = COALESCE(NULLIF(TRIM(store_ingredient.`name`), ''), ingredient.`name`),
  store_ingredient.`unit` = COALESCE(NULLIF(TRIM(store_ingredient.`unit`), ''), ingredient.`unit`),
  store_ingredient.`categoryId` = COALESCE(store_ingredient.`categoryId`, category.`id`);

UPDATE `store_ingredients` AS store_ingredient
INNER JOIN (
  SELECT
    ranked.`id`,
    CASE
      WHEN ranked.`duplicate_number` = 1 THEN ranked.`base_key`
      ELSE CONCAT(ranked.`base_key`, '--legacy-', LEFT(SHA2(ranked.`id`, 256), 12))
    END AS `resolved_key`
  FROM (
    SELECT
      normalized.`id`,
      normalized.`storeId`,
      normalized.`base_key`,
      ROW_NUMBER() OVER (
        PARTITION BY normalized.`storeId`, normalized.`base_key`
        ORDER BY normalized.`id`
      ) AS `duplicate_number`
    FROM (
      SELECT
        candidate.`id`,
        candidate.`storeId`,
        LEFT(
          COALESCE(
            NULLIF(LOWER(REGEXP_REPLACE(TRIM(candidate.`name`), '[[:space:]]+', ' ')), ''),
            'inventory-item'
          ),
          170
        ) AS `base_key`
      FROM `store_ingredients` AS candidate
    ) AS normalized
  ) AS ranked
) AS resolved
  ON resolved.`id` = store_ingredient.`id`
SET store_ingredient.`nameKey` = resolved.`resolved_key`
WHERE store_ingredient.`nameKey` IS NULL OR TRIM(store_ingredient.`nameKey`) = '';

SET @store_ingredient_catalogue_errors := (
  SELECT COUNT(*)
  FROM `store_ingredients`
  WHERE `name` IS NULL OR TRIM(`name`) = ''
     OR `nameKey` IS NULL OR TRIM(`nameKey`) = ''
     OR `unit` IS NULL OR TRIM(`unit`) = ''
     OR `categoryId` IS NULL
);
SET @store_ingredient_catalogue_guard_sql := IF(
  @store_ingredient_catalogue_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__store_ingredient_catalogue_backfill_failed__`'
);
PREPARE store_ingredient_catalogue_guard_stmt FROM @store_ingredient_catalogue_guard_sql;
EXECUTE store_ingredient_catalogue_guard_stmt;
DEALLOCATE PREPARE store_ingredient_catalogue_guard_stmt;

SET @require_store_ingredient_catalogue_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND COLUMN_NAME IN ('name', 'nameKey', 'unit', 'categoryId')
      AND IS_NULLABLE = 'YES'
  ),
  'ALTER TABLE `store_ingredients` MODIFY COLUMN `name` VARCHAR(191) NOT NULL, MODIFY COLUMN `nameKey` VARCHAR(191) NOT NULL, MODIFY COLUMN `unit` VARCHAR(191) NOT NULL, MODIFY COLUMN `categoryId` VARCHAR(191) NOT NULL',
  'SELECT 1'
);
PREPARE require_store_ingredient_catalogue_stmt FROM @require_store_ingredient_catalogue_sql;
EXECUTE require_store_ingredient_catalogue_stmt;
DEALLOCATE PREPARE require_store_ingredient_catalogue_stmt;

SET @store_ingredient_name_key_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND INDEX_NAME = 'store_ingredients_storeId_nameKey_key'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `store_ingredients_storeId_nameKey_key` ON `store_ingredients` (`storeId`, `nameKey`)'
);
PREPARE store_ingredient_name_key_stmt FROM @store_ingredient_name_key_sql;
EXECUTE store_ingredient_name_key_stmt;
DEALLOCATE PREPARE store_ingredient_name_key_stmt;

SET @store_ingredient_category_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND INDEX_NAME = 'store_ingredients_storeId_categoryId_isActive_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `store_ingredients_storeId_categoryId_isActive_idx` ON `store_ingredients` (`storeId`, `categoryId`, `isActive`)'
);
PREPARE store_ingredient_category_index_stmt FROM @store_ingredient_category_index_sql;
EXECUTE store_ingredient_category_index_stmt;
DEALLOCATE PREPARE store_ingredient_category_index_stmt;

SET @store_ingredient_category_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND CONSTRAINT_NAME = 'store_ingredients_categoryId_storeId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD CONSTRAINT `store_ingredients_categoryId_storeId_fkey` FOREIGN KEY (`categoryId`, `storeId`) REFERENCES `inventory_categories` (`id`, `storeId`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE store_ingredient_category_fk_stmt FROM @store_ingredient_category_fk_sql;
EXECUTE store_ingredient_category_fk_stmt;
DEALLOCATE PREPARE store_ingredient_category_fk_stmt;

-- Scope the formerly global supplier catalogue. The original supplier row is
-- retained for its first referenced outlet (or the first store when it was
-- unreferenced) so Ingredient.supplierId remains valid.
SET @add_supplier_store_id_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'storeId'
  ),
  'SELECT 1',
  'ALTER TABLE `suppliers` ADD COLUMN `storeId` VARCHAR(191) NULL'
);
PREPARE add_supplier_store_id_stmt FROM @add_supplier_store_id_sql;
EXECUTE add_supplier_store_id_stmt;
DEALLOCATE PREPARE add_supplier_store_id_stmt;

SET @add_supplier_name_key_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME = 'nameKey'
  ),
  'SELECT 1',
  'ALTER TABLE `suppliers` ADD COLUMN `nameKey` VARCHAR(191) NULL'
);
PREPARE add_supplier_name_key_stmt FROM @add_supplier_name_key_sql;
EXECUTE add_supplier_name_key_stmt;
DEALLOCATE PREPARE add_supplier_name_key_stmt;

UPDATE `suppliers` AS supplier
INNER JOIN (
  SELECT
    ranked.`id`,
    CASE
      WHEN ranked.`duplicate_number` = 1 THEN ranked.`base_key`
      ELSE CONCAT(ranked.`base_key`, '--legacy-', LEFT(SHA2(ranked.`id`, 256), 12))
    END AS `resolved_key`
  FROM (
    SELECT
      normalized.`id`,
      normalized.`base_key`,
      ROW_NUMBER() OVER (
        PARTITION BY normalized.`base_key`
        ORDER BY normalized.`id`
      ) AS `duplicate_number`
    FROM (
      SELECT
        candidate.`id`,
        LEFT(
          COALESCE(
            NULLIF(LOWER(REGEXP_REPLACE(TRIM(candidate.`name`), '[[:space:]]+', ' ')), ''),
            'supplier'
          ),
          170
        ) AS `base_key`
      FROM `suppliers` AS candidate
      WHERE candidate.`storeId` IS NULL
    ) AS normalized
  ) AS ranked
) AS resolved
  ON resolved.`id` = supplier.`id`
SET supplier.`nameKey` = resolved.`resolved_key`
WHERE supplier.`storeId` IS NULL
  AND (supplier.`nameKey` IS NULL OR TRIM(supplier.`nameKey`) = '');

INSERT INTO `suppliers` (
  `id`, `storeId`, `name`, `nameKey`, `contact`, `phone`, `email`,
  `address`, `isActive`, `createdAt`
)
SELECT
  CONCAT('sup_scope_', SHA2(CONCAT(source_supplier.`id`, ':', store.`id`), 256)),
  store.`id`,
  source_supplier.`name`,
  source_supplier.`nameKey`,
  source_supplier.`contact`,
  source_supplier.`phone`,
  source_supplier.`email`,
  source_supplier.`address`,
  source_supplier.`isActive`,
  source_supplier.`createdAt`
FROM `suppliers` AS source_supplier
INNER JOIN (
  SELECT
    primary_calculation.`supplier_id`,
    primary_calculation.`primary_store_id`
  FROM (
    SELECT
      supplier.`id` AS `supplier_id`,
      COALESCE(MIN(supplier_reference.`store_id`), fallback_store.`store_id`) AS `primary_store_id`
    FROM `suppliers` AS supplier
    LEFT JOIN (
      SELECT `preferredSupplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `store_ingredients`
      WHERE `preferredSupplierId` IS NOT NULL
      UNION ALL
      SELECT `supplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `stock_movements`
      WHERE `supplierId` IS NOT NULL
    ) AS supplier_reference
      ON supplier_reference.`supplier_id` = supplier.`id`
    CROSS JOIN (SELECT MIN(`id`) AS `store_id` FROM `stores`) AS fallback_store
    WHERE supplier.`storeId` IS NULL
    GROUP BY supplier.`id`, fallback_store.`store_id`
  ) AS primary_calculation
) AS primary_store
  ON primary_store.`supplier_id` = source_supplier.`id`
CROSS JOIN `stores` AS store
WHERE source_supplier.`storeId` IS NULL
  AND store.`id` <> primary_store.`primary_store_id`
ON DUPLICATE KEY UPDATE `id` = `suppliers`.`id`;

UPDATE `store_ingredients` AS store_ingredient
INNER JOIN (
  SELECT
    primary_calculation.`supplier_id`,
    primary_calculation.`primary_store_id`
  FROM (
    SELECT
      supplier.`id` AS `supplier_id`,
      COALESCE(MIN(supplier_reference.`store_id`), fallback_store.`store_id`) AS `primary_store_id`
    FROM `suppliers` AS supplier
    LEFT JOIN (
      SELECT `preferredSupplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `store_ingredients`
      WHERE `preferredSupplierId` IS NOT NULL
      UNION ALL
      SELECT `supplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `stock_movements`
      WHERE `supplierId` IS NOT NULL
    ) AS supplier_reference
      ON supplier_reference.`supplier_id` = supplier.`id`
    CROSS JOIN (SELECT MIN(`id`) AS `store_id` FROM `stores`) AS fallback_store
    WHERE supplier.`storeId` IS NULL
    GROUP BY supplier.`id`, fallback_store.`store_id`
  ) AS primary_calculation
) AS primary_store
  ON primary_store.`supplier_id` = store_ingredient.`preferredSupplierId`
INNER JOIN `suppliers` AS scoped_supplier
  ON scoped_supplier.`id` = CONCAT(
    'sup_scope_',
    SHA2(CONCAT(primary_store.`supplier_id`, ':', store_ingredient.`storeId`), 256)
  )
SET store_ingredient.`preferredSupplierId` = scoped_supplier.`id`
WHERE store_ingredient.`storeId` <> primary_store.`primary_store_id`;

UPDATE `stock_movements` AS movement
INNER JOIN (
  SELECT
    primary_calculation.`supplier_id`,
    primary_calculation.`primary_store_id`
  FROM (
    SELECT
      supplier.`id` AS `supplier_id`,
      COALESCE(MIN(supplier_reference.`store_id`), fallback_store.`store_id`) AS `primary_store_id`
    FROM `suppliers` AS supplier
    LEFT JOIN (
      SELECT `preferredSupplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `store_ingredients`
      WHERE `preferredSupplierId` IS NOT NULL
      UNION ALL
      SELECT `supplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `stock_movements`
      WHERE `supplierId` IS NOT NULL
    ) AS supplier_reference
      ON supplier_reference.`supplier_id` = supplier.`id`
    CROSS JOIN (SELECT MIN(`id`) AS `store_id` FROM `stores`) AS fallback_store
    WHERE supplier.`storeId` IS NULL
    GROUP BY supplier.`id`, fallback_store.`store_id`
  ) AS primary_calculation
) AS primary_store
  ON primary_store.`supplier_id` = movement.`supplierId`
INNER JOIN `suppliers` AS scoped_supplier
  ON scoped_supplier.`id` = CONCAT(
    'sup_scope_',
    SHA2(CONCAT(primary_store.`supplier_id`, ':', movement.`storeId`), 256)
  )
SET movement.`supplierId` = scoped_supplier.`id`
WHERE movement.`storeId` <> primary_store.`primary_store_id`;

UPDATE `suppliers` AS supplier
INNER JOIN (
  SELECT
    primary_calculation.`supplier_id`,
    primary_calculation.`primary_store_id`
  FROM (
    SELECT
      candidate.`id` AS `supplier_id`,
      COALESCE(MIN(supplier_reference.`store_id`), fallback_store.`store_id`) AS `primary_store_id`
    FROM `suppliers` AS candidate
    LEFT JOIN (
      SELECT `preferredSupplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `store_ingredients`
      WHERE `preferredSupplierId` IS NOT NULL
      UNION ALL
      SELECT `supplierId` AS `supplier_id`, `storeId` AS `store_id`
      FROM `stock_movements`
      WHERE `supplierId` IS NOT NULL
    ) AS supplier_reference
      ON supplier_reference.`supplier_id` = candidate.`id`
    CROSS JOIN (SELECT MIN(`id`) AS `store_id` FROM `stores`) AS fallback_store
    WHERE candidate.`storeId` IS NULL
    GROUP BY candidate.`id`, fallback_store.`store_id`
  ) AS primary_calculation
) AS primary_store
  ON primary_store.`supplier_id` = supplier.`id`
SET supplier.`storeId` = primary_store.`primary_store_id`
WHERE supplier.`storeId` IS NULL;

SET @supplier_scope_errors := (
  SELECT COUNT(*)
  FROM `suppliers`
  WHERE `storeId` IS NULL OR `nameKey` IS NULL OR TRIM(`nameKey`) = ''
);
SET @store_ingredient_supplier_scope_errors := (
  SELECT COUNT(*)
  FROM `store_ingredients` AS store_ingredient
  LEFT JOIN `suppliers` AS supplier
    ON supplier.`id` = store_ingredient.`preferredSupplierId`
   AND supplier.`storeId` = store_ingredient.`storeId`
  WHERE store_ingredient.`preferredSupplierId` IS NOT NULL
    AND supplier.`id` IS NULL
);
SET @movement_supplier_scope_errors := (
  SELECT COUNT(*)
  FROM `stock_movements` AS movement
  LEFT JOIN `suppliers` AS supplier
    ON supplier.`id` = movement.`supplierId`
   AND supplier.`storeId` = movement.`storeId`
  WHERE movement.`supplierId` IS NOT NULL
    AND supplier.`id` IS NULL
);
SET @supplier_scope_guard_sql := IF(
  @supplier_scope_errors = 0
  AND @store_ingredient_supplier_scope_errors = 0
  AND @movement_supplier_scope_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__supplier_outlet_scope_backfill_failed__`'
);
PREPARE supplier_scope_guard_stmt FROM @supplier_scope_guard_sql;
EXECUTE supplier_scope_guard_stmt;
DEALLOCATE PREPARE supplier_scope_guard_stmt;

SET @require_supplier_scope_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND COLUMN_NAME IN ('storeId', 'nameKey')
      AND IS_NULLABLE = 'YES'
  ),
  'ALTER TABLE `suppliers` MODIFY COLUMN `storeId` VARCHAR(191) NOT NULL, MODIFY COLUMN `nameKey` VARCHAR(191) NOT NULL',
  'SELECT 1'
);
PREPARE require_supplier_scope_stmt FROM @require_supplier_scope_sql;
EXECUTE require_supplier_scope_stmt;
DEALLOCATE PREPARE require_supplier_scope_stmt;

SET @supplier_id_store_key_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND INDEX_NAME = 'suppliers_id_storeId_key'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `suppliers_id_storeId_key` ON `suppliers` (`id`, `storeId`)'
);
PREPARE supplier_id_store_key_stmt FROM @supplier_id_store_key_sql;
EXECUTE supplier_id_store_key_stmt;
DEALLOCATE PREPARE supplier_id_store_key_stmt;

SET @supplier_name_key_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND INDEX_NAME = 'suppliers_storeId_nameKey_key'
  ),
  'SELECT 1',
  'CREATE UNIQUE INDEX `suppliers_storeId_nameKey_key` ON `suppliers` (`storeId`, `nameKey`)'
);
PREPARE supplier_name_key_stmt FROM @supplier_name_key_sql;
EXECUTE supplier_name_key_stmt;
DEALLOCATE PREPARE supplier_name_key_stmt;

SET @supplier_scope_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND INDEX_NAME = 'suppliers_storeId_isActive_name_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `suppliers_storeId_isActive_name_idx` ON `suppliers` (`storeId`, `isActive`, `name`)'
);
PREPARE supplier_scope_index_stmt FROM @supplier_scope_index_sql;
EXECUTE supplier_scope_index_stmt;
DEALLOCATE PREPARE supplier_scope_index_stmt;

SET @store_ingredient_supplier_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND INDEX_NAME = 'store_ingredients_preferredSupplierId_storeId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `store_ingredients_preferredSupplierId_storeId_idx` ON `store_ingredients` (`preferredSupplierId`, `storeId`)'
);
PREPARE store_ingredient_supplier_index_stmt FROM @store_ingredient_supplier_index_sql;
EXECUTE store_ingredient_supplier_index_stmt;
DEALLOCATE PREPARE store_ingredient_supplier_index_stmt;

SET @movement_supplier_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND INDEX_NAME = 'stock_movements_supplierId_storeId_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `stock_movements_supplierId_storeId_idx` ON `stock_movements` (`supplierId`, `storeId`)'
);
PREPARE movement_supplier_index_stmt FROM @movement_supplier_index_sql;
EXECUTE movement_supplier_index_stmt;
DEALLOCATE PREPARE movement_supplier_index_stmt;

SET @drop_store_ingredient_supplier_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND CONSTRAINT_NAME = 'store_ingredients_preferredSupplierId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'ALTER TABLE `store_ingredients` DROP FOREIGN KEY `store_ingredients_preferredSupplierId_fkey`',
  'SELECT 1'
);
PREPARE drop_store_ingredient_supplier_fk_stmt FROM @drop_store_ingredient_supplier_fk_sql;
EXECUTE drop_store_ingredient_supplier_fk_stmt;
DEALLOCATE PREPARE drop_store_ingredient_supplier_fk_stmt;

SET @drop_movement_supplier_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND CONSTRAINT_NAME = 'stock_movements_supplierId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'ALTER TABLE `stock_movements` DROP FOREIGN KEY `stock_movements_supplierId_fkey`',
  'SELECT 1'
);
PREPARE drop_movement_supplier_fk_stmt FROM @drop_movement_supplier_fk_sql;
EXECUTE drop_movement_supplier_fk_stmt;
DEALLOCATE PREPARE drop_movement_supplier_fk_stmt;

SET @supplier_store_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND CONSTRAINT_NAME = 'suppliers_storeId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `suppliers` ADD CONSTRAINT `suppliers_storeId_fkey` FOREIGN KEY (`storeId`) REFERENCES `stores` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE supplier_store_fk_stmt FROM @supplier_store_fk_sql;
EXECUTE supplier_store_fk_stmt;
DEALLOCATE PREPARE supplier_store_fk_stmt;

SET @store_ingredient_supplier_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'store_ingredients'
      AND CONSTRAINT_NAME = 'store_ingredients_preferredSupplierId_storeId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `store_ingredients` ADD CONSTRAINT `store_ingredients_preferredSupplierId_storeId_fkey` FOREIGN KEY (`preferredSupplierId`, `storeId`) REFERENCES `suppliers` (`id`, `storeId`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE store_ingredient_supplier_fk_stmt FROM @store_ingredient_supplier_fk_sql;
EXECUTE store_ingredient_supplier_fk_stmt;
DEALLOCATE PREPARE store_ingredient_supplier_fk_stmt;

SET @movement_supplier_fk_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'stock_movements'
      AND CONSTRAINT_NAME = 'stock_movements_supplierId_storeId_fkey'
      AND CONSTRAINT_TYPE = 'FOREIGN KEY'
  ),
  'SELECT 1',
  'ALTER TABLE `stock_movements` ADD CONSTRAINT `stock_movements_supplierId_storeId_fkey` FOREIGN KEY (`supplierId`, `storeId`) REFERENCES `suppliers` (`id`, `storeId`) ON DELETE RESTRICT ON UPDATE CASCADE'
);
PREPARE movement_supplier_fk_stmt FROM @movement_supplier_fk_sql;
EXECUTE movement_supplier_fk_stmt;
DEALLOCATE PREPARE movement_supplier_fk_stmt;

CREATE TABLE IF NOT EXISTS `inventory_stock_layers` (
  `id`                VARCHAR(191)  NOT NULL,
  `storeId`           VARCHAR(191)  NOT NULL,
  `storeIngredientId` VARCHAR(191)  NOT NULL,
  `sourceMovementId`  VARCHAR(191)  NULL,
  `sourceType`        VARCHAR(191)  NOT NULL,
  `openingKey`        VARCHAR(191)  NULL,
  `originalQty`       DECIMAL(12,3) NOT NULL,
  `remainingQty`      DECIMAL(12,3) NOT NULL,
  `unitCost`          DECIMAL(10,2) NOT NULL,
  `receivedAt`        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `version`           INT           NOT NULL DEFAULT 0,
  `createdAt`         DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt`         DATETIME(3)   NOT NULL,
  CONSTRAINT `inventory_stock_layers_pkey` PRIMARY KEY (`id`),
  CONSTRAINT `inventory_stock_layers_sourceMovementId_key` UNIQUE (`sourceMovementId`),
  CONSTRAINT `inventory_stock_layers_openingKey_key` UNIQUE (`openingKey`),
  CONSTRAINT `inventory_stock_layers_storeIngredientId_storeId_fkey`
    FOREIGN KEY (`storeIngredientId`, `storeId`)
    REFERENCES `store_ingredients` (`id`, `storeId`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `inventory_stock_layers_sourceMovementId_fkey`
    FOREIGN KEY (`sourceMovementId`) REFERENCES `stock_movements` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `inventory_stock_layers_quantity_check`
    CHECK (`originalQty` > 0 AND `remainingQty` >= 0 AND `remainingQty` <= `originalQty`),
  CONSTRAINT `inventory_stock_layers_unitCost_check` CHECK (`unitCost` >= 0),
  CONSTRAINT `inventory_stock_layers_sourceType_check` CHECK (TRIM(`sourceType`) <> '')
);

INSERT INTO `inventory_stock_layers` (
  `id`, `storeId`, `storeIngredientId`, `sourceMovementId`, `sourceType`,
  `openingKey`, `originalQty`, `remainingQty`, `unitCost`, `receivedAt`,
  `version`, `createdAt`, `updatedAt`
)
SELECT
  CONCAT('isl_migration_', SHA2(store_ingredient.`id`, 256)),
  store_ingredient.`storeId`,
  store_ingredient.`id`,
  NULL,
  'MIGRATION_OPENING',
  CONCAT('migration-opening:', SHA2(store_ingredient.`id`, 256)),
  store_ingredient.`stockQty`,
  store_ingredient.`stockQty`,
  GREATEST(
    COALESCE(
      store_ingredient.`costPerUnit`,
      (
        SELECT movement.`unitCost`
        FROM `stock_movements` AS movement
        WHERE movement.`storeId` = store_ingredient.`storeId`
          AND movement.`storeIngredientId` = store_ingredient.`id`
          AND movement.`unitCost` IS NOT NULL
        ORDER BY movement.`createdAt` DESC, movement.`id` DESC
        LIMIT 1
      ),
      ingredient.`costPerUnit`,
      0
    ),
    0
  ),
  CURRENT_TIMESTAMP(3),
  0,
  CURRENT_TIMESTAMP(3),
  CURRENT_TIMESTAMP(3)
FROM `store_ingredients` AS store_ingredient
INNER JOIN `ingredients` AS ingredient
  ON ingredient.`id` = store_ingredient.`ingredientId`
WHERE store_ingredient.`stockQty` > 0
  AND @inventory_catalogue_phase_one_complete = 0
ON DUPLICATE KEY UPDATE `id` = `inventory_stock_layers`.`id`;

SET @stock_layer_fifo_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_stock_layers'
      AND INDEX_NAME = 'inventory_stock_layers_storeIngredientId_receivedAt_id_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `inventory_stock_layers_storeIngredientId_receivedAt_id_idx` ON `inventory_stock_layers` (`storeIngredientId`, `receivedAt`, `id`)'
);
PREPARE stock_layer_fifo_index_stmt FROM @stock_layer_fifo_index_sql;
EXECUTE stock_layer_fifo_index_stmt;
DEALLOCATE PREPARE stock_layer_fifo_index_stmt;

SET @stock_layer_scope_index_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'inventory_stock_layers'
      AND INDEX_NAME = 'inventory_stock_layers_store_item_remaining_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `inventory_stock_layers_store_item_remaining_idx` ON `inventory_stock_layers` (`storeId`, `storeIngredientId`, `remainingQty`)'
);
PREPARE stock_layer_scope_index_stmt FROM @stock_layer_scope_index_sql;
EXECUTE stock_layer_scope_index_stmt;
DEALLOCATE PREPARE stock_layer_scope_index_stmt;

SET @invalid_category_link_errors := (
  SELECT COUNT(*)
  FROM `store_ingredients` AS store_ingredient
  LEFT JOIN `inventory_categories` AS category
    ON category.`id` = store_ingredient.`categoryId`
   AND category.`storeId` = store_ingredient.`storeId`
  WHERE category.`id` IS NULL
);
SET @missing_opening_layer_errors := (
  SELECT COUNT(*)
  FROM `store_ingredients` AS store_ingredient
  LEFT JOIN `inventory_stock_layers` AS layer
    ON layer.`storeIngredientId` = store_ingredient.`id`
   AND layer.`storeId` = store_ingredient.`storeId`
  WHERE store_ingredient.`stockQty` > 0
    AND layer.`id` IS NULL
);
SET @phase_one_final_guard_sql := IF(
  @invalid_category_link_errors = 0
  AND @missing_opening_layer_errors = 0,
  'SELECT 1',
  'SELECT * FROM `__inventory_catalogue_phase_one_postflight_failed__`'
);
PREPARE phase_one_final_guard_stmt FROM @phase_one_final_guard_sql;
EXECUTE phase_one_final_guard_stmt;
DEALLOCATE PREPARE phase_one_final_guard_stmt;

SELECT
  (
    EXISTS (
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_categories'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_stock_layers'
    )
    AND EXISTS (
      SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'inventory_stock_layers'
        AND INDEX_NAME = 'inventory_stock_layers_store_item_remaining_idx'
    )
    AND (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'store_ingredients'
        AND COLUMN_NAME IN ('name', 'nameKey', 'unit', 'categoryId')
        AND IS_NULLABLE = 'NO'
    ) = 4
    AND (
      SELECT COUNT(*) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'suppliers'
        AND COLUMN_NAME IN ('storeId', 'nameKey')
        AND IS_NULLABLE = 'NO'
    ) = 2
  ) AS `migration_complete`,
  @invalid_category_link_errors AS `invalid_category_links`,
  @missing_opening_layer_errors AS `missing_opening_layers`,
  (
    SELECT COUNT(*)
    FROM `inventory_stock_layers`
    WHERE `sourceType` = 'MIGRATION_OPENING'
      AND `unitCost` = 0
  ) AS `zero_cost_legacy_layers`,
  @movement_supplier_scope_errors AS `invalid_supplier_links`;
