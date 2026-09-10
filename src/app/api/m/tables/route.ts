import { prisma } from "@/lib/prisma";

export async function GET() {
  const tables = await prisma.diningTable.findMany({
    where: { sessions: { some: { status: "OPEN" } } },
    select: { id: true, tableName: true },
    orderBy: { tableName: "asc" },
  });
  return Response.json({ tables });
}