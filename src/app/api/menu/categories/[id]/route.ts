import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, icon, isActive } = body as any;

  const category = await prisma.menuCategory.findUnique({ where: { id } });
  if (!category) return jsonError("Category not found", 404);

  const data: any = {};
  if (name !== undefined) {
    if (!name.trim()) return jsonError("Name is required", 400);
    data.name = name.trim();
  }
  if (icon !== undefined) data.icon = icon || null;
  if (isActive !== undefined) data.isActive = !!isActive;

  // replace category add-ons wholesale (mirrors the product route)
  if (body.addonIds !== undefined) {
    await prisma.categoryAddon.deleteMany({ where: { categoryId: id } });
    await prisma.categoryAddon.createMany({
      data: (body.addonIds as string[]).map((addonId, i) => ({ categoryId: id, addonId, sortOrder: i })),
    });
  }

  const updated = await prisma.menuCategory.update({
    where: { id },
    data,
    include: { addons: { include: { addon: true } } },
  });
  return Response.json({ category: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;

  const productCount = await prisma.product.count({ where: { categoryId: id } });
  if (productCount > 0) return jsonError("Category still has products — move or delete them first", 409);

  const category = await prisma.menuCategory.delete({ where: { id } }).catch(() => null);
  if (!category) return jsonError("Category not found", 404);
  return Response.json({ ok: true });
}