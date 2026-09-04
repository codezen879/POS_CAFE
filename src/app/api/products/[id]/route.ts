import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const {
    name, code, categoryId, description, basePrice, costPrice, taxRateId,
    isVeg, isBestseller, isAvailable, prepTimeMins, maxOrderQty,
  } = body as any;

  const data: any = {};
  if (name !== undefined) data.name = name;
  if (code !== undefined) data.code = code || null;
  if (categoryId !== undefined) data.categoryId = categoryId;
  if (description !== undefined) data.description = description || null;
  if (basePrice !== undefined) data.basePrice = basePrice;
  if (costPrice !== undefined) data.costPrice = costPrice || null;
  if (taxRateId !== undefined) data.taxRateId = taxRateId || null;
  if (isVeg !== undefined) data.isVeg = isVeg;
  if (isBestseller !== undefined) data.isBestseller = isBestseller;
  if (isAvailable !== undefined) data.isAvailable = isAvailable;
  if (prepTimeMins !== undefined) data.prepTimeMins = prepTimeMins ? Number(prepTimeMins) : null;
  if (maxOrderQty !== undefined) data.maxOrderQty = maxOrderQty ? Number(maxOrderQty) : null;

  // handle addon relation replacement
  if (body.addonIds !== undefined) {
    await prisma.productAddon.deleteMany({ where: { productId: id } });
    await prisma.productAddon.createMany({
      data: (body.addonIds as string[]).map((addonId, i) => ({ productId: id, addonId, sortOrder: i })),
    });
  }

  const product = await prisma.product.update({
    where: { id },
    data,
    include: { addons: { include: { addon: true } } },
  });
  return Response.json({ product });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;
  await prisma.product.delete({ where: { id } });
  return Response.json({ ok: true });
}