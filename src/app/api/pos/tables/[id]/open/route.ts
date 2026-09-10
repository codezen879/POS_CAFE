import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference, jsonError } from "@/lib/utils";

const OPEN_TABLE_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER", "CASHIER"];

class OpenTableError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...OPEN_TABLE_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const guestCount = body.guestCount ?? 1;
  const customerId = body.customerId ?? null;

  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 99) {
    return jsonError("Guest count must be a whole number from 1 to 99", 400);
  }
  if (customerId !== null && typeof customerId !== "string") {
    return jsonError("Invalid customer", 400);
  }

  try {
    const session = await prisma.$transaction(async (tx) => {
      const table = await tx.diningTable.findUnique({ where: { id } });
      if (!table || !table.isActive) throw new OpenTableError("Table not found", 404);
      if (user.storeId && table.storeId !== user.storeId) throw new OpenTableError("Forbidden", 403);

      const claimed = await tx.diningTable.updateMany({
        where: { id: table.id, status: { in: ["AVAILABLE", "RESERVED"] } },
        data: { status: "OCCUPIED" },
      });
      if (claimed.count !== 1) throw new OpenTableError("Table is already occupied", 409);

      const openSession = await tx.tableSession.findFirst({
        where: { tableId: table.id, status: "OPEN" },
        select: { id: true },
      });
      if (openSession) throw new OpenTableError("Table is already occupied", 409);

      return tx.tableSession.create({
        data: {
          sessionNumber: generateReference("TAB"),
          storeId: table.storeId,
          tableId: table.id,
          guestCount,
          customerId,
          servedById: user.id,
        },
      });
    });

    return Response.json({ session }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof OpenTableError) return jsonError(error.message, error.status);
    return jsonError(error instanceof Error ? error.message : "Failed to open table");
  }
}
