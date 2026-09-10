import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference, jsonError } from "@/lib/utils";
import { computeBillForSession } from "@/lib/billing";

class BillRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "WAITER");
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const rawDiscountType = body.discountType;
  const discountType = rawDiscountType === "" || rawDiscountType === "NONE" ? null : rawDiscountType ?? null;
  const requestedDiscountValue = body.discountValue ?? 0;

  if (discountType !== null && !["FIXED", "PERCENTAGE"].includes(discountType)) {
    return jsonError("Invalid discount type", 400);
  }
  if (
    typeof requestedDiscountValue !== "number" ||
    !Number.isFinite(requestedDiscountValue) ||
    requestedDiscountValue < 0
  ) {
    return jsonError("Invalid discount value", 400);
  }
  const roundedDiscountValue = Math.round(requestedDiscountValue * 100) / 100;
  if (Math.abs(roundedDiscountValue - requestedDiscountValue) > 0.000001) {
    return jsonError("Discount value can have at most two decimal places", 400);
  }
  const discountValue = discountType === null ? 0 : roundedDiscountValue;
  if (discountType === "PERCENTAGE" && discountValue > 100) {
    return jsonError("Percentage discount cannot exceed 100", 400);
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const session = await tx.tableSession.findUnique({ where: { id } });
        if (!session) throw new BillRequestError("Session not found", 404);
        if (session.status !== "OPEN") throw new BillRequestError("Session is not open", 409);
        if (user.storeId && session.storeId !== user.storeId) throw new BillRequestError("Forbidden", 403);

        const existingBill = await tx.bill.findUnique({
          where: { sessionId: id },
          include: { payments: { select: { id: true } } },
        });
        if (
          existingBill &&
          (existingBill.status === "PAID" ||
            existingBill.status === "PARTIALLY_PAID" ||
            existingBill.payments.length > 0)
        ) {
          throw new BillRequestError(
            "A paid bill cannot be recomputed. Use a refund or credit note for later adjustments.",
            409
          );
        }

        const unresolvedItems = await tx.orderItem.count({
          where: {
            order: { sessionId: id },
            status: { in: ["ORDERED", "IN_PROCESS", "READY"] },
            billable: true,
          },
        });
        if (unresolvedItems > 0) {
          throw new BillRequestError(
            `Serve or cancel ${unresolvedItems} pending item${unresolvedItems === 1 ? "" : "s"} before generating the bill`,
            409
          );
        }

        const setting = await tx.setting.findUnique({
          where: { storeId_key: { storeId: session.storeId, key: "service_charge_percent" } },
        });
        const rawServiceCharge = Number(setting?.value ?? 0);
        const serviceChargePercent =
          Number.isFinite(rawServiceCharge) && rawServiceCharge >= 0 ? rawServiceCharge : 0;

        const computed = await computeBillForSession(
          id,
          { discountType, discountValue, serviceChargePercent },
          tx
        );
        const zeroTotal = computed.total === 0;
        const nextStatus = zeroTotal ? ("PAID" as const) : ("ISSUED" as const);

        const bill = await tx.bill.upsert({
          where: { sessionId: id },
          update: {
            status: nextStatus,
            subtotal: computed.subtotal,
            discountType,
            discountValue,
            discountAmount: computed.discountAmount,
            taxTotal: computed.taxTotal,
            serviceCharge: computed.serviceCharge,
            total: computed.total,
            paidAmount: 0,
            dueAmount: computed.total,
            paidAt: zeroTotal ? new Date() : null,
            issuedById: user.id,
            issuedAt: new Date(),
            taxLines: {
              deleteMany: {},
              create: computed.taxBreakdown,
            },
          },
          create: {
            billNumber: generateReference("BILL"),
            sessionId: id,
            status: nextStatus,
            subtotal: computed.subtotal,
            discountType,
            discountValue,
            discountAmount: computed.discountAmount,
            taxTotal: computed.taxTotal,
            serviceCharge: computed.serviceCharge,
            total: computed.total,
            paidAmount: 0,
            dueAmount: computed.total,
            paidAt: zeroTotal ? new Date() : null,
            issuedById: user.id,
            issuedAt: new Date(),
            taxLines: { create: computed.taxBreakdown },
          },
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
                      where: { status: { in: ["SERVED", "RETURNED"] }, billable: true },
                      include: { addons: true },
                    },
                  },
                },
              },
            },
          },
        });

        if (zeroTotal) {
          await tx.tableSession.update({
            where: { id: session.id },
            data: { status: "CLOSED", closedAt: new Date() },
          });
          if (session.tableId) {
            await tx.diningTable.update({
              where: { id: session.tableId },
              data: { status: "AVAILABLE" },
            });
          }
        }

        return { bill, computation: computed };
      },
      { isolationLevel: "Serializable" }
    );

    return Response.json(result);
  } catch (error: any) {
    if (error instanceof BillRequestError) return jsonError(error.message, error.status);
    if (error?.code === "P2034") {
      return jsonError("Orders changed while the bill was being generated. Please try again.", 409);
    }
    return jsonError(error?.message || "Failed to generate bill");
  }
}
