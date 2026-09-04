import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

export default async function KitchenPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  return <KitchenBoard />;
}