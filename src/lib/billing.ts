import { prisma } from "./prisma";
import { isBillEligibleItem } from "./order-item-workflow";

export type BillComputation = {
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
  taxBreakdown: { taxCode: string; rate: number; baseAmount: number; taxAmount: number }[];
};

// Shift through decimal exponents before rounding so values such as 1.005 do
// not lose a paise because of binary floating-point representation.
const shiftDecimal = (value: number, places: number) => {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  return Number(`${coefficient}e${Number(exponent) + places}`);
};

const round2 = (n: number) => shiftDecimal(Math.round(shiftDecimal(n, 2)), -2);

export async function computeBillForSession(
  sessionId: string,
  opts?: { discountType?: string | null; discountValue?: number; serviceChargePercent?: number },
  db: any = prisma
): Promise<BillComputation> {
  const session = await db.tableSession.findUnique({
    where: { id: sessionId },
    include: {
      orders: {
        // Item state is the billing source of truth. A coarse order can be
        // CANCELLED after its only served line is returned but intentionally
        // kept billable, so excluding cancelled orders would lose that charge.
        where: { status: { not: "DRAFT" } },
        include: { items: { include: { product: { include: { taxRate: true } }, addons: true } } },
      },
    },
  });
  if (!session) throw new Error("Session not found");

  let subtotal = 0;
  const taxBuckets = new Map<string, { taxCode: string; rate: number; baseAmount: number }>();

  for (const order of session.orders) {
    for (const item of order.items) {
      // A returned line may intentionally remain on the customer's bill. All
      // unserved, cancelled, pooled, and non-billable lines remain excluded.
      if (!isBillEligibleItem(item.status, item.billable)) continue;
      const addonTotal = item.addons.reduce((s: number, a: { price: string | number; quantity: number }) => s + Number(a.price) * a.quantity, 0);
      const lineBase = (Number(item.unitPrice) + addonTotal) * item.quantity;
      subtotal = round2(subtotal + lineBase);
      const rate = item.product?.taxRate?.rate ? Number(item.product.taxRate.rate) : 0;
      if (rate > 0) {
        const half = rate / 2; // split CGST + SGST
        for (const code of ["CGST", "SGST"]) {
          const key = `${code}:${half}`;
          const bucket = taxBuckets.get(key) ?? { taxCode: code, rate: half, baseAmount: 0 };
          bucket.baseAmount = round2(bucket.baseAmount + lineBase);
          taxBuckets.set(key, bucket);
        }
      }
    }
  }

  let discountAmount = 0;
  const discountType = opts?.discountType;
  const requestedDiscountValue = Number(opts?.discountValue ?? 0);
  const discountValue = Number.isFinite(requestedDiscountValue) ? Math.max(0, requestedDiscountValue) : 0;
  if (discountType === "PERCENTAGE" && discountValue > 0) {
    discountAmount = round2((subtotal * Math.min(discountValue, 100)) / 100);
  } else if (discountType === "FIXED" && discountValue > 0) {
    discountAmount = round2(Math.min(discountValue, subtotal));
  }

  const taxableBase = Math.max(0, subtotal - discountAmount);

  const taxableRatio = subtotal > 0 ? taxableBase / subtotal : 0;
  const taxBreakdown = Array.from(taxBuckets.values()).map((bucket) => {
    const baseAmount = round2(bucket.baseAmount * taxableRatio);
    return {
      taxCode: bucket.taxCode,
      rate: bucket.rate,
      baseAmount,
      taxAmount: round2((baseAmount * bucket.rate) / 100),
    };
  });
  const taxTotal = round2(taxBreakdown.reduce((s, b) => s + b.taxAmount, 0));

  const serviceChargePercent = Number(opts?.serviceChargePercent ?? 0);
  const serviceCharge = round2((subtotal * serviceChargePercent) / 100);

  const total = round2(taxableBase + taxTotal + serviceCharge);

  return { subtotal, discountAmount, taxTotal, serviceCharge, total, taxBreakdown };
}
