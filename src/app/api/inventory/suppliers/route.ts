import { apiAuth } from "@/lib/api";
import {
  InventoryMasterError,
  MASTER_LIMITS,
  booleanValue,
  comparisonName,
  hasOwn,
  inventoryMasterErrorResponse,
  isRecord,
  masterName,
  optionalEmail,
  optionalPhone,
  optionalText,
  requireInventoryStore,
  scopedSupplierNameConflict,
  scopedSupplierSelect,
} from "@/lib/inventory/master-data";
import { prisma } from "@/lib/prisma";

const ADMIN_ROLES = new Set(["SUPER_ADMIN", "ADMIN"]);

export async function GET(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const includeInactive =
      ADMIN_ROLES.has(user.role) &&
      new URL(req.url).searchParams.get("includeInactive") === "true";
    const suppliers = await prisma.supplier.findMany({
      where: { storeId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: scopedSupplierSelect,
    });
    return Response.json({ suppliers });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load suppliers");
  }
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    const name = masterName(body.name, "Supplier name");
    const nameKey = comparisonName(name);
    const contact = hasOwn(body, "contact")
      ? optionalText(body.contact, "Contact person", MASTER_LIMITS.contact)
      : null;
    const phone = hasOwn(body, "phone") ? optionalPhone(body.phone) : null;
    const email = hasOwn(body, "email") ? optionalEmail(body.email) : null;
    const address = hasOwn(body, "address")
      ? optionalText(body.address, "Address", MASTER_LIMITS.address)
      : null;
    const isActive = hasOwn(body, "isActive")
      ? booleanValue(body.isActive, "Active status")
      : true;

    const supplier = await prisma.$transaction(async (tx) => {
      if (await scopedSupplierNameConflict(tx, storeId, nameKey)) {
        throw new InventoryMasterError(
          "A supplier with this name already exists in this outlet",
          409
        );
      }
      return tx.supplier.create({
        data: { storeId, name, nameKey, contact, phone, email, address, isActive },
        select: scopedSupplierSelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ supplier }, { status: 201 });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to create supplier");
  }
}
