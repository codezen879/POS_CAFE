import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";

export async function GET(req: Request) {
  const user = await apiAuth();
  if (user instanceof Response) return user;
  const url = new URL(req.url);
  const phone = url.searchParams.get("phone");
  if (!phone) return jsonError("Phone is required", 400);
  const customer = await prisma.customer.findUnique({ where: { phone } });
  return Response.json({ customer });
}