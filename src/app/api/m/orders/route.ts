import { prisma } from "@/lib/prisma";
import { generateReference, jsonError } from "@/lib/utils";
import { mergeProductAddons } from "@/lib/addons";
import {
  invalidateUnpaidBillForSession,
  recordOrderItemEvent,
} from "@/lib/order-item-workflow";
import { findExactReadyPoolMatches, REUSE_OFFER_PENDING } from "@/lib/ready-pool";

type ItemPayload = {
  productId: string;
  quantity?: number;
  note?: string;
  addons?: { id: string; quantity?: number }[];
};

const MAX_ITEMS = 50;
const MAX_QTY = 99;
const MAX_ADDONS = 20;

class MobileOrderError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tableId, items } = body as { tableId?: string; items?: ItemPayload[] };

  if (typeof tableId !== "string" || !tableId.trim()) return jsonError("Table is required", 400);
  if (!Array.isArray(items) || items.length === 0) return jsonError("Order has no items", 400);
  if (items.length > MAX_ITEMS) return jsonError("Too many items", 400);
  for (const item of items) {
    const quantity = item?.quantity ?? 1;
    if (!item || typeof item.productId !== "string" || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QTY) {
      return jsonError("Invalid order item", 400);
    }
    if (item.addons !== undefined && !Array.isArray(item.addons)) return jsonError("Invalid add-ons", 400);
    if ((item.addons?.length ?? 0) > MAX_ADDONS) return jsonError("Too many add-ons", 400);
    for (const addon of item.addons ?? []) {
      const addonQuantity = addon?.quantity ?? 1;
      if (
        !addon ||
        typeof addon.id !== "string" ||
        !addon.id ||
        !Number.isInteger(addonQuantity) ||
        addonQuantity < 1 ||
        addonQuantity > 9
      ) {
        return jsonError("Invalid add-on", 400);
      }
    }
  }

  try {
    const table = await prisma.diningTable.findUnique({
      where: { id: tableId },
      include: { sessions: { where: { status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 1 } },
    });
    if (!table) return jsonError("Table not found", 404);
    const session = table.sessions[0];
    if (!session) return jsonError("This table is not open yet", 400);
    const order = await prisma.$transaction(async (tx) => {
      // Recheck all writable state inside the serializable transaction. This
      // prevents a mobile order from being appended while the cashier is
      // settling or closing the same table session.
      const writableSession = await tx.tableSession.findUnique({
        where: { id: session.id },
        include: { bill: { include: { payments: { select: { id: true } } } } },
      });
      if (!writableSession || writableSession.status !== "OPEN") {
        throw new MobileOrderError("This table is no longer open", 409);
      }
      if (
        writableSession.bill &&
        (writableSession.bill.status === "PARTIALLY_PAID" ||
          writableSession.bill.status === "PAID" ||
          writableSession.bill.payments.length > 0)
      ) {
        throw new MobileOrderError("This table is already settling its bill", 409);
      }

      // Hydrate product identities and add-on prices server-side so the guest
      // cannot tamper with names or prices.
      const products = await tx.product.findMany({
        where: { id: { in: items.map((item) => item.productId) }, isActive: true, isAvailable: true },
        include: {
          addons: { include: { addon: true } },
          category: { include: { addons: { where: { isActive: true } } } },
        },
      });
      const productById = new Map(products.map((product) => [product.id, product]));
      const prepared = items.map((it) => {
        const product = productById.get(it.productId);
        if (!product) throw new MobileOrderError("A selected product is unavailable", 409);
        const quantity = it.quantity ?? 1;
        if (product.maxOrderQty && quantity > product.maxOrderQty) {
          throw new MobileOrderError(`${product.name} is limited to ${product.maxOrderQty} per order`);
        }

        const addonById = new Map(mergeProductAddons(product as any).map((link) => [link.addon.id, link]));
        const seenAddons = new Set<string>();
        const addons = (it.addons ?? [])
          .map((addon) => ({ addon, link: addonById.get(addon.id) }))
          .map(({ addon, link }) => {
            if (!link || seenAddons.has(addon.id) || link.addon.isActive === false) {
              throw new MobileOrderError("A selected add-on is unavailable");
            }
            seenAddons.add(addon.id);
            const addonQuantity = addon.quantity ?? 1;
            if ((link as any).maxSelect && addonQuantity > Number((link as any).maxSelect)) {
              throw new MobileOrderError(`${link.addon.name} allows at most ${(link as any).maxSelect}`);
            }
            return {
              addonId: addon.id,
              name: link.addon.name,
              price: link.addon.price,
              quantity: addonQuantity,
            };
          });
        return {
          product,
          quantity,
          note: String(it.note || "").trim().slice(0, 191) || null,
          addons,
        };
      });

      const existingOffers = await tx.orderItem.findMany({
        where: {
          status: "ORDERED",
          disposition: REUSE_OFFER_PENDING,
          reusedFromItemId: { not: null },
          order: { session: { is: { storeId: writableSession.storeId } } },
        },
        select: { reusedFromItemId: true },
      });
      const offeredPoolIds = existingOffers.flatMap((offer) =>
        offer.reusedFromItemId ? [offer.reusedFromItemId] : []
      );
      const poolItems = await tx.orderItem.findMany({
        where: {
          status: "READY_POOL",
          billable: false,
          productId: { in: prepared.map((line) => line.product.id) },
          ...(offeredPoolIds.length ? { id: { notIn: offeredPoolIds } } : {}),
          order: { session: { is: { storeId: writableSession.storeId } } },
        },
        include: {
          addons: true,
          order: { select: { id: true, orderNumber: true } },
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

      const createdOrder = await tx.order.create({
        data: {
          orderNumber: generateReference("ORD"),
          sessionId: session.id,
          tableId: table.id,
          type: "DINE_IN",
          status: "SENT_TO_KITCHEN",
          sentToKitchenAt: new Date(),
        },
      });

      let reuseOfferCount = 0;
      for (let index = 0; index < prepared.length; index += 1) {
        const line = prepared[index];
        const pool = matches[index];
        const createdItem = await tx.orderItem.create({
          data: {
            orderId: createdOrder.id,
            productId: line.product.id,
            name: line.product.name,
            unitPrice: line.product.basePrice,
            quantity: line.quantity,
            note: line.note,
            status: "ORDERED",
            requiresKitchen: line.product.requiresKitchen,
            disposition: pool ? REUSE_OFFER_PENDING : null,
            reusedFromItemId: pool?.id ?? null,
            addons: { create: line.addons },
          },
        });

        await recordOrderItemEvent(tx, {
          itemId: createdItem.id,
          eventType: pool ? "REUSE_OFFER_CREATED" : "ORDERED",
          fromStatus: null,
          toStatus: "ORDERED",
          priorityAfter: false,
          metadata: pool
            ? {
                source: "MOBILE_ORDER",
                readyPoolItemId: pool.id,
                readyPoolOrderNumber: pool.order.orderNumber,
              }
            : { source: "MOBILE_ORDER", requiresKitchen: line.product.requiresKitchen },
        });

        if (pool) {
          reuseOfferCount += 1;
          await recordOrderItemEvent(tx, {
            itemId: pool.id,
            eventType: "REUSE_OFFERED_TO_GUEST_ORDER",
            fromStatus: "READY_POOL",
            toStatus: "READY_POOL",
            metadata: {
              targetOrderId: createdOrder.id,
              targetOrderNumber: createdOrder.orderNumber,
              targetItemId: createdItem.id,
            },
          });
        }
      }

      await invalidateUnpaidBillForSession(tx, session.id);
      const order = await tx.order.findUnique({
        where: { id: createdOrder.id },
        include: { items: { include: { addons: true } } },
      });
      return { order, reuseOfferCount };
    }, { isolationLevel: "Serializable" });

    return Response.json(
      {
        order: order.order,
        awaitingReuseDecision: order.reuseOfferCount > 0,
        reuseOfferCount: order.reuseOfferCount,
      },
      { status: 201 }
    );
  } catch (e: any) {
    if (e instanceof MobileOrderError) return jsonError(e.message, e.status);
    if (e?.code === "P2034") {
      return jsonError("The table changed while the order was placed. Please try again.", 409);
    }
    return jsonError(e.message || "Failed to place order");
  }
}
