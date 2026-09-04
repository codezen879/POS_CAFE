import { prisma } from "@/lib/prisma";
import { generateReference, jsonError } from "@/lib/utils";

type ItemPayload = {
  productId: string;
  quantity?: number;
  note?: string;
  addons?: { id: string; quantity?: number }[];
};

const MAX_ITEMS = 50;
const MAX_QTY = 99;
const MAX_ADDONS = 20;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { tableId, items } = body as { tableId?: string; items?: ItemPayload[] };

  if (!tableId) return jsonError("Table is required", 400);
  if (!items || items.length === 0) return jsonError("Order has no items", 400);
  if (items.length > MAX_ITEMS) return jsonError("Too many items", 400);

  try {
    const table = await prisma.diningTable.findUnique({
      where: { id: tableId },
      include: { sessions: { where: { status: "OPEN" }, orderBy: { openedAt: "desc" }, take: 1 } },
    });
    if (!table) return jsonError("Table not found", 404);
    const session = table.sessions[0];
    if (!session) return jsonError("This table is not open yet", 400);

    // Hydrate product identities and add-on prices server-side so the guest
    // cannot tamper with names or prices.
    const products = await prisma.product.findMany({
      where: { id: { in: items.map((i) => i.productId).filter(Boolean) } },
      include: { addons: { include: { addon: true } } },
    });
    const productById = new Map(products.map((p) => [p.id, p]));

    const order = await prisma.order.create({
      data: {
        orderNumber: generateReference("ORD"),
        sessionId: session.id,
        tableId: table.id,
        type: "DINE_IN",
        status: "SENT_TO_KITCHEN",
        sentToKitchenAt: new Date(),
        items: {
          create: items.map((it) => {
            const product = it.productId ? productById.get(it.productId) : undefined;
            if (!product) throw new Error("Unknown product");
            const addonById = new Map(
              product.addons.filter((a) => a.addon.isActive).map((a) => [a.addonId, a.addon])
            );
            const addons = (it.addons ?? [])
              .filter((a) => a && a.id && addonById.has(a.id))
              .slice(0, MAX_ADDONS)
              .map((a) => ({
                addonId: a.id,
                name: addonById.get(a.id)!.name,
                price: addonById.get(a.id)!.price,
                quantity: Math.min(Math.max(1, Math.floor(a.quantity ?? 1)), 9),
              }));
            return {
              productId: product.id,
              name: product.name,
              unitPrice: product.basePrice,
              quantity: Math.min(Math.max(1, Math.floor(it.quantity ?? 1)), MAX_QTY),
              note: it.note || null,
              addons: { create: addons },
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