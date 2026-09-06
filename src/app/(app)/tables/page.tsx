import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { TableGrid } from "@/components/pos/table-grid";
import { toPlain } from "@/lib/serialize";
import { mergeProductAddons } from "@/lib/addons";

export default async function TablesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);

  const [tables, menu, store, customers] = await Promise.all([
    prisma.diningTable.findMany({
      orderBy: { tableName: "asc" },
      include: {
        floor: true,
        sessions: {
          where: { status: "OPEN" },
          orderBy: { openedAt: "desc" },
          include: {
            customer: true,
            orders: {
              orderBy: { placedAt: "desc" },
              include: {
                items: { include: { addons: true } },
              },
            },
          },
        },
      },
    }),
    prisma.menuCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
          include: {
            taxRate: true,
            addons: { include: { addon: true } },
            category: { include: { addons: { include: { addon: true } } } },
          },
        },
      },
    }),
    prisma.store.findFirst({ include: { taxRates: true } }),
    prisma.customer.findMany({ orderBy: { createdAt: "desc" }, take: 50 }),
  ]);

  // Effective add-ons for ordering = product add-ons + inherited category add-ons.
  for (const c of menu) {
    for (const p of c.products) (p as any).addons = mergeProductAddons(p);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Table Service</h1>
        <p className="text-sm text-muted-foreground">
          Select a table to open a session, take orders and manage billing.
        </p>
      </div>
      <TableGrid
        tables={toPlain(tables) as any}
        menu={toPlain(menu) as any}
        store={toPlain(store) as any}
        customers={toPlain(customers) as any}
        isManager={isManager}
      />
    </div>
  );
}
