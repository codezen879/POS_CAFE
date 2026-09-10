const ORDERED_ITEM_STATUSES = new Set(["ORDERED", "IN_PROCESS"]);
const ACTIVE_ITEM_STATUSES = new Set(["ORDERED", "IN_PROCESS", "READY"]);
const TERMINAL_ITEM_STATUSES = new Set([
  "SERVED",
  "CANCELLED",
  "DEFECTIVE",
  "RETURNED",
  "REUSED",
  "READY_POOL",
]);

export function isOrderedItemStatus(status: string) {
  return ORDERED_ITEM_STATUSES.has(status);
}

export function isActiveItemStatus(status: string) {
  return ACTIVE_ITEM_STATUSES.has(status);
}

export function isBillEligibleItem(status: string, billable: boolean) {
  return billable && (status === "SERVED" || status === "RETURNED");
}

/** Marks an unpaid issued bill stale after its chargeable item set changes. */
export async function invalidateUnpaidBillForSession(tx: any, sessionId: string | null | undefined) {
  if (!sessionId) return { count: 0 };
  return tx.bill.updateMany({
    where: { sessionId, status: "ISSUED" },
    data: { status: "DRAFT" },
  });
}

export async function recordOrderItemEvent(
  tx: any,
  input: {
    itemId: string;
    actorId?: string | null;
    eventType: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    priorityBefore?: boolean | null;
    priorityAfter?: boolean | null;
    reason?: string | null;
    note?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  return tx.orderItemEvent.create({
    data: {
      itemId: input.itemId,
      actorId: input.actorId ?? null,
      eventType: input.eventType,
      fromStatus: input.fromStatus ?? null,
      toStatus: input.toStatus ?? null,
      priorityBefore: input.priorityBefore ?? null,
      priorityAfter: input.priorityAfter ?? null,
      reason: input.reason ?? null,
      note: input.note ?? null,
      metadata: input.metadata ? JSON.stringify(input.metadata) : null,
    },
  });
}

function wasteReason(reason?: string | null) {
  const normalized = String(reason || "").toUpperCase();
  return ["DEFECTIVE_FOOD", "NOT_STARTED", "SPILLAGE", "EXPIRED", "OTHER"].includes(normalized)
    ? normalized
    : "OTHER";
}

/**
 * Creates one idempotent waste/return record for a dish line. Actual loss
 * records apply the recipe deduction; tracking-only ready-pool returns do not.
 * The item lifecycle update and this function must share a DB transaction so
 * operational status, stock, and the audit record never drift apart.
 */
export async function recordWasteForOrderItem(
  tx: any,
  input: {
    itemId: string;
    reason?: string | null;
    note?: string | null;
    actorId?: string | null;
    source: string;
    /** Record the return for audit visibility without writing off food or stock. */
    trackingOnly?: boolean;
  }
) {
  const existing = await tx.wasteItem.findFirst({
    where: { orderItemId: input.itemId, wasteRecord: { source: input.source } },
    include: { wasteRecord: { include: { items: true, movements: true } } },
  });
  if (existing?.wasteRecord) return existing.wasteRecord;

  const item = await tx.orderItem.findUnique({
    where: { id: input.itemId },
    include: {
      order: { include: { session: { include: { table: true } } } },
      product: { include: { recipe: { include: { ingredient: true } } } },
    },
  });
  if (!item) return null;
  const storeId = item.order.session?.storeId;
  if (!storeId) throw new Error("Cannot record waste without a store session");

  const recipeUnitCost = (item.product?.recipe ?? []).reduce(
    (sum: number, recipeLine: any) =>
      sum + Number(recipeLine.qtyUsed) * Number(recipeLine.ingredient.costPerUnit ?? 0),
    0
  );
  const unitCost = item.product?.costPrice != null
    ? Number(item.product.costPrice)
    : recipeUnitCost > 0
      ? recipeUnitCost
      : Number(item.unitPrice);
  const lineCost = input.trackingOnly ? 0 : Math.round(unitCost * item.quantity * 100) / 100;
  const usage = new Map<string, { qty: number; ingredient: any }>();

  for (const recipeLine of item.product?.recipe ?? []) {
    const aggregate = usage.get(recipeLine.ingredientId) ?? { qty: 0, ingredient: recipeLine.ingredient };
    aggregate.qty += Number(recipeLine.qtyUsed) * item.quantity;
    usage.set(recipeLine.ingredientId, aggregate);
  }

  const reason = wasteReason(input.reason);
  const recordNote = [input.note, input.reason && reason === "OTHER" ? `Reason: ${input.reason}` : null]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 191) || null;
  const movements: {
    ingredientId: string;
    type: "WASTAGE";
    quantity: number;
    unitCost: number | null;
    note: string;
  }[] = [];

  if (!input.trackingOnly) {
    for (const { qty, ingredient } of usage.values()) {
      const deduct = Math.round(Math.min(qty, Math.max(0, Number(ingredient.stockQty))) * 1000) / 1000;
      if (deduct <= 0) continue;
      const claimed = await tx.ingredient.updateMany({
        where: { id: ingredient.id, stockQty: { gte: deduct } },
        data: { stockQty: { decrement: deduct } },
      });
      if (claimed.count === 1) {
        movements.push({
          ingredientId: ingredient.id,
          type: "WASTAGE",
          quantity: deduct,
          unitCost: ingredient.costPerUnit != null ? Number(ingredient.costPerUnit) : null,
          note: `Waste from ${item.order.orderNumber} (${item.name})`,
        });
      }
    }
  }

  const waste = await tx.wasteRecord.create({
    data: {
      storeId,
      source: input.source,
      orderId: item.orderId,
      sessionId: item.order.sessionId,
      tableName: item.order.session?.table?.tableName ?? null,
      reason,
      note: recordNote,
      totalCost: lineCost,
      recordedById: input.actorId ?? null,
      items: {
        create: {
          orderItemId: item.id,
          name: item.name,
          quantity: item.quantity,
          unitCost,
          lineCost,
          billable: item.billable,
        },
      },
      movements: movements.length ? { create: movements } : undefined,
    },
    include: { items: true, movements: true },
  });

  return waste;
}

/** Derives the coarse order state exclusively from its dish-line states. */
export async function rollupOrderStatus(tx: any, orderId: string) {
  const current = await tx.order.findUnique({ where: { id: orderId } });
  if (!current) return null;

  const items = await tx.orderItem.findMany({ where: { orderId } });
  if (items.length === 0) {
    return tx.order.update({ where: { id: orderId }, data: { status: "CANCELLED", cancelledAt: new Date() } });
  }

  const active = items.filter((item: any) => ACTIVE_ITEM_STATUSES.has(item.status));
  const hasServed = items.some(
    (item: any) => item.status === "SERVED" || (item.status === "RETURNED" && item.billable)
  );
  const hasTerminal = items.some((item: any) => TERMINAL_ITEM_STATUSES.has(item.status));

  let status = "PREPARING";
  if (active.length === 0) status = hasServed ? "SERVED" : "CANCELLED";
  else if (hasServed || hasTerminal) status = "PARTIALLY_SERVED";
  else if (active.every((item: any) => item.status === "READY")) status = "READY";
  else if (active.every((item: any) => ORDERED_ITEM_STATUSES.has(item.status))) status = "SENT_TO_KITCHEN";

  return tx.order.update({
    where: { id: orderId },
    data: {
      status,
      ...(status === "SERVED" ? { servedAt: current.servedAt ?? new Date() } : {}),
      ...(status === "CANCELLED" ? { cancelledAt: current.cancelledAt ?? new Date() } : {}),
    },
  });
}
