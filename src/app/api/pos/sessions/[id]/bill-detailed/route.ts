import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "WAITER");
  if (user instanceof Response) return user;

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
            where: { status: { not: "DRAFT" } },
            include: {
              items: {
                include: { addons: true },
                where: { status: { in: ["SERVED", "RETURNED"] }, billable: true },
              },
            },
          },
        },
      },
    },
  });
  if (bill?.session && user.storeId && (bill.session as any).storeId !== user.storeId) {
    return jsonError("Forbidden", 403);
  }
  return Response.json({ bill });
}
