import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const floors = await prisma.floor.findMany({ orderBy: { sortOrder: "asc" } });
  return Response.json({ floors });
}