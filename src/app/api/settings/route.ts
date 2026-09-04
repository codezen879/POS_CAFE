import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";

export async function PATCH(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  const body = await req.json().catch(() => ({}));
  const { id, fields } = body;

  if (id?.startsWith("key:")) {
    // update a generic setting
    const key = id.slice(4);
    const storeId = (await prisma.store.findFirst())?.id;
    if (!storeId) return Response.json({ error: "No store" }, { status: 400 });

    // Validate numeric business settings to prevent NaN/corrupted billing values.
    const NUMERIC_KEYS = ["service_charge_percent", "loyalty_points_per_rupee", "loyalty_points_per_amount"];
    const MAX: Record<string, number> = { service_charge_percent: 100, loyalty_points_per_rupee: 1000, loyalty_points_per_amount: 1000 };
    if (NUMERIC_KEYS.includes(key)) {
      const num = Number(fields);
      if (!Number.isFinite(num) || num < 0) {
        return Response.json({ error: `${key} must be a non-negative number` }, { status: 400 });
      }
      if (MAX[key] !== undefined && num > MAX[key]) {
        return Response.json({ error: `${key} cannot exceed ${MAX[key]}` }, { status: 400 });
      }
    }

    const setting = await prisma.setting.upsert({
      where: { storeId_key: { storeId, key } },
      update: { value: String(fields) },
      create: { storeId, key, value: String(fields) },
    });
    return Response.json({ setting });
  }

  const storeId = await prisma.store.findFirst().then((s) => s?.id);
  if (!storeId) return Response.json({ error: "No store" }, { status: 400 });
  const allowed = ["name", "legalName", "address", "city", "state", "phone", "email", "gstin", "currency"];
  const data: any = {};
  for (const [k, v] of Object.entries(fields ?? {})) {
    if (allowed.includes(k)) data[k] = String(v);
  }
  const store = await prisma.store.update({ where: { id: storeId }, data });
  return Response.json({ store });
}