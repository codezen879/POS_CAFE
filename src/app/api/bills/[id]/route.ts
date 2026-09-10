import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

const MANAGER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];
const BILL_VIEW_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "WAITER"];

class BillVoidError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

// GET /api/bills/:id — full bill detail (items + addons for reprint/viewing)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...BILL_VIEW_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
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
      payments: true,
      taxLines: true,
    },
  });
  if (!bill) return jsonError("Bill not found", 404);
  if (user.storeId && bill.session.storeId !== user.storeId) return jsonError("Forbidden", 403);

  return Response.json({ bill });
}

// PATCH /api/bills/:id — cancel (void) a bill. Only managers may cancel.
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...MANAGER_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const bill = await tx.bill.findUnique({
        where: { id },
        include: { session: true, payments: { select: { id: true } } },
      });
      if (!bill) throw new BillVoidError("Bill not found", 404);
      if (user.storeId && bill.session.storeId !== user.storeId) {
        throw new BillVoidError("Forbidden", 403);
      }
      if (bill.status === "VOID" || bill.status === "REFUNDED") {
        throw new BillVoidError("Bill is already cancelled");
      }
      if (
        !["DRAFT", "ISSUED"].includes(bill.status) ||
        bill.payments.length > 0 ||
        Number(bill.paidAmount) > 0
      ) {
        throw new BillVoidError("Bills with a payment must be refunded, not cancelled");
      }

      const claimed = await tx.bill.updateMany({
        where: {
          id: bill.id,
          status: bill.status,
          paidAmount: bill.paidAmount,
          dueAmount: bill.dueAmount,
        },
        data: {
          status: "VOID",
          voidedAt: new Date(),
          voidReason: "Cancelled from Billing",
        },
      });
      if (claimed.count !== 1) {
        throw new BillVoidError("The bill changed at another till. Refresh and try again.");
      }

      const updated = await tx.bill.findUnique({
        where: { id: bill.id },
        include: { payments: true, taxLines: true },
      });
      return { bill: updated, sessionStatus: bill.session.status };
    }, { isolationLevel: "Serializable" });

    // If the session attached to this bill is still OPEN (bill was never settled),
    // leave it open so a corrected bill can be generated afterwards.
    return Response.json(result);
  } catch (error: any) {
    if (error instanceof BillVoidError) return jsonError(error.message, error.status);
    if (error?.code === "P2034") {
      return jsonError("The bill changed at another till. Refresh and try again.", 409);
    }
    return jsonError(error.message || "Failed to cancel bill");
  }
}
