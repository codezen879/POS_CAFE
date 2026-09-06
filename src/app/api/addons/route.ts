import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const addons = await prisma.addonOption.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { products: true, categoryAddons: true } } },
  });
  return Response.json({ addons });
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({}));
  const { name, flavour, price } = body as { name?: string; flavour?: string; price?: number };
  if (!name || !name.trim()) return jsonError("Add-on name is required", 400);
  const value = price === undefined ? 0 : Number(price);
  if (Number.isNaN(value) || value < 0) return jsonError("Invalid price", 400);

  const addon = await prisma.addonOption.create({
    data: { name: name.trim(), flavour: flavour?.trim() || null, price: value },
  });
  return Response.json({ addon }, { status: 201 });
}