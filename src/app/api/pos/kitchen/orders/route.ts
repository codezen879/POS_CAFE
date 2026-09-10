import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { REUSE_OFFER_PENDING } from "@/lib/ready-pool";

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER", "KITCHEN");
  if (user instanceof Response) return user;

  const orders = await prisma.order.findMany({
    where: {
      ...(user.storeId ? { session: { is: { storeId: user.storeId } } } : {}),
      items: {
        some: {
          requiresKitchen: true,
          status: { in: ["ORDERED", "IN_PROCESS", "READY", "READY_POOL"] },
          OR: [
            { disposition: null },
            { disposition: { not: REUSE_OFFER_PENDING } },
          ],
        },
      },
    },
    orderBy: { sentToKitchenAt: "asc" },
    include: {
      session: { include: { table: true } },
      items: {
        where: {
          requiresKitchen: true,
          status: { in: ["ORDERED", "IN_PROCESS", "READY", "READY_POOL"] },
          OR: [
            { disposition: null },
            { disposition: { not: REUSE_OFFER_PENDING } },
          ],
        },
        orderBy: [{ priority: "desc" }, { createdAt: "asc" }, { id: "asc" }],
        include: { addons: true },
      },
      orderedBy: { select: { name: true } },
    },
  });
  return Response.json({ orders });
}
