import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard/dashboard";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo = new Date(todayStart.getTime() - 6 * 86400000);

  const [
    todayBills,
    weekBills,
    openSessions,
    activeOrders,
    tables,
    recentOrders,
    lowStock,
    topSellingItems,
    customerCount,
  ] = await Promise.all([
    prisma.bill.findMany({
      where: { status: "PAID", paidAt: { gte: todayStart } },
      include: { payments: true },
    }),
    prisma.bill.findMany({
      where: { status: "PAID", paidAt: { gte: weekAgo } },
      select: { total: true, paidAt: true },
    }),
    prisma.tableSession.count({ where: { status: "OPEN" } }),
    prisma.order.count({ where: { status: { in: ["SENT_TO_KITCHEN", "PREPARING", "READY", "PARTIALLY_SERVED"] } } }),
    prisma.diningTable.findMany({ select: { id: true, tableName: true, status: true } }),
    prisma.order.findMany({
      orderBy: { placedAt: "desc" },
      take: 8,
      include: { items: true, session: { include: { table: true } } },
    }),
    prisma.ingredient.findMany({
      where: { stockQty: { lte: prisma.ingredient.fields.reorderLevel } },
      orderBy: { stockQty: "asc" },
      take: 6,
    }),
    prisma.orderItem.groupBy({
      by: ["name"],
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 5,
    }),
    prisma.customer.count(),
  ]);

  return (
    <Dashboard
      todayRevenue={todayBills.reduce((s, b) => s + Number(b.total), 0)}
      todayOrders={todayBills.length}
      weekRevenue={weekBills.reduce((s, b) => s + Number(b.total), 0)}
      weekSeries={buildWeekSeries(weekBills)}
      openSessions={openSessions}
      activeOrders={activeOrders}
      tables={tables as any}
      recentOrders={recentOrders.map((o: any) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        status: o.status,
        placedAt: o.placedAt instanceof Date ? o.placedAt.toISOString() : o.placedAt,
        items: (o.items ?? []).map((it: any) => ({ id: it.id, name: it.name, quantity: it.quantity })),
        session: { table: o.session?.table ? { tableName: o.session.table.tableName } : null },
      })) as any}
      lowStock={lowStock.map((i: any) => ({
        id: i.id,
        name: i.name,
        unit: i.unit,
        stockQty: Number(i.stockQty),
        reorderLevel: Number(i.reorderLevel),
      })) as any}
      topSelling={topSellingItems as any}
      customerCount={customerCount}
    />
  );
}

function buildWeekSeries(bills: { total: { toString(): string }; paidAt: Date | null }[]) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    return d.toLocaleDateString("en-IN", { weekday: "short" });
  });
  return days.map((label, i) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - i));
    const total = bills
      .filter((b) => b.paidAt && new Date(b.paidAt).toDateString() === date.toDateString())
      .reduce((s, b) => s + Number(b.total), 0);
    return { label, revenue: Math.round(total) };
  });
}