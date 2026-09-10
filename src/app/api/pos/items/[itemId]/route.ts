import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { REUSE_OFFER_PENDING } from "@/lib/ready-pool";
import { jsonError } from "@/lib/utils";
import {
  isOrderedItemStatus,
  isBillEligibleItem,
  invalidateUnpaidBillForSession,
  recordOrderItemEvent,
  recordWasteForOrderItem,
  rollupOrderStatus,
} from "@/lib/order-item-workflow";

const WAITER_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER"]);
const KITCHEN_ROLES = new Set(["SUPER_ADMIN", "ADMIN", "MANAGER", "KITCHEN"]);
const VALID_STATUSES = new Set(["READY", "SERVED", "CANCELLED", "RETURNED"]);
const CANCEL_DISPOSITIONS = new Set(["NONE", "WASTE", "READY_POOL"]);
const RETURN_DISPOSITIONS = new Set(["WASTE", "READY_POOL"]);

export async function PATCH(req: Request, { params }: { params: Promise<{ itemId: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER", "KITCHEN");
  if (user instanceof Response) return user;

  const itemId = (await params).itemId;
  const body = await req.json().catch(() => ({}));
  const status = body.status ? String(body.status).toUpperCase() : undefined;
  const priority = body.priority;
  const reason = String(body.reason || "").trim().slice(0, 191);
  const note = String(body.note || "").trim().slice(0, 1000) || null;
  const disposition = body.disposition ? String(body.disposition).toUpperCase() : undefined;
  const billable = body.billable;

  if (!status && priority === undefined) return jsonError("No item change requested", 400);
  if (status && !VALID_STATUSES.has(status)) return jsonError("Invalid status", 400);
  if (priority !== undefined && typeof priority !== "boolean") return jsonError("Invalid priority", 400);
  if (status && priority !== undefined) return jsonError("Change status and priority separately", 400);

  try {
    return await prisma.$transaction(async (tx) => {
      const item = await tx.orderItem.findUnique({
        where: { id: itemId },
        include: {
          addons: true,
          order: {
            include: {
              session: { include: { table: true, bill: { include: { payments: true } } } },
            },
          },
        },
      });
      if (!item) return jsonError("Item not found", 404);
      if (user.storeId && item.order.session?.storeId !== user.storeId) return jsonError("Forbidden", 403);

      const current = item.status;
      const currentVersion = Number((item as any).version ?? 0);
      const pendingReuseOffer = item.disposition === REUSE_OFFER_PENDING;

      if (status === current && priority === undefined) {
        return Response.json({ item, ok: true, idempotent: true });
      }

      if (priority !== undefined) {
        if (!WAITER_ROLES.has(user.role)) return jsonError("Only waiter staff can change priority", 403);
        if (pendingReuseOffer) return jsonError("Resolve the ready-food offer before changing priority", 409);
        if (!isOrderedItemStatus(current)) return jsonError("Only food waiting to be made can be prioritised", 409);
        if (!(item as any).requiresKitchen) return jsonError("Waiter-direct items do not enter the kitchen priority queue", 409);
        if (item.priority === priority) return Response.json({ item, ok: true, idempotent: true });

        const updatedCount = await tx.orderItem.updateMany({
          where: { id: item.id, status: current, version: currentVersion },
          data: {
            priority,
            priorityAt: priority ? new Date() : null,
            version: { increment: 1 },
          },
        });
        if (updatedCount.count === 0) return jsonError("Item was already updated by another action", 409);

        await recordOrderItemEvent(tx, {
          itemId: item.id,
          actorId: user.id,
          eventType: priority ? "PRIORITY_SET" : "PRIORITY_CLEARED",
          fromStatus: current,
          toStatus: current,
          priorityBefore: item.priority,
          priorityAfter: priority,
          note,
        });
        const updated = await tx.orderItem.findUnique({ where: { id: item.id }, include: { addons: true } });
        return Response.json({ item: updated, ok: true });
      }

      if (!status) return jsonError("Invalid item change", 400);

      const data: any = { version: { increment: 1 } };
      let eventType = status;
      let makeWaste = false;
      let wasteSource = "ITEM_CANCEL";
      let releasedOfferSource: { id: string; orderId: string; status: string } | null = null;

      if (status === "READY") {
        if (!KITCHEN_ROLES.has(user.role)) return jsonError("Only kitchen staff can mark food ready", 403);
        if (pendingReuseOffer) return jsonError("A waiter must resolve the ready-food offer first", 409);
        if (!isOrderedItemStatus(current)) return jsonError(`Item cannot move from ${current} to READY`, 409);
        if (!(item as any).requiresKitchen) return jsonError("This item is served directly by the waiter", 409);
        data.status = "READY";
        data.readyAt = new Date();
        data.priority = false;
        data.priorityAt = null;
        eventType = "MARKED_READY";
      } else if (status === "SERVED") {
        if (!WAITER_ROLES.has(user.role)) return jsonError("Only waiter staff can mark food served", 403);
        if (pendingReuseOffer) return jsonError("Resolve the ready-food offer before serving this item", 409);
        const waiterDirect = !(item as any).requiresKitchen && isOrderedItemStatus(current);
        if (current !== "READY" && !waiterDirect) {
          return jsonError("Kitchen items must be marked ready before they can be served", 409);
        }
        data.status = "SERVED";
        data.servedAt = new Date();
        data.readyAt = item.readyAt ?? (waiterDirect ? new Date() : null);
        data.priority = false;
        data.priorityAt = null;
        data.billable = true;
        data.disposition = null;
        eventType = waiterDirect ? "WAITER_DIRECT_SERVED" : "SERVED";
      } else if (status === "CANCELLED") {
        if (!WAITER_ROLES.has(user.role)) return jsonError("Only waiter staff can cancel food", 403);
        if (!["ORDERED", "IN_PROCESS", "READY", "READY_POOL"].includes(current)) {
          return jsonError(`Item cannot move from ${current} to CANCELLED`, 409);
        }
        if (!reason) return jsonError("A cancellation reason is required", 400);
        if (pendingReuseOffer && disposition && disposition !== "NONE") {
          return jsonError("A pending ready-food match can only be cancelled with no waste", 409);
        }
        if (current === "READY_POOL") {
          const pendingClaims = await tx.orderItem.count({
            where: {
              status: "ORDERED",
              disposition: REUSE_OFFER_PENDING,
              reusedFromItemId: item.id,
            },
          });
          if (pendingClaims > 0) {
            return jsonError("This ready food is waiting for a waiter decision and cannot be disposed yet", 409);
          }
        }
        if (pendingReuseOffer && item.reusedFromItemId) {
          releasedOfferSource = await tx.orderItem.findUnique({
            where: { id: item.reusedFromItemId },
            select: { id: true, orderId: true, status: true },
          });
        }
        const selectedDisposition = pendingReuseOffer
          ? "NONE"
          : disposition ?? (current === "READY" || current === "READY_POOL" ? "WASTE" : "NONE");
        if (!CANCEL_DISPOSITIONS.has(selectedDisposition)) return jsonError("Invalid cancellation disposition", 400);
        if (selectedDisposition === "READY_POOL" && !["READY", "READY_POOL"].includes(current)) {
          return jsonError("Only prepared food can be kept in the ready pool", 409);
        }
        if (["READY", "READY_POOL"].includes(current) && selectedDisposition === "NONE") {
          return jsonError("Prepared food must be kept ready or recorded as waste", 409);
        }

        data.status = selectedDisposition === "READY_POOL" ? "READY_POOL" : "CANCELLED";
        data.cancelledAt = new Date();
        data.cancelReason = reason;
        data.billable = false;
        data.disposition = selectedDisposition;
        data.priority = false;
        data.priorityAt = null;
        if (pendingReuseOffer) data.reusedFromItemId = null;
        if (selectedDisposition === "READY_POOL") data.readyAt = item.readyAt ?? new Date();
        makeWaste = selectedDisposition === "WASTE";
        eventType = selectedDisposition === "READY_POOL" ? "MOVED_TO_READY_POOL" : "CANCELLED";
      } else if (status === "RETURNED") {
        if (!WAITER_ROLES.has(user.role)) return jsonError("Only waiter staff can return served food", 403);
        if (current !== "SERVED") return jsonError(`Item cannot move from ${current} to RETURNED`, 409);
        if (!reason) return jsonError("A return reason is required", 400);
        if (!RETURN_DISPOSITIONS.has(disposition ?? "")) return jsonError("Choose waste or keep ready", 400);
        if (typeof billable !== "boolean") return jsonError("Choose whether the returned item remains billable", 400);
        if (disposition === "READY_POOL" && billable) {
          return jsonError("Food kept for another order cannot remain on the original bill", 409);
        }
        const bill = item.order.session?.bill;
        if (bill && (bill.status === "PAID" || bill.status === "PARTIALLY_PAID" || bill.payments.length > 0)) {
          return jsonError("This bill already has a payment. Use a refund or credit note instead.", 409);
        }

        data.status = disposition === "READY_POOL" ? "READY_POOL" : "RETURNED";
        data.returnedAt = new Date();
        data.returnReason = reason;
        data.billable = billable;
        data.disposition = disposition;
        data.priority = false;
        data.priorityAt = null;
        if (disposition === "READY_POOL") data.readyAt = new Date();
        makeWaste = disposition === "WASTE";
        wasteSource = "ITEM_RETURN";
        eventType = disposition === "READY_POOL" ? "RETURNED_TO_READY_POOL" : "RETURNED_TO_WASTE";
      }

      const updatedCount = await tx.orderItem.updateMany({
        where: { id: item.id, status: current, version: currentVersion },
        data,
      });
      if (updatedCount.count === 0) return jsonError("Item was already updated by another action", 409);

      const wasBillEligible = isBillEligibleItem(current, (item as any).billable);
      const isNowBillEligible = isBillEligibleItem(data.status, data.billable ?? (item as any).billable);
      if (wasBillEligible !== isNowBillEligible) {
        await invalidateUnpaidBillForSession(tx, item.order.sessionId);
      }

      await recordOrderItemEvent(tx, {
        itemId: item.id,
        actorId: user.id,
        eventType,
        fromStatus: current,
        toStatus: data.status,
        priorityBefore: item.priority,
        priorityAfter: data.priority ?? item.priority,
        reason: reason || null,
        note,
        metadata: {
          disposition: data.disposition ?? null,
          billable: data.billable ?? (item as any).billable,
          releasedReadyPoolItemId: pendingReuseOffer ? item.reusedFromItemId : null,
          tableName: item.order.session?.table?.tableName ?? null,
          orderNumber: item.order.orderNumber,
        },
      });

      if (releasedOfferSource) {
        await recordOrderItemEvent(tx, {
          itemId: releasedOfferSource.id,
          actorId: user.id,
          eventType: "REUSE_OFFER_CANCELLED",
          fromStatus: releasedOfferSource.status,
          toStatus: releasedOfferSource.status,
          metadata: {
            targetOrderId: item.orderId,
            targetOrderNumber: item.order.orderNumber,
            targetItemId: item.id,
          },
        });
        await rollupOrderStatus(tx, releasedOfferSource.orderId);
      }

      const waste = makeWaste
        ? await recordWasteForOrderItem(tx, {
            itemId: item.id,
            reason,
            note,
            actorId: user.id,
            source: wasteSource,
          })
        : status === "RETURNED" && disposition === "READY_POOL"
          ? await recordWasteForOrderItem(tx, {
              itemId: item.id,
              reason,
              note,
              actorId: user.id,
              source: "ITEM_RETURN_READY_POOL",
              trackingOnly: true,
            })
          : null;
      const updated = await tx.orderItem.findUnique({ where: { id: item.id }, include: { addons: true } });
      const order = await rollupOrderStatus(tx, item.orderId);
      return Response.json({ item: updated, order, waste, ok: true });
    }, { isolationLevel: "Serializable" });
  } catch (error: any) {
    if (error?.code === "P2034") {
      return jsonError("The item or bill changed at another screen. Refresh and try again.", 409);
    }
    return jsonError(error.message || "Failed to update item");
  }
}
