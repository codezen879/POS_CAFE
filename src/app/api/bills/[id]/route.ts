import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

const MANAGER_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER"];

// GET /api/bills/:id — full bill detail (items + addons for reprint/viewing)
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const bill = await prisma.bill.findUnique({
    where: { id },
    include: {
      session: {
        include: { table: true, customer: true, orders: { include: { items: { include: { addons: true } } } } },
      },
      payments: true,
      taxLines: true,
    },
  });
  if (!bill) return jsonError("Bill not found", 404);

  return Response.json({ bill });
}

// PATCH /api/bills/:id — cancel (void) a bill. Only managers may cancel.
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth(...MANAGER_ROLES);
  if (user instanceof Response) return user;

  const { id } = await params;

  try {
    const bill = await prisma.bill.findUnique({
      where: { id },
      include: { session: true },
    });
    if (!bill) return jsonError("Bill not found", 404);
    if (bill.status === "VOID" || bill.status === "REFUNDED") return jsonError("Bill is already cancelled", 409);
    if (bill.status === "PAID") {
      return jsonError("Paid bills must be refunded, not cancelled", 409);
    }

    const updated = await prisma.bill.update({
      where: { id: bill.id },
      data: { status: "VOID" },
      include: { payments: true, taxLines: true },
    });

    // If the session attached to this bill is still OPEN (bill was never settled),
    // leave it open so a corrected bill can be generated afterwards.
    return Response.json({ bill: updated, sessionStatus: bill.session.status });
  } catch (e: any) {
    return jsonError(e.message || "Failed to cancel bill");
  }
}