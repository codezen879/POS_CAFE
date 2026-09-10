import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { KitchenBoard } from "@/components/kitchen/kitchen-board";

export default async function KitchenPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "KITCHEN"].includes(session.user.role)) redirect("/");

  return <KitchenBoard />;
}
