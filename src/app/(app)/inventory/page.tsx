import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryManager } from "@/components/inventory/inventory-manager";
import { toPlain } from "@/lib/serialize";

export default async function InventoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);
  const storeId = session.user.storeId;

  if (!storeId) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-6">
        <h1 className="text-xl font-bold">Select an outlet to view inventory</h1>
        <p className="mt-2 text-sm">
          Your account is not assigned to an outlet. Ask an administrator to assign one before
          viewing or changing stock.
        </p>
      </div>
    );
  }

  const [catalogue, storeInventory, suppliers, movements, store] = await Promise.all([
    prisma.ingredient.findMany({
      orderBy: { name: "asc" },
      include: { recipe: true, supplier: true },
    }),
    prisma.storeIngredient.findMany({
      where: { storeId },
      include: { preferredSupplier: true },
    }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.stockMovement.findMany({
      where: { storeId },
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { ingredient: true },
    }),
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
  ]);

  const inventoryByIngredient = new Map(
    storeInventory.map((stock) => [stock.ingredientId, stock])
  );
  const ingredients = catalogue.map((ingredient) => {
    const stock = inventoryByIngredient.get(ingredient.id);
    return {
      ...ingredient,
      stockQty: stock?.stockQty ?? 0,
      reorderLevel: stock?.reorderLevel ?? ingredient.reorderLevel,
      costPerUnit: stock?.costPerUnit ?? ingredient.costPerUnit,
      supplier: stock?.preferredSupplier ?? ingredient.supplier,
      storeIngredientId: stock?.id ?? null,
      isStockConfigured: Boolean(stock),
    };
  });

  return (
    <InventoryManager
      ingredients={toPlain(ingredients) as any}
      suppliers={toPlain(suppliers) as any}
      movements={toPlain(movements) as any}
      isManager={isManager}
      storeName={store?.name ?? "Assigned outlet"}
    />
  );
}
