import { prisma } from "./prisma";

export type BillComputation = {
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
  taxBreakdown: { taxCode: string; rate: number; baseAmount: number; taxAmount: number }[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function computeBillForSession(
  sessionId: string,
  opts?: { discountType?: string; discountValue?: number; serviceChargePercent?: number }
): Promise<BillComputation> {
  const session = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    include: {
      orders: {
        where: { status: { notIn: ["CANCELLED", "DRAFT"] } },
        include: { items: { include: { product: { include: { taxRate: true } }, addons: true } } },
      },
    },
  });
  if (!session) throw new Error("Session not found");

  let subtotal = 0;
  const taxBuckets = new Map<string, { rate: number; taxAmount: number }>();

  for (const order of session.orders) {
    for (const item of order.items) {
      const addonTotal = item.addons.reduce((s, a) => s + Number(a.price) * a.quantity, 0);
      const lineBase = (Number(item.unitPrice) + addonTotal) * item.quantity;
      subtotal = round2(subtotal + lineBase);
      const rate = item.product?.taxRate?.rate ? Number(item.product.taxRate.rate) : 0;
      if (rate > 0) {
        const half = rate / 2; // split CGST + SGST
        for (const code of ["CGST", "SGST"]) {
          const b = taxBuckets.get(code) ?? { rate: half, taxAmount: 0 };
          b.rate = half;
          b.taxAmount = round2(b.taxAmount + (lineBase * half) / 100);
          taxBuckets.set(code, b);
        }
      }
    }
  }

  let discountAmount = 0;
  const discountType = opts?.discountType;
  const discountValue = Number(opts?.discountValue ?? 0);
  if (discountType === "PERCENTAGE" && discountValue > 0) {
    discountAmount = round2((subtotal * discountValue) / 100);
  } else if (discountType === "FIXED" && discountValue > 0) {
    discountAmount = Math.min(discountValue, subtotal);
  }

  const taxableBase = subtotal - discountAmount;

  const taxBreakdown = Array.from(taxBuckets.entries()).map(([taxCode, b]) => ({
    taxCode,
    rate: b.rate,
    baseAmount: round2(taxableBase),
    taxAmount: round2((taxableBase * b.rate) / 100),
  }));
  const taxTotal = round2(taxBreakdown.reduce((s, b) => s + b.taxAmount, 0));

  const serviceChargePercent = Number(opts?.serviceChargePercent ?? 0);
  const serviceCharge = round2((subtotal * serviceChargePercent) / 100);

  const total = round2(taxableBase + taxTotal + serviceCharge);

  return { subtotal, discountAmount, taxTotal, serviceCharge, total, taxBreakdown };
}
