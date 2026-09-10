import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { InventoryManager } from "@/components/inventory/inventory-manager";
import { toPlain } from "@/lib/serialize";

export default async function InventoryPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);

  const [ingredients, suppliers, movements] = await Promise.all([
    prisma.ingredient.findMany({ orderBy: { name: "asc" }, include: { supplier: true, recipe: true } }),
    prisma.supplier.findMany({ orderBy: { name: "asc" } }),
    prisma.stockMovement.findMany({ orderBy: { createdAt: "desc" }, take: 50, include: { ingredient: true } }),
  ]);

  return <InventoryManager ingredients={toPlain(ingredients) as any} suppliers={toPlain(suppliers) as any} movements={toPlain(movements) as any} isManager={isManager} />;
}