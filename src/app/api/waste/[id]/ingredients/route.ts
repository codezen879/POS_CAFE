import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ingredientId = String(body.ingredientId || "");
  const qty = Math.round((Number(body.quantity) || 0) * 1000) / 1000;
  if (!ingredientId || qty <= 0) return jsonError("ingredientId and quantity are required", 400);

  try {
    const record = await prisma.wasteRecord.findUnique({ where: { id } });
    if (!record) return jsonError("Waste record not found", 404);

    const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
    if (!ingredient) return jsonError("Ingredient not found", 404);

    const available = Math.max(0, Number(ingredient.stockQty));
    const deduct = Math.min(qty, available);

    const movement = await prisma.$transaction(async (tx) => {
      await tx.ingredient.update({
        where: { id: ingredient.id },
        data: { stockQty: { decrement: deduct } },
      });
      return tx.stockMovement.create({
        data: {
          ingredientId: ingredient.id,
          type: "WASTAGE",
          quantity: qty,
          unitCost: ingredient.costPerUnit != null ? Number(ingredient.costPerUnit) : null,
          wasteRecordId: id,
          note: `Waste for ${record.source === "ORDER_CANCEL" ? "cancelled order" : "manual entry"}`,
        },
      });
    });

    return Response.json({ movement });
  } catch (e: any) {
    return jsonError(e.message || "Failed to add ingredient");
  }
}