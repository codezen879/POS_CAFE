import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { WaiterBoard } from "@/components/waiter/waiter-board";

export default async function WaiterPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!["SUPER_ADMIN", "ADMIN", "MANAGER", "WAITER"].includes(session.user.role)) redirect("/");

  return <WaiterBoard />;
}
