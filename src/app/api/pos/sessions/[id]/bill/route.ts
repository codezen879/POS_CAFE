import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference, jsonError } from "@/lib/utils";
import { computeBillForSession } from "@/lib/billing";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { discountType, discountValue } = body;

  try {
    const session = await prisma.tableSession.findUnique({ where: { id } });
    if (!session) return jsonError("Session not found", 404);

    const setting = await prisma.setting.findUnique({
      where: { storeId_key: { storeId: session.storeId, key: "service_charge_percent" } },
    });

    const scRaw = Number(setting?.value ?? 0);
    const serviceChargePercent = Number.isFinite(scRaw) && scRaw >= 0 ? scRaw : 0;

    const computed = await computeBillForSession(id, {
      discountType: discountType || null,
      discountValue: discountValue || 0,
      serviceChargePercent,
    });

    const billNumber = generateReference("BILL");

    const bill = await prisma.bill.upsert({
      where: { sessionId: id },
      update: {
        status: "ISSUED",
        subtotal: computed.subtotal,
        discountType: discountType || null,
        discountValue: discountValue ?? 0,
        discountAmount: computed.discountAmount,
        taxTotal: computed.taxTotal,
        serviceCharge: computed.serviceCharge,
        total: computed.total,
        dueAmount: computed.total,
        issuedById: user.id,
        issuedAt: new Date(),
        taxLines: {
          deleteMany: {},
          create: computed.taxBreakdown.map((t) => ({ ...t })),
        },
      },
      create: {
        billNumber,
        sessionId: id,
        status: "ISSUED",
        subtotal: computed.subtotal,
        discountType: discountType || null,
        discountValue: discountValue ?? 0,
        discountAmount: computed.discountAmount,
        taxTotal: computed.taxTotal,
        serviceCharge: computed.serviceCharge,
        total: computed.total,
        paidAmount: 0,
        dueAmount: computed.total,
        issuedById: user.id,
        issuedAt: new Date(),
        taxLines: {
          create: computed.taxBreakdown.map((t) => ({ ...t })),
        },
      },
      include: { taxLines: true, session: { include: { orders: { include: { items: true } } } } },
    });

    return Response.json({ bill, computation: computed });
  } catch (e: any) {
    return jsonError(e.message || "Failed to generate bill");
  }
}
