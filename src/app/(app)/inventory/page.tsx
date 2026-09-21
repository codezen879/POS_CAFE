import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryManager } from "@/components/inventory/inventory-manager";
import { toPlain } from "@/lib/serialize";

export default async function InventoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const hasMasterRole = ["SUPER_ADMIN", "ADMIN"].includes(session.user.role);
  const hasStockRole = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);
  if (!hasStockRole) redirect("/");

  const storeId = session.user.storeId;
  const canManageMasters = hasMasterRole && Boolean(storeId);
  const canManageStock = hasStockRole && Boolean(storeId);

  const [storeInventory, categories, suppliers, movements, store] = await Promise.all([
    storeId
      ? prisma.storeIngredient.findMany({
          where: {
            storeId,
            ...(hasMasterRole ? {} : { isActive: true }),
          },
          orderBy: [{ category: { sortOrder: "asc" } }, { name: "asc" }],
          include: {
            category: true,
            preferredSupplier: true,
            ingredient: {
              select: {
                id: true,
                isActive: true,
                _count: { select: { recipe: true } },
              },
            },
            layers: {
              where: { remainingQty: { gt: 0 } },
              select: { remainingQty: true, unitCost: true },
            },
            _count: { select: { movements: true, layers: true } },
          },
        })
      : Promise.resolve([]),
    storeId
      ? prisma.inventoryCategory.findMany({
          where: {
            storeId,
            ...(hasMasterRole ? {} : { isActive: true }),
          },
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: { _count: { select: { items: true } } },
        })
      : Promise.resolve([]),
    storeId
      ? prisma.supplier.findMany({
          where: {
            storeId,
            ...(hasMasterRole ? {} : { isActive: true }),
          },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    storeId
      ? prisma.stockMovement.findMany({
          where: { storeId },
          orderBy: { createdAt: "desc" },
          take: 50,
          include: {
            storeIngredient: {
              select: { id: true, ingredientId: true, name: true, unit: true },
            },
          },
        })
      : Promise.resolve([]),
    storeId
      ? prisma.store.findUnique({ where: { id: storeId }, select: { name: true } })
      : Promise.resolve(null),
  ]);

  const ingredients = storeInventory.map((stock) => ({
    id: stock.id,
    ingredientId: stock.ingredientId,
    storeIngredientId: stock.id,
    name: stock.name,
    unit: stock.unit,
    description: stock.description,
    categoryId: stock.categoryId,
    category: stock.category,
    dailyStockTracking: stock.dailyStockTracking,
    stockQty: stock.stockQty,
    reorderLevel: stock.reorderLevel,
    costPerUnit: stock.costPerUnit,
    stockValue: stock.layers.reduce(
      (total, layer) => total + Number(layer.remainingQty) * Number(layer.unitCost),
      0
    ),
    supplierId: stock.preferredSupplierId,
    supplier: stock.preferredSupplier,
    preferredSupplierId: stock.preferredSupplierId,
    isActive: stock.isActive,
    isStockConfigured: true,
    unitLocked:
      stock._count.movements > 0
      || stock._count.layers > 0
      || stock.ingredient._count.recipe > 0,
    createdAt: stock.createdAt,
    updatedAt: stock.updatedAt,
  }));

  const safeMovements = movements.map((movement) => ({
    ...movement,
    ingredient: movement.storeIngredient
      ? {
          id: movement.storeIngredient.ingredientId,
          name: movement.storeIngredient.name,
          unit: movement.storeIngredient.unit,
        }
      : null,
  }));

  return (
    <InventoryManager
      ingredients={toPlain(ingredients) as any}
      categories={toPlain(categories) as any}
      suppliers={toPlain(suppliers) as any}
      movements={toPlain(safeMovements) as any}
      canManageMasters={canManageMasters}
      canManageStock={canManageStock}
      hasOutlet={Boolean(storeId)}
      storeName={store?.name ?? "No outlet assigned"}
    />
  );
}
