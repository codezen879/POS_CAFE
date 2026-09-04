import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: any = {};
  if (body.name !== undefined) data.name = body.name;
  if (body.email !== undefined) data.email = body.email;
  if (body.role !== undefined) data.role = body.role;
  if (body.isActive !== undefined) data.isActive = body.isActive;
  const updated = await prisma.user.update({ where: { id }, data });
  return Response.json({ user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, isActive: updated.isActive } });
}