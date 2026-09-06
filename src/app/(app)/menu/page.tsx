import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MenuManager } from "@/components/menu/menu-manager";
import { toPlain } from "@/lib/serialize";

export default async function MenuPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);

const [categories, taxRates, addons, store] = await Promise.all([
    prisma.menuCategory.findMany({
      orderBy: { sortOrder: "asc" },
      include: {
        addons: { where: { isActive: true }, orderBy: { name: "asc" } },
        products: { orderBy: { sortOrder: "asc" }, include: { taxRate: true, addons: { include: { addon: true } } } },
      },
    }),
    prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    prisma.addonOption.findMany({ orderBy: { name: "asc" }, include: { category: { select: { id: true, name: true } } } }),
    prisma.store.findFirst(),
  ]);

  return <MenuManager categories={toPlain(categories) as any} taxRates={toPlain(taxRates) as any} addons={toPlain(addons) as any} store={toPlain(store) as any} isManager={isManager} />;
}