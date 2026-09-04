import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { generateReference, jsonError } from "@/lib/utils";

type ItemPayload = {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  note?: string;
  addons?: { id: string | null; name: string; price: number; quantity: number }[];
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { items, type } = body as { items?: ItemPayload[]; type?: string };

  if (!items || items.length === 0) return jsonError("Order has no items", 400);

  try {
    const session = await prisma.tableSession.findUnique({ where: { id } });
    if (!session) return jsonError("Session not found", 404);
    if (session.status !== "OPEN") return jsonError("Session is not open", 400);

    const orderNumber = generateReference("ORD");

    // Hydrate product identities server-side so name/price can't be tampered with.
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId).filter(Boolean) } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const order = await prisma.order.create({
      data: {
        orderNumber,
        sessionId: session.id,
        type: (type as any) || "DINE_IN",
        status: "SENT_TO_KITCHEN",
        tableId: session.tableId,
        orderedById: user.id,
        sentToKitchenAt: new Date(),
        items: {
          create: items.map((it) => {
            const product = it.productId ? productById.get(it.productId) : undefined;
            if (!product) throw new Error(`Unknown product: ${it.productId}`);
            return {
              productId: product.id,
              name: product.name,
              unitPrice: Number(product.basePrice),
              quantity: it.quantity || 1,
              note: it.note || null,
              addons: {
                create: (it.addons ?? []).map((a) => ({
                  addonId: a.id || null,
                  name: a.name || "",
                  price: a.price ?? 0,
                  quantity: a.quantity || 1,
                })),
              },
            };
          }),
        },
      },
      include: { items: { include: { addons: true } } },
    });

    return Response.json({ order }, { status: 201 });
  } catch (e: any) {
    return jsonError(e.message || "Failed to place order");
  }
}
