import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { name } = body as { name?: string };
  if (!name) return jsonError("Floor name is required", 400);

  const existing = await prisma.floor.findFirst({ where: { name: name, id: { not: id } } });
  if (existing) return jsonError(`Floor "${name}" already exists`, 409);

  try {
    const floor = await prisma.floor.update({ where: { id }, data: { name } });
    return Response.json({ floor });
  } catch (e: any) {
    return jsonError(e.message || "Failed to update floor");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;

  const count = await prisma.diningTable.count({ where: { floorId: id } });
  if (count > 0) return jsonError(`Cannot delete: ${count} table(s) are assigned to this floor. Move them first.`, 400);

  try {
    await prisma.floor.delete({ where: { id } });
    return Response.json({ ok: true });
  } catch (e: any) {
    return jsonError(e.message || "Failed to delete floor");
  }
}