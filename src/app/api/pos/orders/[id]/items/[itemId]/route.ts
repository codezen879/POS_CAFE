import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

// Once submitted, a dish line is immutable: later additions are new order
// tickets and removals are audited cancellations through the waiter workflow.
const EDITABLE_STATUSES = ["DRAFT"];
const EDIT_ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER", "CASHIER"];

async function getEditableOrder(id: string) {
  const order = await prisma.order.findUnique({
    where: { id },
    include: { session: { select: { storeId: true } } },
  });
  if (!order) return null;
  if (!EDITABLE_STATUSES.includes(order.status)) return null;
  return order;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await apiAuth(...EDIT_ROLES);
  if (user instanceof Response) return user;

  const { id, itemId } = await params;
  const body = await req.json().catch(() => ({}));
  const quantity = Math.floor(Number(body.quantity));
  if (!Number.isInteger(quantity) || quantity < 1) return jsonError("Invalid quantity", 400);
  const qty = Math.min(quantity, 99);

  try {
    const order = await getEditableOrder(id);
    if (!order) return jsonError("Order is no longer editable", 409);
    if (user.storeId && order.session?.storeId !== user.storeId) return jsonError("Forbidden", 403);

    const item = await prisma.orderItem.findFirst({ where: { id: itemId, orderId: id } });
    if (!item) return jsonError("Item not found", 404);

    const updated = await prisma.orderItem.update({
      where: { id: itemId },
      data: { quantity: qty },
      include: { addons: true },
    });
    return Response.json({ item: updated });
  } catch (e: any) {
    return jsonError(e.message || "Failed to update item");
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const user = await apiAuth(...EDIT_ROLES);
  if (user instanceof Response) return user;

  const { id, itemId } = await params;

  try {
    const order = await getEditableOrder(id);
    if (!order) return jsonError("Order is no longer editable", 409);
    if (user.storeId && order.session?.storeId !== user.storeId) return jsonError("Forbidden", 403);

    const item = await prisma.orderItem.findFirst({ where: { id: itemId, orderId: id } });
    if (!item) return jsonError("Item not found", 404);

    await prisma.orderItem.delete({ where: { id: itemId } });

    const remaining = await prisma.orderItem.count({ where: { orderId: id } });
    let cancelled = false;
    if (remaining === 0) {
      await prisma.order.update({
        where: { id },
        data: { status: "CANCELLED", cancelledAt: new Date() },
      });
      cancelled = true;
    }

    return Response.json({ ok: true, orderCancelled: cancelled });
  } catch (e: any) {
    return jsonError(e.message || "Failed to remove item");
  }
}
