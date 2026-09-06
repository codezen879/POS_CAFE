import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name, flavour, price, isActive } = body as any;

  const data: any = {};
  if (name !== undefined) {
    if (!name.trim()) return jsonError("Add-on name is required", 400);
    data.name = name.trim();
  }
  if (flavour !== undefined) data.flavour = flavour?.trim() || null;
  if (price !== undefined) {
    const value = Number(price);
    if (Number.isNaN(value) || value < 0) return jsonError("Invalid price", 400);
    data.price = value;
  }
  if (isActive !== undefined) data.isActive = !!isActive;

  const addon = await prisma.addonOption.update({
    where: { id },
    data,
  }).catch(() => null);
  if (!addon) return jsonError("Add-on not found", 404);
  return Response.json({ addon });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;

  const linked = await prisma.orderItemAddon.count({ where: { addonId: id } });
  if (linked > 0) {
    return jsonError("Add-on is in use on past orders — set it inactive instead of deleting", 409);
  }

  const addon = await prisma.addonOption.delete({ where: { id } }).catch(() => null);
  if (!addon) return jsonError("Add-on not found", 404);
  return Response.json({ ok: true });
}