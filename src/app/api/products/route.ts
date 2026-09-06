import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const {
    name, code, categoryId, description, basePrice, costPrice,
    taxRateId, isVeg, isBestseller, isAvailable, prepTimeMins, maxOrderQty, addonIds,
  } = body as any;

  if (!name || !categoryId || basePrice == null) {
    return Response.json({ error: "Name, category and price are required" }, { status: 400 });
  }

  try {
    const addonIdsArr: string[] = Array.from(new Set(Array.isArray(addonIds) ? addonIds : []));
    if (addonIdsArr.length) {
      const rows = await prisma.addonOption.findMany({
        where: { id: { in: addonIdsArr } },
        select: { id: true, name: true, categoryId: true, category: { select: { name: true } } },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const missing = addonIdsArr.filter((aid) => !byId.has(aid));
      const wrongCat = rows.filter((r) => r.categoryId && r.categoryId !== categoryId);
      if (missing.length) {
        return Response.json({ error: "Unknown add-on(s) selected" }, { status: 400 });
      }
      if (wrongCat.length) {
        const c = await prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { name: true } });
        return Response.json(
          { error: `Add-on(s) "${wrongCat.map((a) => a.name).join(", ")}" belong to another category and can't be attached to "${c?.name ?? "this product"}"` },
          { status: 400 }
        );
      }
    }

    const product = await prisma.product.create({
      data: {
        name,
        code: code || null,
        categoryId,
        description: description || null,
        basePrice,
        costPrice: costPrice ?? null,
        taxRateId: taxRateId || null,
        isVeg: isVeg ?? true,
        isBestseller: isBestseller ?? false,
        isAvailable: isAvailable ?? true,
        prepTimeMins: prepTimeMins ? Number(prepTimeMins) : null,
        maxOrderQty: maxOrderQty ? Number(maxOrderQty) : null,
        addons: addonIdsArr.length
          ? { create: addonIdsArr.map((addonId, i) => ({ addonId, sortOrder: i })) }
          : undefined,
      },
    });
    return Response.json({ product }, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}