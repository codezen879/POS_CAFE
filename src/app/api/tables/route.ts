import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const tables = await prisma.diningTable.findMany({
    orderBy: { tableName: "asc" },
    include: { floor: true, _count: { select: { sessions: true } } },
  });
  return Response.json({ tables });
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { tableName, floorId, seatCount } = body as { tableName?: string; floorId?: string; seatCount?: number };

  if (!tableName) return jsonError("Table name is required", 400);

  try {
    const store = await prisma.store.findFirst();
    if (!store) return jsonError("No store configured", 500);

    const existing = await prisma.diningTable.findFirst({ where: { storeId: store.id, tableName } });
    if (existing) return jsonError(`Table "${tableName}" already exists`, 409);

    const seats = Math.max(1, Math.floor(Number(seatCount ?? 2)));

    const table = await prisma.diningTable.create({
      data: {
        tableName,
        storeId: store.id,
        floorId: floorId || null,
        seatCount: seats,
        seats: { create: Array.from({ length: seats }, (_, i) => ({ seatNo: i + 1 })) },
      },
      include: { floor: true },
    });
    return Response.json({ table }, { status: 201 });
  } catch (e: any) {
    return jsonError(e.message || "Failed to create table");
  }
}