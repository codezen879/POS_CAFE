import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OrdersList } from "@/components/orders/orders-list";
import { toPlain } from "@/lib/serialize";

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { status } = await searchParams;

  const orders = await prisma.order.findMany({
    where: status && status !== "ALL" ? { status: status as any } : {},
    orderBy: { placedAt: "desc" },
    take: 100,
    include: {
      items: { include: { addons: true } },
      session: { include: { table: true } },
      orderedBy: { select: { name: true } },
    },
  });

  return <OrdersList orders={toPlain(orders) as any} currentStatus={status || "ALL"} />;
}