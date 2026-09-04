import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

// Default: 100 loyalty points = ₹1 of discount
const POINTS_PER_RUPEE = 100;

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { points } = body as { points?: number };

  if (!points || points <= 0) return jsonError("Enter a valid number of points", 400);

  try {
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) return jsonError("Customer not found", 404);
    if (customer.loyaltyPoints < points) return jsonError("Insufficient loyalty points", 400);

    const cashValue = Math.floor(points / POINTS_PER_RUPEE);
    if (cashValue <= 0) return jsonError(`Minimum ${POINTS_PER_RUPEE} points to redeem`, 400);

    const [updated] = await prisma.$transaction([
      prisma.customer.update({
        where: { id },
        data: { loyaltyPoints: { decrement: points } },
      }),
      prisma.loyaltyTransaction.create({
        data: {
          customerId: id,
          points,
          type: "REDEEM",
          description: `Redeemed ${points} pts for ₹${cashValue} discount`,
        },
      }),
    ]);

    return Response.json({
      customer: updated,
      cashValue,
      discount: { type: "FIXED", value: cashValue },
      message: `₹${cashValue} discount applied to this customer`,
    });
  } catch (e: any) {
    return jsonError(e.message || "Redemption failed");
  }
}