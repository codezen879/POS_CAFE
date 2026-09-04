import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { method, amount, transactionId } = body as { method?: string; amount?: number; transactionId?: string };

  if (!method || !amount || amount <= 0) return jsonError("Invalid payment", 400);

  try {
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { session: { include: { customer: true } }, payments: true },
    });
    if (!bill) return jsonError("Bill not found", 404);
    if (bill.status === "PAID" || bill.status === "VOID") return jsonError("Bill is already settled", 400);

    const alreadyPaid = Number(bill.paidAmount);
    const newPaid = alreadyPaid + amount;
    const due = Number(bill.dueAmount);
    const total = Number(bill.total);

    const payment = await prisma.payment.create({
      data: {
        billId: bill.id,
        method: method as any,
        amount,
        status: "COMPLETED",
        transactionId: transactionId || null,
        receivedById: user.id,
        paidAt: new Date(),
      },
    });

    const isPaid = newPaid >= total - 0.01;
    const updated = await prisma.$transaction(async (tx) => {
      const b = await tx.bill.update({
        where: { id: bill.id },
        data: {
          paidAmount: newPaid,
          dueAmount: Math.max(0, due - amount),
          status: isPaid ? "PAID" : "PARTIALLY_PAID",
          paidAt: isPaid ? new Date() : bill.paidAt,
        },
        include: { session: true },
      });

      if (isPaid) {
        // close session + free table
        await tx.tableSession.update({
          where: { id: bill.sessionId },
          data: { status: "CLOSED", closedAt: new Date() },
        });
        if (b.session.tableId) {
          await tx.diningTable.update({
            where: { id: b.session.tableId },
            data: { status: "AVAILABLE" },
          });
        }
        // loyalty
        const pointsSetting = await tx.setting.findUnique({
          where: { storeId_key: { storeId: b.session.storeId, key: "loyalty_points_per_rupee" } },
        });
        if (b.session.customerId) {
          const perRupee = Number(pointsSetting?.value ?? 1) || 1;
          const earned = Math.floor(total);
          await tx.customer.update({
            where: { id: b.session.customerId },
            data: { loyaltyPoints: { increment: earned } },
          });
          await tx.loyaltyTransaction.create({
            data: {
              customerId: b.session.customerId,
              points: earned,
              type: "EARN",
              description: `Earned from bill ${b.billNumber}`,
              billId: bill.id,
            },
          });
        }
      }
      return b;
    });

    return Response.json({ payment, bill: updated, settled: isPaid });
  } catch (e: any) {
    return jsonError(e.message || "Payment failed");
  }
}
