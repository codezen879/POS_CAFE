import { prisma } from "@/lib/prisma";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { sessionId: id },
    include: {
      payments: true,
      taxLines: true,
      session: {
        include: {
          table: true,
          customer: true,
          orders: {
            where: { status: { notIn: ["CANCELLED", "DRAFT"] } },
            include: { items: { include: { addons: true } } },
          },
        },
      },
    },
  });
  return Response.json({ bill });
}
