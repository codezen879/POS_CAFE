import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { BillingList } from "@/components/billing/billing-list";
import { toPlain } from "@/lib/serialize";

export default async function BillingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [bills, store] = await Promise.all([
    prisma.bill.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        session: { include: { table: true, customer: true } },
        payments: true,
        taxLines: true,
      },
    }),
    prisma.store.findFirst({ include: { taxRates: true } }),
  ]);

  return <BillingList bills={toPlain(bills) as any} store={toPlain(store) as any} />;
}