import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

const STATUS_FIELD: Record<string, string> = {
  PREPARING: "prepStartedAt",
  READY: "readyAt",
  SERVED: "servedAt",
  CANCELLED: "cancelledAt",
};

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth();
  if (user instanceof Response) return user;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const { status } = body as { status?: string };

  const validStatuses = ["SENT_TO_KITCHEN", "PREPARING", "READY", "PARTIALLY_SERVED", "SERVED", "CANCELLED"];
  if (!status || !validStatuses.includes(status)) return jsonError("Invalid status", 400);

  try {
    const order = await prisma.order.findUnique({ where: { id }, include: { session: true } });
    if (!order) return jsonError("Order not found", 404);
    if (order.status === "CANCELLED" || order.status === "SERVED") return jsonError("Order is final", 400);

    const field = STATUS_FIELD[status];
    const data: any = {
      status: status as any,
      ...(field ? { [field]: new Date() } : {}),
    };

    const updated = await prisma.order.update({
      where: { id },
      data,
      include: { items: true },
    });

    // If order served, check if the whole session can be marked for billing
    if (status === "SERVED" && order.session) {
      await markTableIfAllServed(order.sessionId!);
    }

    return Response.json({ order: updated });
  } catch (e: any) {
    return jsonError(e.message || "Failed to update order");
  }
}

async function markTableIfAllServed(sessionId: string) {
  const session = await prisma.tableSession.findUnique({
    where: { id: sessionId },
    include: {
      orders: { where: { status: { notIn: ["CANCELLED", "SERVED", "DRAFT"] } } },
      table: true,
    },
  });
  // Intentionally kept simple: table stays occupied until session closes.
  void session;
}
