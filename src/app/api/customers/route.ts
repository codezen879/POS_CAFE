import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function GET(_req: Request) {
  const user = await apiAuth();
  if (user instanceof Response) return user;
  const customers = await prisma.customer.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { sessions: true } } },
    take: 100,
  });
  return Response.json({ customers });
}

export async function POST(req: Request) {
  const user = await apiAuth();
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { name, phone, email } = body as { name?: string; phone?: string; email?: string };

  if (!phone) return Response.json({ error: "Phone is required" }, { status: 400 });

  const existing = await prisma.customer.findUnique({ where: { phone } });
  if (existing) return Response.json({ customer: existing });

  const customer = await prisma.customer.create({
    data: { name: name || null, phone, email: email || null },
  });
  return Response.json({ customer }, { status: 201 });
}