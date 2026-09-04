import { prisma } from "@/lib/prisma";
import { DiningMenu } from "@/components/dining/dining-menu";
import { toPlain } from "@/lib/serialize";

export const dynamic = "force-dynamic";

export default async function PublicMenuPage() {
  const [store, categories] = await Promise.all([
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
          },
        },
      },
    }),
  ]);

  return <DiningMenu store={toPlain(store) as any} categories={toPlain(categories) as any} />;
}