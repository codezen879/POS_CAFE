import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference, jsonError } from "@/lib/utils";
import { mergeProductAddons } from "@/lib/addons";
import { findExactReadyPoolMatches, REUSE_OFFER_PENDING } from "@/lib/ready-pool";
import {
  invalidateUnpaidBillForSession,
  recordOrderItemEvent,
  rollupOrderStatus,
} from "@/lib/order-item-workflow";

type ItemPayload = {
  productId: string;
  quantity?: number;
  note?: string;
  addons?: { id: string | null; quantity?: number }[];
};

type ReadyPoolDecision = "USE" | "NEW";

const ORDER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER", "CASHIER"];
const ORDER_TYPES = new Set(["DINE_IN", "TAKEAWAY", "DELIVERY", "ONLINE"]);
const MAX_ITEMS = 50;
const MAX_QTY = 99;

class OrderRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

class ReadyPoolChangedError extends Error {}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...ORDER_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { items, type, readyPoolDecision, readyPoolItemIds } = body as {
    items?: ItemPayload[];
    type?: string;
    readyPoolDecision?: ReadyPoolDecision;
    readyPoolItemIds?: string[];
  };

  if (!Array.isArray(items) || !items.length) return jsonError("Order has no items", 400);
  if (items.length > MAX_ITEMS) return jsonError("Too many items", 400);
  if (type !== undefined && (typeof type !== "string" || !ORDER_TYPES.has(type))) {
    return jsonError("Invalid order type", 400);
  }
  if (readyPoolDecision && !["USE", "NEW"].includes(readyPoolDecision)) {
    return jsonError("Invalid ready-pool choice", 400);
  }
  if (
    readyPoolDecision === "USE" &&
    (!Array.isArray(readyPoolItemIds) ||
      readyPoolItemIds.length === 0 ||
      readyPoolItemIds.length > items.length ||
      new Set(readyPoolItemIds).size !== readyPoolItemIds.length ||
      readyPoolItemIds.some(
        (itemId) => typeof itemId !== "string" || !itemId || itemId.length > 191
      ))
  ) {
    return jsonError("The ready-food selection is missing. Review the available food again.", 400);
  }
  for (const item of items) {
    if (!item || typeof item !== "object" || typeof item.productId !== "string" || !item.productId.trim()) {
      return jsonError("Every item needs a valid product", 400);
    }
    const quantity = item.quantity ?? 1;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return jsonError("Item quantity must be a whole number from 1 to 99", 400);
    }
    if (item.addons !== undefined && !Array.isArray(item.addons)) return jsonError("Invalid add-ons", 400);
    for (const addon of item.addons ?? []) {
      const addonQuantity = addon?.quantity ?? 1;
      if (!addon || (addon.id !== null && typeof addon.id !== "string") || !Number.isInteger(addonQuantity) || addonQuantity < 1) {
        return jsonError("Invalid add-on selection", 400);
      }
    }
  }

  try {
    const session = await prisma.tableSession.findUnique({ where: { id } });
    if (!session) return jsonError("Session not found", 404);
    if (session.status !== "OPEN") return jsonError("Session is not open", 400);
    if (user.storeId && session.storeId !== user.storeId) return jsonError("Forbidden", 403);
    const existingBill = await prisma.bill.findUnique({
      where: { sessionId: session.id },
      include: { payments: { select: { id: true } } },
    });
    if (existingBill && (existingBill.status === "PARTIALLY_PAID" || existingBill.status === "PAID" || existingBill.payments.length > 0)) {
      return jsonError("New items cannot be added after payment has started", 409);
    }

    const products = await prisma.product.findMany({
      where: { id: { in: items.map((item) => item.productId) }, isActive: true, isAvailable: true },
      include: {
        addons: { include: { addon: true } },
        category: { include: { addons: { where: { isActive: true } } } },
      },
    });
    const productById = new Map(products.map((product) => [product.id, product]));

    const prepared = items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new OrderRequestError("A selected product is unavailable");
      const quantity = item.quantity ?? 1;
      if (product.maxOrderQty && quantity > product.maxOrderQty) {
        throw new OrderRequestError(`${product.name} is limited to ${product.maxOrderQty} per order`);
      }

      const allowedAddons = new Map(mergeProductAddons(product as any).map((link) => [link.addon.id, link]));
      const seenAddons = new Set<string>();
      const addons = (item.addons ?? []).map((addon) => {
          if (!addon.id || seenAddons.has(addon.id)) throw new OrderRequestError("Duplicate or unknown add-on");
          seenAddons.add(addon.id);
          const link = allowedAddons.get(addon.id);
          if (!link || link.addon.isActive === false) throw new OrderRequestError("A selected add-on is unavailable");
          const addonQuantity = addon.quantity ?? 1;
          if ((link as any).maxSelect && addonQuantity > Number((link as any).maxSelect)) {
            throw new OrderRequestError(`${link.addon.name} allows at most ${(link as any).maxSelect}`);
          }
          const source = link.addon;
          return {
            addonId: source.id,
            name: source.name,
            price: source.price,
            quantity: Math.min(addonQuantity, 9),
          };
        });
      return {
        product,
        quantity,
        note: String(item.note || "").trim().slice(0, 191) || null,
        addons,
      };
    });

    const pendingOffers = await prisma.orderItem.findMany({
      where: {
        status: "ORDERED",
        disposition: REUSE_OFFER_PENDING,
        reusedFromItemId: { not: null },
        order: { session: { is: { storeId: session.storeId } } },
      },
      select: { reusedFromItemId: true },
    });
    const offeredPoolIds = pendingOffers.flatMap((offer) =>
      offer.reusedFromItemId ? [offer.reusedFromItemId] : []
    );

    const poolItems = await prisma.orderItem.findMany({
      where: {
        status: "READY_POOL",
        billable: false,
        ...(offeredPoolIds.length ? { id: { notIn: offeredPoolIds } } : {}),
        productId: { in: prepared.map((line) => line.product.id) },
        order: { session: { is: { storeId: session.storeId } } },
      },
      include: {
        addons: true,
        order: { select: { orderNumber: true } },
      },
      orderBy: [{ readyAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });

    const matches = findExactReadyPoolMatches(
      prepared.map((line) => ({
        productId: line.product.id,
        quantity: line.quantity,
        note: line.note,
        addons: line.addons,
      })),
      poolItems
    );

    const availableMatches = matches.filter((match): match is NonNullable<typeof match> => Boolean(match));
    if (availableMatches.length > 0 && !readyPoolDecision) {
      return Response.json(
        {
          code: "READY_POOL_AVAILABLE",
          error: "Matching prepared food is available",
          matches: availableMatches.map((match) => ({
            itemId: match.id,
            name: match.name,
            quantity: match.quantity,
            sourceOrderNumber: match.order.orderNumber,
            readyAt: match.readyAt,
          })),
        },
        { status: 409 }
      );
    }
    if (readyPoolDecision === "USE") {
      const currentMatchIds = availableMatches.map((match) => match.id);
      const expectedMatchIds = readyPoolItemIds ?? [];
      if (
        currentMatchIds.length !== expectedMatchIds.length ||
        currentMatchIds.some((itemId, index) => itemId !== expectedMatchIds[index])
      ) {
        return Response.json(
          {
            code: "READY_POOL_CHANGED",
            error: "The available ready food changed. Review it again before placing the order.",
          },
          { status: 409 }
        );
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const writableSession = await tx.tableSession.findUnique({
        where: { id: session.id },
        include: { bill: { include: { payments: { select: { id: true } } } } },
      });
      if (!writableSession || writableSession.status !== "OPEN") {
        throw new OrderRequestError("Session is no longer open", 409);
      }
      if (
        writableSession.bill &&
        (writableSession.bill.status === "PARTIALLY_PAID" ||
          writableSession.bill.status === "PAID" ||
          writableSession.bill.payments.length > 0)
      ) {
        throw new OrderRequestError("New items cannot be added after payment has started", 409);
      }

      const createdOrder = await tx.order.create({
        data: {
          orderNumber: generateReference("ORD"),
          sessionId: session.id,
          type: (type as any) || "DINE_IN",
          status: "SENT_TO_KITCHEN",
          tableId: session.tableId,
          orderedById: user.id,
          sentToKitchenAt: new Date(),
        },
      });
      await invalidateUnpaidBillForSession(tx, session.id);
      let reusedCount = 0;

      for (let index = 0; index < prepared.length; index += 1) {
        const line = prepared[index];
        const pool = readyPoolDecision === "USE" ? matches[index] : null;
        let reusedPool: typeof pool = null;

        if (pool) {
          const pendingOfferCount = await tx.orderItem.count({
            where: {
              status: "ORDERED",
              disposition: REUSE_OFFER_PENDING,
              reusedFromItemId: pool.id,
            },
          });
          if (pendingOfferCount > 0) {
            throw new ReadyPoolChangedError("The selected ready food is waiting for another waiter decision");
          }
          const claimed = await tx.orderItem.updateMany({
            where: { id: pool.id, status: "READY_POOL", billable: false, version: pool.version },
            data: { status: "REUSED", disposition: "REUSED", version: { increment: 1 } },
          });
          if (claimed.count !== 1) throw new ReadyPoolChangedError("The selected ready food was just assigned elsewhere");
          reusedPool = pool;
          reusedCount += 1;
        }

        const createdItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            productId: line.product.id,
            name: line.product.name,
            unitPrice: Number(line.product.basePrice),
            quantity: line.quantity,
            note: line.note,
            status: reusedPool ? "READY" : "ORDERED",
            requiresKitchen: line.product.requiresKitchen,
            readyAt: reusedPool ? reusedPool.readyAt ?? new Date() : null,
            reusedFromItemId: reusedPool?.id ?? null,
            addons: { create: line.addons },
          },
        });

        await recordOrderItemEvent(tx, {
          itemId: createdItem.id,
          actorId: user.id,
          eventType: reusedPool ? "READY_POOL_ASSIGNED" : "ORDERED",
          fromStatus: null,
          toStatus: reusedPool ? "READY" : "ORDERED",
          priorityAfter: false,
          metadata: reusedPool
            ? { reusedFromItemId: reusedPool.id, reusedFromOrderNumber: reusedPool.order.orderNumber }
            : { requiresKitchen: line.product.requiresKitchen },
        });

        if (reusedPool) {
          await recordOrderItemEvent(tx, {
            itemId: reusedPool.id,
            actorId: user.id,
            eventType: "REUSED_FOR_ORDER",
            fromStatus: "READY_POOL",
            toStatus: "REUSED",
            reason: "Matched to a new order",
            metadata: {
              targetOrderId: createdOrder.id,
              targetOrderNumber: createdOrder.orderNumber,
              targetItemId: createdItem.id,
            },
          });
          await rollupOrderStatus(tx, reusedPool.orderId);
        }
      }

      await rollupOrderStatus(tx, createdOrder.id);
      const order = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: { items: { include: { addons: true } } },
      });
      return { order, reusedCount };
    }, { isolationLevel: "Serializable" });

    return Response.json(
      { order: result.order, reusedReadyItems: result.reusedCount },
      { status: 201 }
    );
  } catch (error: any) {
    if (error instanceof ReadyPoolChangedError) return jsonError(error.message, 409);
    if (error instanceof OrderRequestError) return jsonError(error.message, error.status);
    if (error?.code === "P2034") return jsonError("Orders changed. Refresh and try again.", 409);
    return jsonError(error.message || "Failed to place order");
  }
}
