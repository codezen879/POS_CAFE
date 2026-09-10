import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

class WasteRequestError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

export async function GET(req: Request) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const url = new URL(req.url);
  const reason = url.searchParams.get("reason") || undefined;
  const source = url.searchParams.get("source") || undefined;
  const from = url.searchParams.get("from") || undefined;
  const to = url.searchParams.get("to") || undefined;
  const limit = Math.min(Number(url.searchParams.get("limit") || 200), 500);

  try {
    const records = await prisma.wasteRecord.findMany({
      where: {
        reason: reason as any,
        source,
        ...(user.storeId ? { storeId: user.storeId } : {}),
        ...(from || to
          ? {
              recordedAt: {
                ...(from ? { gte: new Date(from) } : {}),
                ...(to ? { lte: new Date(to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { recordedAt: "desc" },
      take: limit,
      include: {
        items: true,
        movements: { include: { ingredient: { select: { id: true, name: true, unit: true, costPerUnit: true } } } },
        recordedBy: { select: { id: true, name: true } },
        order: { select: { id: true, orderNumber: true } },
      },
    });
    return Response.json({ records });
  } catch (e: any) {
    return jsonError(e.message || "Failed to load waste records");
  }
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  if (!user.storeId) return jsonError("Select a store before recording waste", 400);

  const body = await req.json().catch(() => ({}));
  const reasons = ["DEFECTIVE_FOOD", "NOT_STARTED", "SPILLAGE", "EXPIRED", "OTHER"];
  const reason = body.reason || "OTHER";
  if (!reasons.includes(reason)) return jsonError("Invalid reason", 400);

  const items: any[] = Array.isArray(body.items) ? body.items : [];
  const ingredients: any[] = Array.isArray(body.ingredients) ? body.ingredients : [];
  const note = String(body.note || "").trim().slice(0, 191) || null;
  if (items.length === 0 && ingredients.length === 0) {
    return jsonError("Add at least one wasted item or ingredient", 400);
  }

  const wasteItems = items
    .map((raw: any) => {
      const requestedQuantity = Number(raw.quantity);
      const requestedUnitCost = Number(raw.unitCost);
      const quantity = Number.isFinite(requestedQuantity)
        ? Math.max(1, Math.floor(requestedQuantity))
        : 1;
      const unitCost = Number.isFinite(requestedUnitCost)
        ? Math.max(0, Math.round(requestedUnitCost * 100) / 100)
        : 0;
      return { name: String(raw.name || "Item").slice(0, 191), quantity, unitCost, lineCost: Math.round(unitCost * quantity * 100) / 100 };
    })
    .filter((w: any) => w.name);
  const itemTotalCost = Math.round(
    wasteItems.reduce((s: number, w: any) => s + w.lineCost, 0) * 100
  ) / 100;
  const requestedIngredients = new Map<string, number>();
  for (const raw of ingredients) {
    const ingredientId = String(raw?.ingredientId || "").trim();
    const requestedQty = Number(raw?.quantity);
    const quantity = Number.isFinite(requestedQty) ? Math.round(requestedQty * 1000) / 1000 : 0;
    if (!ingredientId || ingredientId.length > 191 || quantity <= 0) {
      return jsonError("Every ingredient needs a valid positive quantity", 400);
    }
    requestedIngredients.set(
      ingredientId,
      Math.round(((requestedIngredients.get(ingredientId) ?? 0) + quantity) * 1000) / 1000
    );
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.wasteRecord.create({
        data: {
          storeId: user.storeId,
          source: "MANUAL",
          reason: reason as any,
          note,
          totalCost: itemTotalCost,
          recordedById: user.id,
          items: { create: wasteItems.length ? wasteItems : undefined },
        },
        include: { items: true },
      });

      const movements: any[] = [];
      let ingredientTotalCost = 0;
      for (const [ingredientId, qty] of requestedIngredients) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: ingredientId } });
        if (!ingredient) throw new WasteRequestError("A selected ingredient no longer exists", 400);
        const available = Math.max(0, Number(ingredient.stockQty));
        if (available < qty) {
          throw new WasteRequestError(
            `${ingredient.name} has only ${available} available; ${qty} was requested`
          );
        }
        const claimed = await tx.ingredient.updateMany({
          where: { id: ingredient.id, stockQty: { gte: qty } },
          data: { stockQty: { decrement: qty } },
        });
        if (claimed.count !== 1) {
          throw new WasteRequestError(`${ingredient.name} stock changed. Refresh and try again.`);
        }
        const unitCost = ingredient.costPerUnit != null ? Number(ingredient.costPerUnit) : null;
        const mv = await tx.stockMovement.create({
          data: {
            ingredientId: ingredient.id,
            type: "WASTAGE",
            quantity: qty,
            unitCost,
            wasteRecordId: record.id,
            note: note ?? "Manual waste entry",
          },
        });
        movements.push(mv);
        if (unitCost !== null) ingredientTotalCost += qty * unitCost;
      }

      if (wasteItems.length === 0 && movements.length === 0) {
        throw new WasteRequestError("No available stock or waste items were recorded", 400);
      }

      const finalTotalCost = Math.round((itemTotalCost + ingredientTotalCost) * 100) / 100;
      const savedRecord = ingredientTotalCost > 0
        ? await tx.wasteRecord.update({
            where: { id: record.id },
            data: { totalCost: finalTotalCost },
            include: { items: true },
          })
        : record;

      return Response.json({ record: savedRecord, movements });
    }, { isolationLevel: "Serializable" });
  } catch (error: any) {
    if (error instanceof WasteRequestError) return jsonError(error.message, error.status);
    if (error?.code === "P2034") {
      return jsonError("Stock changed while waste was recorded. Refresh and try again.", 409);
    }
    return jsonError(error.message || "Failed to record waste");
  }
}
