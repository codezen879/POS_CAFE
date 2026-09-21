-- Inventory master-data lifecycle support for MySQL.
-- Dynamic guards make the additive migration safe to resume or rerun.

SET @add_ingredient_active_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ingredients'
      AND COLUMN_NAME = 'isActive'
  ),
  'SELECT 1',
  'ALTER TABLE `ingredients` ADD COLUMN `isActive` BOOLEAN NOT NULL DEFAULT TRUE'
);
PREPARE add_ingredient_active_stmt FROM @add_ingredient_active_sql;
EXECUTE add_ingredient_active_stmt;
DEALLOCATE PREPARE add_ingredient_active_stmt;

UPDATE `ingredients`
SET `isActive` = TRUE
WHERE `isActive` IS NULL;

ALTER TABLE `ingredients`
  MODIFY COLUMN `isActive` BOOLEAN NOT NULL DEFAULT TRUE;

SET @add_ingredient_active_name_idx_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'ingredients'
      AND INDEX_NAME = 'ingredients_isActive_name_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `ingredients_isActive_name_idx` ON `ingredients`(`isActive`, `name`)'
);
PREPARE add_ingredient_active_name_idx_stmt FROM @add_ingredient_active_name_idx_sql;
EXECUTE add_ingredient_active_name_idx_stmt;
DEALLOCATE PREPARE add_ingredient_active_name_idx_stmt;

SET @add_supplier_active_name_idx_sql := IF(
  EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'suppliers'
      AND INDEX_NAME = 'suppliers_isActive_name_idx'
  ),
  'SELECT 1',
  'CREATE INDEX `suppliers_isActive_name_idx` ON `suppliers`(`isActive`, `name`)'
);
PREPARE add_supplier_active_name_idx_stmt FROM @add_supplier_active_name_idx_sql;
EXECUTE add_supplier_active_name_idx_stmt;
DEALLOCATE PREPARE add_supplier_active_name_idx_stmt;
