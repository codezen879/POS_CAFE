import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { name } = body as { name?: string };
  if (!name) return jsonError("Floor name is required", 400);

  const existing = await prisma.floor.findFirst({ where: { name: name } });
  if (existing) return jsonError(`Floor "${name}" already exists`, 409);

  const max = await prisma.floor.aggregate({ _max: { sortOrder: true } });
  const floor = await prisma.floor.create({ data: { name, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
  return Response.json({ floor }, { status: 201 });
}