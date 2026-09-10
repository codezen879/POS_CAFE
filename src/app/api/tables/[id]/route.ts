import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { tableName, floorId, seatCount, status, isActive } = body as any;

  try {
    const table = await prisma.diningTable.findUnique({ where: { id }, include: { sessions: { where: { status: "OPEN" } } } });
    if (!table) return jsonError("Table not found", 404);

    const data: any = {};
    if (tableName !== undefined) {
      if (!tableName) return jsonError("Table name cannot be empty", 400);
      data.tableName = tableName;
    }
    if (floorId !== undefined) data.floorId = floorId || null;
    if (status !== undefined) data.status = status;
    if (isActive !== undefined) data.isActive = isActive;

    // Adjust seats: if changed, sync the seat count (respecting open sessions)
    if (seatCount !== undefined) {
      const seats = Math.max(1, Math.floor(Number(seatCount)));
      const currentSeatCount = await prisma.tableSeat.count({ where: { tableId: id } });
      data.seatCount = seats;
      if (seats > currentSeatCount) {
        await prisma.tableSeat.createMany({
          data: Array.from({ length: seats - currentSeatCount }, (_, i) => ({
            tableId: id,
            seatNo: currentSeatCount + i + 1,
          })),
        });
      } else if (seats < currentSeatCount && table.sessions.length === 0) {
        // Remove seats from the top down
        const toRemove = await prisma.tableSeat.findMany({
          where: { tableId: id },
          orderBy: { seatNo: "desc" },
          take: currentSeatCount - seats,
          select: { id: true },
        });
        await prisma.tableSeat.deleteMany({ where: { id: { in: toRemove.map((s) => s.id) } } });
      }
      // If only shrinking while occupied, keep seats but update count label
    }

    const updated = await prisma.diningTable.update({
      where: { id },
      data,
      include: { floor: true },
    });
    return Response.json({ table: updated });
  } catch (e: any) {
    return jsonError(e.message || "Failed to update table");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const { id } = await params;

  const table = await prisma.diningTable.findUnique({ where: { id }, include: { sessions: { where: { status: "OPEN" } } } });
  if (!table) return jsonError("Table not found", 404);
  if (table.sessions.length > 0) return jsonError("Cannot delete an occupied table. Close its session first.", 400);

  await prisma.diningTable.delete({ where: { id } });
  return Response.json({ ok: true });
}