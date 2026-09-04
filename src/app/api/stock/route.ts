import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { ingredientId, type, quantity } = body;

  if (!ingredientId || !type || quantity == null) {
    return Response.json({ error: "ingredientId, type and quantity required" }, { status: 400 });
  }

  const ingredient = await prisma.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient) return Response.json({ error: "Ingredient not found" }, { status: 404 });

  const qty = Number(quantity);
  if (type === "OUT" && Number(ingredient.stockQty) + qty < 0) {
    return Response.json({ error: "Insufficient stock" }, { status: 400 });
  }

  const [updated] = await prisma.$transaction([
    prisma.ingredient.update({
      where: { id: ingredientId },
      data: { stockQty: { increment: qty } },
    }),
    prisma.stockMovement.create({
      data: { ingredientId, type, quantity: Math.abs(qty), note: body.note || null },
    }),
  ]);

  return Response.json({ ingredient: updated });
}