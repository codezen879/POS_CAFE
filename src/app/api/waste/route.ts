import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

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

  const body = await req.json().catch(() => ({}));
  const reasons = ["DEFECTIVE_FOOD", "NOT_STARTED", "SPILLAGE", "EXPIRED", "OTHER"];
  const reason = body.reason || "OTHER";
  if (!reasons.includes(reason)) return jsonError("Invalid reason", 400);

  const items: any[] = Array.isArray(body.items) ? body.items : [];
  const ingredients: any[] = Array.isArray(body.ingredients) ? body.ingredients : [];
  const note = String(body.note || "").trim() || null;
  if (items.length === 0 && ingredients.length === 0) {
    return jsonError("Add at least one wasted item or ingredient", 400);
  }

  const wasteItems = items
    .map((raw: any) => {
      const quantity = Math.max(1, Math.floor(Number(raw.quantity) || 1));
      const unitCost = Math.round((Number(raw.unitCost) || 0) * 100) / 100;
      return { name: String(raw.name || "Item").slice(0, 200), quantity, unitCost, lineCost: Math.round(unitCost * quantity * 100) / 100 };
    })
    .filter((w: any) => w.name);
  const totalCost = Math.round(wasteItems.reduce((s: number, w: any) => s + w.lineCost, 0) * 100) / 100;

  try {
    return await prisma.$transaction(async (tx) => {
      const record = await tx.wasteRecord.create({
        data: {
          storeId: user.storeId ?? "",
          source: "MANUAL",
          reason: reason as any,
          note,
          totalCost,
          recordedById: user.id,
          items: { create: wasteItems.length ? wasteItems : undefined },
        },
        include: { items: true },
      });

      const movements: any[] = [];
      for (const raw of ingredients) {
        const ingredient = await tx.ingredient.findUnique({ where: { id: String(raw.ingredientId || "") } });
        if (!ingredient) continue;
        const qty = Math.max(0, Math.round((Number(raw.quantity) || 0) * 1000) / 1000);
        if (qty <= 0) continue;
        const available = Math.max(0, Number(ingredient.stockQty));
        const deduct = Math.min(qty, available);
        await tx.ingredient.update({
          where: { id: ingredient.id },
          data: { stockQty: { decrement: deduct } },
        });
        const mv = await tx.stockMovement.create({
          data: {
            ingredientId: ingredient.id,
            type: "WASTAGE",
            quantity: qty,
            unitCost: ingredient.costPerUnit != null ? Number(ingredient.costPerUnit) : null,
            wasteRecordId: record.id,
            note: note ?? "Manual waste entry",
          },
        });
        movements.push(mv);
      }

      return Response.json({ record, movements });
    });
  } catch (e: any) {
    return jsonError(e.message || "Failed to record waste");
  }
}