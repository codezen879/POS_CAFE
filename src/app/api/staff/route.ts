import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import bcrypt from "bcryptjs";

function genPin() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export async function GET() {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, isActive: true, createdAt: true },
  });
  return Response.json({ users });
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { name, email, password, role } = body;

  if (!name || !email || !password || !role) {
    return Response.json({ error: "name, email, password and role required" }, { status: 400 });
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return Response.json({ error: "Email already exists" }, { status: 409 });

  const store = await prisma.store.findFirst();
  const newUser = await prisma.user.create({
    data: {
      name, email,
      passwordHash: await bcrypt.hash(password, 10),
      pin: genPin(),
      role,
      storeId: store?.id ?? null,
    },
  });
  return Response.json({ user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, pin: newUser.pin } }, { status: 201 });
}