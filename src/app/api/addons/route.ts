import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const addons = await prisma.addonOption.findMany({
    orderBy: { name: "asc" },
    include: {
      _count: { select: { products: true } },
      category: { select: { id: true, name: true } },
    },
  });
  return Response.json({ addons });
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({}));
  const { name, flavour, price, categoryId } = body as { name?: string; flavour?: string; price?: number; categoryId?: string | null };
  if (!name || !name.trim()) return jsonError("Add-on name is required", 400);
  const value = price === undefined ? 0 : Number(price);
  if (Number.isNaN(value) || value < 0) return jsonError("Invalid price", 400);

  if (categoryId) {
    const cat = await prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { id: true } });
    if (!cat) return jsonError("Category not found", 400);
  }

  const addon = await prisma.addonOption.create({
    data: { name: name.trim(), flavour: flavour?.trim() || null, price: value, categoryId: categoryId || null },
    include: { category: { select: { id: true, name: true } } },
  });
  return Response.json({ addon }, { status: 201 });
}