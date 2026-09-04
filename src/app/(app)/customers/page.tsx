import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { CustomersList } from "@/components/customers/customers-list";

export default async function CustomersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      _count: { select: { sessions: true, loyaltyTxns: true } },
      loyaltyTxns: { orderBy: { createdAt: "desc" }, take: 5 },
      reviews: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  return <CustomersList customers={customers as any} />;
}