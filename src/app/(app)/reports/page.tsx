import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Reports } from "@/components/reports/reports";
import { toPlain } from "@/lib/serialize";

export default async function ReportsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const days = 30;
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const [bills, taxLines, topProducts, topAddons, loyaltyEarned, perCategory] = await Promise.all([
    prisma.bill.findMany({ where: { status: "PAID", paidAt: { gte: start } }, select: { id: true, total: true, paidAt: true, createdAt: true } }),
    prisma.billTaxLine.findMany({ where: { bill: { status: "PAID", paidAt: { gte: start } } } }),
    prisma.orderItem.groupBy({ by: ["name"], _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 10 }),
    prisma.orderItemAddon.groupBy({ by: ["name"], _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 6 }),
    prisma.loyaltyTransaction.aggregate({ where: { type: "EARN", createdAt: { gte: start } }, _sum: { points: true } }),
    prisma.orderItem.groupBy({
      by: ["productId"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 10,
    }),
  ]);

  const categoryRows = [];
  for (const g of perCategory) {
    if (!g.productId) continue;
    const p = await prisma.product.findUnique({ where: { id: g.productId }, include: { category: true } });
    if (p) categoryRows.push({ category: p.category.name, qty: g._sum.quantity ?? 0 });
  }

  return (
    <Reports
      bills={toPlain(bills) as any}
      taxLines={toPlain(taxLines) as any}
      topProducts={topProducts as any}
      topAddons={topAddons as any}
      categoryRows={categoryRows}
      loyaltyEarned={loyaltyEarned._sum.points ?? 0}
      days={days}
    />
  );
}