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

  // Each add-on belongs to exactly ONE category (parent → child), so assigning
  // addonIds = re-parenting those add-ons here; any add-ons currently owned by
  // this category but NOT in the list are unlinked (parent → null).
  if (body.addonIds !== undefined) {
    const addonIds = Array.isArray(body.addonIds) ? (body.addonIds as string[]).filter(Boolean) : [];
    const want = new Set(addonIds);
    const current = await prisma.addonOption.findMany({ where: { categoryId: id }, select: { id: true } });
    const toDetach = current.filter((a) => !want.has(a.id)).map((a) => a.id);
    if (want.size > 0) {
      await prisma.addonOption.updateMany({
        where: { id: { in: addonIds } },
        data: { categoryId: id },
      });
    }
    if (toDetach.length > 0) {
      await prisma.addonOption.updateMany({
        where: { id: { in: toDetach } },
        data: { categoryId: null },
      });
    }
  }

  const updated = await prisma.menuCategory.update({
    where: { id },
    data,
    include: { addons: { where: { isActive: true }, orderBy: { name: "asc" } } },
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