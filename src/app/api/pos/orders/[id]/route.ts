import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { REUSE_OFFER_PENDING } from "@/lib/ready-pool";
import { jsonError } from "@/lib/utils";
import {
  recordOrderItemEvent,
  recordWasteForOrderItem,
  rollupOrderStatus,
} from "@/lib/order-item-workflow";

const ORDER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER"];

// Order state is derived from dish lines. This endpoint intentionally supports
// only a bulk cancellation so callers cannot bypass item-level transition rules.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...ORDER_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const status = String(body.status || "").toUpperCase();
  const reason = String(body.reason || "").trim().slice(0, 191);
  const note = String(body.note || "").trim().slice(0, 1000) || null;
  const requestedDisposition = body.disposition ? String(body.disposition).toUpperCase() : undefined;

  if (status !== "CANCELLED") return jsonError("Order status is derived from its items", 400);
  if (!reason) return jsonError("A cancellation reason is required", 400);
  if (requestedDisposition && !["NONE", "WASTE", "READY_POOL"].includes(requestedDisposition)) {
    return jsonError("Invalid cancellation disposition", 400);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: { session: true, items: true },
      });
      if (!order) return jsonError("Order not found", 404);
      if (user.storeId && order.session?.storeId !== user.storeId) return jsonError("Forbidden", 403);

      const activeItems = order.items.filter((item) => ["ORDERED", "IN_PROCESS", "READY"].includes(item.status));
      if (activeItems.length === 0) return jsonError("Order has no cancellable items", 409);
      if (requestedDisposition === "NONE" && activeItems.some((item) => item.status === "READY")) {
        return jsonError("Prepared food must be kept ready or recorded as waste", 409);
      }
      const hasPreparedItems = activeItems.some((item) => item.status === "READY");

      const wasteRecords: any[] = [];
      const releasedSourceOrderIds = new Set<string>();
      for (const item of activeItems) {
        const prepared = item.status === "READY";
        const pendingReuseOffer = item.disposition === REUSE_OFFER_PENDING;
        const disposition = pendingReuseOffer
          ? "NONE"
          : !prepared && requestedDisposition === "READY_POOL"
          ? "NONE"
          : !prepared && hasPreparedItems && requestedDisposition === "WASTE"
            ? "NONE"
          : requestedDisposition ?? (prepared ? "WASTE" : "NONE");
        const nextStatus = prepared && disposition === "READY_POOL" ? "READY_POOL" : "CANCELLED";
        const releasedSource = pendingReuseOffer && item.reusedFromItemId
          ? await tx.orderItem.findUnique({
              where: { id: item.reusedFromItemId },
              select: { id: true, orderId: true, status: true },
            })
          : null;

        const changed = await tx.orderItem.updateMany({
          where: { id: item.id, status: item.status, version: (item as any).version ?? 0 },
          data: {
            status: nextStatus,
            cancelledAt: new Date(),
            cancelReason: reason,
            billable: false,
            disposition,
            priority: false,
            priorityAt: null,
            ...(pendingReuseOffer ? { reusedFromItemId: null } : {}),
            version: { increment: 1 },
          },
        });
        if (changed.count === 0) throw new Error(`${item.name} was already updated`);

        await recordOrderItemEvent(tx, {
          itemId: item.id,
          actorId: user.id,
          eventType: nextStatus === "READY_POOL" ? "MOVED_TO_READY_POOL" : "CANCELLED",
          fromStatus: item.status,
          toStatus: nextStatus,
          priorityBefore: item.priority,
          priorityAfter: false,
          reason,
          note,
          metadata: {
            disposition,
            bulkOrderCancel: true,
            releasedReadyPoolItemId: pendingReuseOffer ? item.reusedFromItemId : null,
          },
        });

        if (releasedSource) {
          await recordOrderItemEvent(tx, {
            itemId: releasedSource.id,
            actorId: user.id,
            eventType: "REUSE_OFFER_CANCELLED",
            fromStatus: releasedSource.status,
            toStatus: releasedSource.status,
            metadata: {
              targetOrderId: order.id,
              targetOrderNumber: order.orderNumber,
              targetItemId: item.id,
              bulkOrderCancel: true,
            },
          });
          releasedSourceOrderIds.add(releasedSource.orderId);
        }

        if (disposition === "WASTE") {
          const waste = await recordWasteForOrderItem(tx, {
            itemId: item.id,
            reason,
            note,
            actorId: user.id,
            source: "ORDER_CANCEL",
          });
          if (waste) wasteRecords.push(waste);
        }
      }

      for (const sourceOrderId of releasedSourceOrderIds) {
        await rollupOrderStatus(tx, sourceOrderId);
      }
      const updated = await rollupOrderStatus(tx, order.id);
      const totalCost = wasteRecords.reduce((sum, waste) => sum + Number(waste.totalCost ?? 0), 0);
      return Response.json({
        order: updated,
        waste: wasteRecords.length ? { records: wasteRecords, totalCost } : null,
      });
    });
  } catch (error: any) {
    return jsonError(error.message || "Failed to cancel order");
  }
}
