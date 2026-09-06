import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

const STATUS_FIELD: Record<string, string> = {
  PREPARING: "prepStartedAt",
  READY: "readyAt",
  SERVED: "servedAt",
  CANCELLED: "cancelledAt",
};

const CANCEL_REASONS = ["DEFECTIVE_FOOD", "NOT_STARTED", "OTHER"];
const PREP_STARTED = ["PREPARING", "READY"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status } = body as { status?: string };
  const reason = String(body.reason || "").trim() as string;
  const note = String(body.note || "").trim() || null;

  const validStatuses = ["SENT_TO_KITCHEN", "PREPARING", "READY", "PARTIALLY_SERVED", "SERVED", "CANCELLED"];
  if (!status || !validStatuses.includes(status)) return jsonError("Invalid status", 400);

  try {
    const order = await prisma.order.findUnique({
      where: { id },
      include: { session: { include: { table: true } } },
    });
    if (!order) return jsonError("Order not found", 404);
    if (order.status === "CANCELLED" || order.status === "SERVED") return jsonError("Order is final", 400);

    // --- Cancel policy --------------------------------------------------
    if (status === "CANCELLED") {
      if (order.status === "PARTIALLY_SERVED") {
        return jsonError("Order has been served — it must be billed and paid", 400);
      }
      const prepStarted = PREP_STARTED.includes(order.status as any);
      if (prepStarted) {
        if (!CANCEL_REASONS.includes(reason)) return jsonError("A cancellation reason is required", 400);
        if (reason !== "DEFECTIVE_FOOD") {
          const msg =
            order.status === "READY"
              ? "Order is already prepared — the guest must pay unless the food is defective."
              : "The kitchen is already preparing this order — it can only be cancelled if the food is defective.";
          return jsonError(msg, 409);
        }
      } else if (reason && !CANCEL_REASONS.includes(reason)) {
        return jsonError("Invalid cancellation reason", 400);
      }

      const wasteRecord = prepStarted ? await recordWasteFromOrder(order.id, order.orderNumber, note, user.id) : null;
      const updated = await prisma.order.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
        include: { items: true },
      });
      return Response.json({ order: updated, waste: wasteRecord });
    }

    const field = STATUS_FIELD[status];
    const data: any = {
      status: status as any,
      ...(field ? { [field]: new Date() } : {}),
    };

    const updated = await prisma.order.update({
      where: { id },
      data,
      include: { items: true },
    });

    return Response.json({ order: updated });
  } catch (e: any) {
    return jsonError(e.message || "Failed to update order");
  }
}

async function recordWasteFromOrder(orderId: string, orderNumber: string, note: string | null, userId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      session: { include: { table: true } },
      items: {
        include: {
          product: { include: { recipe: { include: { ingredient: true } } } },
        },
      },
    },
  });
  if (!order) return null;

  const wasteItems = order.items.map((it) => {
    const unitCost = it.product?.costPrice != null ? Number(it.product.costPrice) : Number(it.unitPrice);
    const lineCost = Math.round(unitCost * it.quantity * 100) / 100;
    return { orderItemId: it.id, name: it.name, quantity: it.quantity, unitCost, lineCost };
  });
  const totalCost = Math.round(wasteItems.reduce((s, w) => s + w.lineCost, 0) * 100) / 100;

  // Aggregate ingredient usage from the recipe map (base items only).
  const usage = new Map<string, { qty: number; ingredient: any }>();
  for (const it of order.items) {
    for (const r of it.product?.recipe ?? []) {
      const agg = usage.get(r.ingredientId) || { qty: 0, ingredient: r.ingredient };
      agg.qty += Number(r.qtyUsed) * it.quantity;
      usage.set(r.ingredientId, agg);
    }
  }

  return prisma.$transaction(async (tx) => {
    const waste = await tx.wasteRecord.create({
      data: {
        storeId: order.session?.storeId ?? "",
        source: "ORDER_CANCEL",
        orderId: order.id,
        sessionId: order.sessionId,
        tableName: order.session?.table?.tableName ?? null,
        reason: "DEFECTIVE_FOOD",
        note,
        totalCost,
        recordedById: userId,
        items: { create: wasteItems.length ? wasteItems : undefined },
        movements: {
          create: [...usage.values()].map(({ qty, ingredient }) => {
            const available = Math.max(0, Number(ingredient.stockQty));
            return {
              ingredientId: ingredient.id,
              type: "WASTAGE",
              quantity: Math.round(qty * 1000) / 1000,
              unitCost: ingredient.costPerUnit != null ? Number(ingredient.costPerUnit) : null,
              note: `Waste from ${orderNumber}`,
              ...(available > 0 ? { quantity: Math.round(Math.min(qty, available) * 1000) / 1000 } : {}),
            };
          }),
        },
      },
      include: { items: true, movements: true },
    });

    for (const { qty, ingredient } of usage.values()) {
      const available = Math.max(0, Number(ingredient.stockQty));
      const deduct = Math.min(qty, available);
      if (deduct > 0) {
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { stockQty: { decrement: deduct } },
        });
      }
    }

    return waste;
  });
}