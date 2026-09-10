import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function POST(req: Request) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const body = await req.json().catch(() => ({}));
  const { customerId, rating, comment } = body as { customerId?: string; rating?: number; comment?: string };

  if (!rating || rating < 1 || rating > 5) return jsonError("Rating must be between 1 and 5", 400);

  try {
    const customer = customerId
      ? await prisma.customer.findUnique({ where: { id: customerId } })
      : null;
    if (customerId && !customer) return jsonError("Customer not found", 404);

    const review = await prisma.review.create({
      data: {
        customerId: customer?.id ?? null,
        rating: Math.round(rating),
        comment: comment?.trim() || null,
      },
    });
    return Response.json({ review }, { status: 201 });
  } catch (e: any) {
    return jsonError(e.message || "Failed to save review");
  }
}