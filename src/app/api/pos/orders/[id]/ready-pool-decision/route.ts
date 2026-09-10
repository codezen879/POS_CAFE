import { apiAuth } from "@/lib/api";
import {
  recordOrderItemEvent,
  rollupOrderStatus,
} from "@/lib/order-item-workflow";
import { prisma } from "@/lib/prisma";
import { isExactReadyPoolMatch, REUSE_OFFER_PENDING } from "@/lib/ready-pool";
import { jsonError } from "@/lib/utils";

const WAITER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER"];

class ReadyPoolDecisionError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...WAITER_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const decision = String(body.decision || "").toUpperCase();
  if (!new Set(["USE", "NEW"]).has(decision)) {
    return jsonError("Choose whether to use the ready food or prepare new food", 400);
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id },
        include: {
          session: true,
          items: { include: { addons: true } },
        },
      });
      if (!order) throw new ReadyPoolDecisionError("Order not found", 404);
      if (user.storeId && order.session?.storeId !== user.storeId) {
        throw new ReadyPoolDecisionError("Forbidden", 403);
      }

      const pendingItems = order.items.filter(
        (item) =>
          item.status === "ORDERED" &&
          item.disposition === REUSE_OFFER_PENDING &&
          Boolean(item.reusedFromItemId)
      );
      if (pendingItems.length === 0) {
        throw new ReadyPoolDecisionError("This order no longer has a ready-food decision waiting");
      }

      const sourceIds = pendingItems.flatMap((item) =>
        item.reusedFromItemId ? [item.reusedFromItemId] : []
      );
      if (new Set(sourceIds).size !== sourceIds.length) {
        throw new ReadyPoolDecisionError("The ready-food offer is invalid. Prepare new food instead.");
      }

      const sourceItems = await tx.orderItem.findMany({
        where: {
          id: { in: sourceIds },
          ...(order.session?.storeId
            ? { order: { session: { is: { storeId: order.session.storeId } } } }
            : {}),
        },
        include: {
          addons: true,
          order: { select: { id: true, orderNumber: true } },
        },
      });
      const sourceById = new Map(sourceItems.map((item) => [item.id, item]));

      if (decision === "USE") {
        for (const target of pendingItems) {
          const source = target.reusedFromItemId
            ? sourceById.get(target.reusedFromItemId)
            : undefined;
          if (
            !source ||
            source.status !== "READY_POOL" ||
            source.billable ||
            !isExactReadyPoolMatch(target, source)
          ) {
            throw new ReadyPoolDecisionError(
              "Matching ready food is no longer available. Choose Prepare new."
            );
          }
        }
      }

      const sourceOrderIds = new Set<string>();
      for (const target of pendingItems) {
        const source = target.reusedFromItemId
          ? sourceById.get(target.reusedFromItemId)
          : undefined;
        const targetVersion = Number(target.version ?? 0);

        if (decision === "USE") {
          if (!source) throw new ReadyPoolDecisionError("Matching ready food is no longer available");
          const claimed = await tx.orderItem.updateMany({
            where: {
              id: source.id,
              status: "READY_POOL",
              billable: false,
              version: source.version,
            },
            data: {
              status: "REUSED",
              disposition: "REUSED",
              priority: false,
              priorityAt: null,
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1) {
            throw new ReadyPoolDecisionError("Matching ready food was just assigned elsewhere");
          }

          const assigned = await tx.orderItem.updateMany({
            where: {
              id: target.id,
              status: "ORDERED",
              disposition: REUSE_OFFER_PENDING,
              reusedFromItemId: source.id,
              version: targetVersion,
            },
            data: {
              status: "READY",
              disposition: null,
              readyAt: source.readyAt ?? new Date(),
              priority: false,
              priorityAt: null,
              version: { increment: 1 },
            },
          });
          if (assigned.count !== 1) {
            throw new ReadyPoolDecisionError("The guest order changed before the decision was saved");
          }

          await recordOrderItemEvent(tx, {
            itemId: source.id,
            actorId: user.id,
            eventType: "REUSED_FOR_ORDER",
            fromStatus: "READY_POOL",
            toStatus: "REUSED",
            reason: "Waiter accepted ready-food match",
            metadata: {
              targetOrderId: order.id,
              targetOrderNumber: order.orderNumber,
              targetItemId: target.id,
            },
          });
          await recordOrderItemEvent(tx, {
            itemId: target.id,
            actorId: user.id,
            eventType: "READY_POOL_ASSIGNED",
            fromStatus: "ORDERED",
            toStatus: "READY",
            priorityBefore: target.priority,
            priorityAfter: false,
            metadata: {
              reusedFromItemId: source.id,
              reusedFromOrderNumber: source.order.orderNumber,
              waiterDecision: "USE",
            },
          });
          sourceOrderIds.add(source.orderId);
        } else {
          const released = await tx.orderItem.updateMany({
            where: {
              id: target.id,
              status: "ORDERED",
              disposition: REUSE_OFFER_PENDING,
              reusedFromItemId: target.reusedFromItemId,
              version: targetVersion,
            },
            data: {
              disposition: null,
              reusedFromItemId: null,
              version: { increment: 1 },
            },
          });
          if (released.count !== 1) {
            throw new ReadyPoolDecisionError("The guest order changed before the decision was saved");
          }

          await recordOrderItemEvent(tx, {
            itemId: target.id,
            actorId: user.id,
            eventType: "REUSE_OFFER_DECLINED",
            fromStatus: "ORDERED",
            toStatus: "ORDERED",
            priorityBefore: target.priority,
            priorityAfter: target.priority,
            metadata: {
              tentativeReadyPoolItemId: target.reusedFromItemId,
              waiterDecision: "NEW",
            },
          });
          if (source) {
            await recordOrderItemEvent(tx, {
              itemId: source.id,
              actorId: user.id,
              eventType: "REUSE_OFFER_DECLINED",
              fromStatus: source.status,
              toStatus: source.status,
              metadata: {
                targetOrderId: order.id,
                targetOrderNumber: order.orderNumber,
                targetItemId: target.id,
              },
            });
            sourceOrderIds.add(source.orderId);
          }
        }
      }

      for (const sourceOrderId of sourceOrderIds) {
        await rollupOrderStatus(tx, sourceOrderId);
      }
      const rolledUpOrder = await rollupOrderStatus(tx, order.id);
      return { order: rolledUpOrder, resolvedItems: pendingItems.length };
    }, { isolationLevel: "Serializable" });

    return Response.json({
      ok: true,
      decision,
      order: result.order,
      resolvedItems: result.resolvedItems,
    });
  } catch (error: any) {
    if (error instanceof ReadyPoolDecisionError) return jsonError(error.message, error.status);
    if (error?.code === "P2034") {
      return jsonError("The ready-food offer changed. Refresh and try again.", 409);
    }
    return jsonError(error.message || "Failed to save ready-food decision");
  }
}
