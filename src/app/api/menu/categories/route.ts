import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { slugify } from "@/lib/utils";

export async function GET() {
  const categories = await prisma.menuCategory.findMany({
    orderBy: { sortOrder: "asc" },
    include: { _count: { select: { products: true } } },
  });
  return Response.json({ categories });
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { name, icon } = body as { name?: string; icon?: string };
  if (!name) return Response.json({ error: "Name is required" }, { status: 400 });

  const slug = slugify(name);
  const existing = await prisma.menuCategory.findUnique({ where: { slug } });
  if (existing) return Response.json({ error: "Category already exists" }, { status: 409 });

  const max = await prisma.menuCategory.aggregate({ _max: { sortOrder: true } });
  const category = await prisma.menuCategory.create({
    data: { name, slug, icon: icon || null, sortOrder: (max._max.sortOrder ?? 0) + 1 },
  });
  return Response.json({ category }, { status: 201 });
}