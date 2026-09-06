import { prisma } from "@/lib/prisma";
import { DiningMenu } from "@/components/dining/dining-menu";
import { toPlain } from "@/lib/serialize";
import { mergeProductAddons } from "@/lib/addons";

export const dynamic = "force-dynamic";

export default async function PublicMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ table?: string }>;
}) {
  const { table: tableId } = await searchParams;

  const [store, categories, table] = await Promise.all([
    prisma.store.findFirst(),
    prisma.menuCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
      include: {
        products: {
          where: { isActive: true, isAvailable: true },
          orderBy: { sortOrder: "asc" },
          include: {
            addons: { include: { addon: true } },
            category: { include: { addons: { include: { addon: true } } } },
          },
        },
      },
    }),
    tableId
      ? prisma.diningTable.findUnique({
          where: { id: tableId },
          select: {
            id: true,
            tableName: true,
            sessions: { where: { status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 1, select: { id: true } },
          },
        })
      : Promise.resolve(null),
  ]);

  // Effective add-ons for the guest picker = product add-ons + inherited category add-ons.
  for (const c of categories) {
    for (const p of c.products) (p as any).addons = mergeProductAddons(p);
  }

  return (
    <DiningMenu
      store={toPlain(store) as any}
      categories={toPlain(categories) as any}
      table={toPlain(table) as any}
    />
  );
}