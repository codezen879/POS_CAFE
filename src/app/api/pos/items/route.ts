import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { REUSE_OFFER_PENDING } from "@/lib/ready-pool";
import { jsonError } from "@/lib/utils";

const WAITER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER"];
const KITCHEN_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "KITCHEN"];

// Shared, store-scoped feed for the Kitchen Display and Waiter board. Open
// table history is returned for the waiter; READY_POOL lines remain visible
// after their original table closes so prepared food is never lost.
export async function GET(req: Request) {
  const kitchenView = new URL(req.url).searchParams.get("view") === "kitchen";
  const user = await apiAuth(...(kitchenView ? KITCHEN_ROLES : WAITER_ROLES));
  if (user instanceof Response) return user;

  try {
    const sessions = await prisma.tableSession.findMany({
      where: {
        status: "OPEN",
        ...(user.storeId ? { storeId: user.storeId } : {}),
      },
      include: {
        table: { select: { tableName: true } },
        orders: {
          where: { status: { not: "DRAFT" } },
          include: {
            items: {
              ...(kitchenView
                ? {
                    where: {
                      requiresKitchen: true,
                      status: { in: ["ORDERED", "IN_PROCESS", "READY", "READY_POOL"] },
                      OR: [
                        { disposition: null },
                        { disposition: { not: REUSE_OFFER_PENDING } },
                      ],
                    },
                  }
                : {}),
              include: { addons: { select: { addonId: true, name: true, quantity: true } } },
              orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            },
            orderedBy: { select: { name: true } },
          },
          orderBy: [{ placedAt: "asc" }, { id: "asc" }],
        },
      },
      orderBy: [{ openedAt: "asc" }, { id: "asc" }],
    });

    const readyPool = await prisma.orderItem.findMany({
      where: {
        status: "READY_POOL",
        ...(kitchenView ? { requiresKitchen: true } : {}),
        ...(user.storeId
          ? { order: { session: { is: { storeId: user.storeId } } } }
          : {}),
      },
      include: {
        addons: { select: { addonId: true, name: true, quantity: true } },
        order: {
          include: {
            orderedBy: { select: { name: true } },
            session: { include: { table: { select: { tableName: true } } } },
          },
        },
      },
      orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const seen = new Set<string>();
    const items: any[] = [];
    const add = (item: any, order: any, session: any) => {
      if (seen.has(item.id)) return;
      seen.add(item.id);
      items.push({
        id: item.id,
        productId: item.productId,
        name: item.name,
        quantity: item.quantity,
        note: item.note,
        status: item.status,
        priority: item.priority,
        priorityAt: item.priorityAt,
        requiresKitchen: item.requiresKitchen,
        billable: item.billable,
        disposition: item.disposition,
        createdAt: item.createdAt,
        readyAt: item.readyAt,
        servedAt: item.servedAt,
        cancelledAt: item.cancelledAt,
        cancelReason: item.cancelReason,
        returnedAt: item.returnedAt,
        returnReason: item.returnReason,
        reusedFromItemId: item.reusedFromItemId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        sessionId: session?.id ?? order.sessionId,
        tableName: session?.table?.tableName ?? null,
        orderedBy: order.orderedBy?.name ?? null,
        addons: item.addons,
      });
    };

    for (const session of sessions) {
      for (const order of session.orders) {
        for (const item of order.items) add(item, order, session);
      }
    }
    for (const item of readyPool) add(item, item.order, item.order.session);

    return Response.json({ items });
  } catch (error: any) {
    return jsonError(error.message || "Failed to load items");
  }
}
