/**
 * Inventory master rows are shared by catalogue edits and outlet stock writes.
 * Taking the same row lock first makes unit/status checks and stock creation
 * serialize consistently on both PostgreSQL and MySQL.
 */
export async function lockIngredientMaster(tx: any, ingredientId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM ingredients
    WHERE id = ${ingredientId}
    FOR UPDATE
  `;
}

export async function lockSupplierMaster(tx: any, supplierId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM suppliers
    WHERE id = ${supplierId}
    FOR UPDATE
  `;
}

export async function lockInventoryCategoryMaster(tx: any, categoryId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM inventory_categories
    WHERE id = ${categoryId}
    FOR UPDATE
  `;
}

export async function lockStoreIngredientMaster(tx: any, storeIngredientId: string) {
  await tx.$queryRaw`
    SELECT id
    FROM store_ingredients
    WHERE id = ${storeIngredientId}
    FOR UPDATE
  `;
}
