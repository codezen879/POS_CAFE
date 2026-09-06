import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WasteList } from "@/components/waste/waste-list";
import { toPlain } from "@/lib/serialize";

export default async function WastePage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [records, ingredients, todayAgg] = await Promise.all([
    prisma.wasteRecord.findMany({
      orderBy: { recordedAt: "desc" },
      take: 200,
      include: {
        items: true,
        movements: { include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } } },
        recordedBy: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    }),
    prisma.ingredient.findMany({
      select: { id: true, name: true, unit: true, stockQty: true, costPerUnit: true },
      orderBy: { name: "asc" },
    }),
    prisma.wasteRecord.aggregate({
      where: { recordedAt: { gte: startOfToday } },
      _sum: { totalCost: true },
      _count: true,
    }),
  ]);

  return (
    <WasteList
      records={toPlain(records) as any}
      ingredients={toPlain(ingredients) as any}
      userRole={session.user.role as string}
      todayTotal={todayAgg._sum.totalCost ?? 0}
      todayCount={todayAgg._count}
    />
  );
}