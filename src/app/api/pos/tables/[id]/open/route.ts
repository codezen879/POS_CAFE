import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference } from "@/lib/utils";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { guestCount, customerId } = body;

  try {
    const table = await prisma.diningTable.findUnique({
      where: { id },
      include: { sessions: { where: { status: "OPEN" } } },
    });
    if (!table) return jsonError("Table not found", 404);
    if (table.sessions.length > 0) return jsonError("Table is already occupied", 409);

    const sessionNumber = generateReference("TAB");
    const session = await prisma.tableSession.create({
      data: {
        sessionNumber,
        storeId: table.storeId,
        tableId: table.id,
        guestCount: guestCount ?? 1,
        customerId: customerId ?? null,
        servedById: user.id,
      },
    });

    await prisma.diningTable.update({ where: { id }, data: { status: "OCCUPIED" } });

    return Response.json({ session }, { status: 201 });
  } catch (e: any) {
    return jsonError(e.message || "Failed to open table");
  }
}
