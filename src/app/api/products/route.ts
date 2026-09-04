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
        addons: addonIds?.length
          ? { create: (addonIds as string[]).map((addonId, i) => ({ addonId, sortOrder: i })) }
          : undefined,
      },
    });
    return Response.json({ product }, { status: 201 });
  } catch (e: any) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}