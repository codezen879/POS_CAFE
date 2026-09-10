import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

const PAYMENT_METHODS = new Set(["CASH", "CARD", "UPI", "WALLET", "SPLIT", "ON_ACCOUNT"]);

class PaymentRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "WAITER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const method = body.method;
  const amount = body.amount;
  const transactionId = body.transactionId;
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (typeof method !== "string" || !PAYMENT_METHODS.has(method)) {
    return jsonError("Invalid payment method", 400);
  }
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return jsonError("Payment amount must be a positive number", 400);
  }
  const normalizedAmount = Math.round(amount * 100) / 100;
  if (normalizedAmount <= 0 || Math.abs(normalizedAmount - amount) > 0.000001) {
    return jsonError("Payment amount can have at most two decimal places", 400);
  }
  if (transactionId !== undefined && transactionId !== null && typeof transactionId !== "string") {
    return jsonError("Invalid transaction reference", 400);
  }
  if (idempotencyKey.length < 16 || idempotencyKey.length > 128 || !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)) {
    return jsonError("A valid payment idempotency key is required", 400);
  }
  const normalizedTransactionId = typeof transactionId === "string" ? transactionId.trim() || null : null;
  if (normalizedTransactionId && normalizedTransactionId.length > 191) {
    return jsonError("Transaction reference cannot exceed 191 characters", 400);
  }
  const matchesRequest = (payment: { method: unknown; amount: unknown; transactionId?: string | null }) =>
    payment.method === method &&
    Number(payment.amount) === normalizedAmount &&
    (payment.transactionId ?? null) === normalizedTransactionId;

  const runPayment = () => prisma.$transaction(async (tx) => {
      const repeatedPayment = await tx.payment.findUnique({
        where: { idempotencyKey },
        include: { bill: { include: { session: true } } },
      });
      if (repeatedPayment) {
        if (repeatedPayment.billId !== id) {
          throw new PaymentRequestError("This payment request belongs to another bill", 409);
        }
        if (!matchesRequest(repeatedPayment)) {
          throw new PaymentRequestError("This payment key was already used with different details", 409);
        }
        if (user.storeId && repeatedPayment.bill.session.storeId !== user.storeId) {
          throw new PaymentRequestError("Forbidden", 403);
        }
        return {
          payment: repeatedPayment,
          bill: repeatedPayment.bill,
          settled: repeatedPayment.bill.status === "PAID",
          idempotent: true,
        };
      }

      const bill = await tx.bill.findUnique({
        where: { id },
        include: { session: { include: { customer: true } }, payments: true },
      });
      if (!bill) throw new PaymentRequestError("Bill not found", 404);
      if (user.storeId && bill.session.storeId !== user.storeId) {
        throw new PaymentRequestError("Forbidden", 403);
      }
      if (bill.status === "DRAFT") {
        throw new PaymentRequestError("Recalculate this bill before receiving payment", 409);
      }
      if (bill.status === "PAID" || bill.status === "VOID" || bill.status === "REFUNDED") {
        throw new PaymentRequestError("Bill is already settled", 409);
      }

      const unresolvedItems = await tx.orderItem.count({
        where: {
          order: { sessionId: bill.sessionId },
          status: { in: ["ORDERED", "IN_PROCESS", "READY"] },
          billable: true,
        },
      });
      if (unresolvedItems > 0) {
        throw new PaymentRequestError(
          `Resolve ${unresolvedItems} pending item${unresolvedItems === 1 ? "" : "s"} before receiving payment`,
          409
        );
      }

      const currentPaid = Number(bill.paidAmount);
      const currentDue = Number(bill.dueAmount);
      const total = Number(bill.total);
      if (normalizedAmount > currentDue) {
        throw new PaymentRequestError("Payment cannot exceed the amount due", 400);
      }

      const nextPaid = Math.round((currentPaid + normalizedAmount) * 100) / 100;
      const nextDue = Math.max(0, Math.round((currentDue - normalizedAmount) * 100) / 100);
      const isPaid = nextDue === 0;
      const nextStatus = isPaid ? ("PAID" as const) : ("PARTIALLY_PAID" as const);

      // Optimistic guard prevents two tills from paying the same stale balance.
      const claimed = await tx.bill.updateMany({
        where: {
          id: bill.id,
          status: bill.status,
          paidAmount: bill.paidAmount,
          dueAmount: bill.dueAmount,
        },
        data: {
          paidAmount: nextPaid,
          dueAmount: nextDue,
          status: nextStatus,
          paidAt: isPaid ? new Date() : bill.paidAt,
        },
      });
      if (claimed.count !== 1) {
        throw new PaymentRequestError("The bill changed at another till. Refresh and try again.", 409);
      }

      const payment = await tx.payment.create({
        data: {
          billId: bill.id,
          method: method as any,
          amount: normalizedAmount,
          status: "COMPLETED",
          idempotencyKey,
          transactionId: normalizedTransactionId,
          receivedById: user.id,
          paidAt: new Date(),
        },
      });

      if (isPaid) {
        const closed = await tx.tableSession.updateMany({
          where: { id: bill.sessionId, status: "OPEN" },
          data: { status: "CLOSED", closedAt: new Date() },
        });
        if (closed.count === 1 && bill.session.tableId) {
          await tx.diningTable.update({
            where: { id: bill.session.tableId },
            data: { status: "AVAILABLE" },
          });
        }

        if (closed.count === 1 && bill.session.customerId) {
          const pointsSetting = await tx.setting.findUnique({
            where: { storeId_key: { storeId: bill.session.storeId, key: "loyalty_points_per_rupee" } },
          });
          const configuredRate = Number(pointsSetting?.value ?? 1);
          const perRupee = Number.isFinite(configuredRate) && configuredRate >= 0 ? configuredRate : 1;
          const earned = Math.max(0, Math.floor(total * perRupee));
          if (earned > 0) {
            await tx.customer.update({
              where: { id: bill.session.customerId },
              data: { loyaltyPoints: { increment: earned } },
            });
            await tx.loyaltyTransaction.create({
              data: {
                customerId: bill.session.customerId,
                points: earned,
                type: "EARN",
                description: `Earned from bill ${bill.billNumber}`,
                billId: bill.id,
              },
            });
          }
        }
      }

      const updated = await tx.bill.findUnique({ where: { id: bill.id }, include: { session: true } });
      return { payment, bill: updated, settled: isPaid };
  }, { isolationLevel: "Serializable" });

  try {
    const result = await runPayment().catch((firstError: unknown) => {
      if ((firstError as any)?.code === "P2034") return runPayment();
      throw firstError;
    });
    return Response.json(result);
  } catch (error: unknown) {
    if (error instanceof PaymentRequestError) return jsonError(error.message, error.status);
    if ((error as any)?.code === "P2002" || (error as any)?.code === "P2034") {
      // A same-key request may still be committing when this transaction loses
      // a serialization/deadlock race. Re-read briefly before reporting a
      // conflict so a lost response replays the committed payment reliably.
      let repeatedPayment = await prisma.payment.findUnique({
        where: { idempotencyKey },
        include: { bill: { include: { session: true } } },
      });
      for (const delay of [25, 75]) {
        if (repeatedPayment) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        repeatedPayment = await prisma.payment.findUnique({
          where: { idempotencyKey },
          include: { bill: { include: { session: true } } },
        });
      }
      if (
        repeatedPayment?.billId === id &&
        (!user.storeId || repeatedPayment.bill.session.storeId === user.storeId) &&
        matchesRequest(repeatedPayment)
      ) {
        return Response.json({
          payment: repeatedPayment,
          bill: repeatedPayment.bill,
          settled: repeatedPayment.bill.status === "PAID",
          idempotent: true,
        });
      }
      if ((error as any)?.code === "P2002") {
        return jsonError("This payment key was already used with different details", 409);
      }
      return jsonError("The bill changed at another till. Refresh and try again.", 409);
    }
    return jsonError(error instanceof Error ? error.message : "Payment failed");
  }
}
