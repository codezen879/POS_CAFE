import { prisma } from "@/lib/prisma";

export async function GET() {
  const orders = await prisma.order.findMany({
    where: { status: { in: ["SENT_TO_KITCHEN", "PREPARING", "READY", "PARTIALLY_SERVED"] } },
    orderBy: { sentToKitchenAt: "asc" },
    include: {
      session: { include: { table: true } },
      items: { include: { addons: true } },
      orderedBy: { select: { name: true } },
    },
  });
  return Response.json({ orders });
}