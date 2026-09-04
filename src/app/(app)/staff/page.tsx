import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { StaffManager } from "@/components/staff/staff-manager";

export default async function StaffPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const isManager = ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(session.user.role);

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });

  return <StaffManager users={users as any} isManager={isManager} />;
}