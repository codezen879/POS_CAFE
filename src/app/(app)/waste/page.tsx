import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WasteList } from "@/components/waste/waste-list";
import { toPlain } from "@/lib/serialize";

export default async function WastePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const storeId = session.user.storeId;

  if (!storeId) {
    return (
      <div className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 sm:p-6">
        <h1 className="text-xl font-bold">Select an outlet to view waste</h1>
        <p className="mt-2 text-sm">
          Your account is not assigned to an outlet. Ask an administrator to assign one before
          viewing or recording waste.
        </p>
      </div>
    );
  }

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [rawRecords, storeInventory, todayAgg, store] = await Promise.all([
    prisma.wasteRecord.findMany({
      where: { storeId },
      orderBy: { recordedAt: "desc" },
      take: 200,
      include: {
        items: true,
        movements: {
          where: { storeId },
          include: {
            storeIngredient: {
              select: { ingredientId: true, name: true, unit: true },
            },
          },
        },
        recordedBy: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    prisma.storeIngredient.findMany({
      where: { storeId, isActive: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        ingredientId: true,
        name: true,
        unit: true,
        stockQty: true,
        costPerUnit: true,
      },
    }),
    prisma.wasteRecord.aggregate({
      where: {
        storeId,
        recordedAt: { gte: startOfToday },
      },
      _sum: { totalCost: true },
      _count: true,
    }),
    prisma.store.findUnique({ where: { id: storeId }, select: { name: true } }),
  ]);

  const ingredients = storeInventory.map((stock) => ({
    id: stock.ingredientId,
    name: stock.name,
    unit: stock.unit,
    stockQty: stock.stockQty,
    costPerUnit: stock.costPerUnit,
    storeIngredientId: stock.id,
    isStockConfigured: true,
  }));
  const records = rawRecords.map((record) => ({
    ...record,
    movements: record.movements.map((movement) => ({
      ...movement,
      ingredient: {
        id: movement.storeIngredient.ingredientId,
        name: movement.storeIngredient.name,
        unit: movement.storeIngredient.unit,
      },
    })),
  }));

  return (
    <WasteList
      records={toPlain(records) as any}
      ingredients={toPlain(ingredients) as any}
      userRole={session.user.role as string}
      todayTotal={todayAgg._sum.totalCost ?? 0}
      todayCount={todayAgg._count}
      storeName={store?.name ?? "Assigned outlet"}
    />
  );
}
