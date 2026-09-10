import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { code, name, rate, isActive } = body;
  if (!code || !name || rate == null) {
    return Response.json({ error: "code, name and rate required" }, { status: 400 });
  }
  const storeId = (await prisma.store.findFirst())?.id;
  if (!storeId) return Response.json({ error: "No store" }, { status: 400 });
  const existing = await prisma.taxRate.findUnique({ where: { storeId_code: { storeId, code } } });
  if (existing) {
    const tax = await prisma.taxRate.update({
      where: { storeId_code: { storeId, code } },
      data: { name, rate, isActive: isActive ?? existing.isActive },
    });
    return Response.json({ tax });
  }
  const tax = await prisma.taxRate.create({ data: { storeId, code, name, rate, isActive: isActive ?? true } });
  return Response.json({ tax }, { status: 201 });
}