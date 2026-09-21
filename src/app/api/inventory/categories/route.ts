import { apiAuth } from "@/lib/api";
import {
  InventoryMasterError,
  MASTER_LIMITS,
  booleanValue,
  comparisonName,
  hasOwn,
  inventoryCategoryNameConflict,
  inventoryCategorySelect,
  inventoryMasterErrorResponse,
  isRecord,
  masterName,
  optionalText,
  requireInventoryStore,
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
    const categories = await prisma.inventoryCategory.findMany({
      where: { storeId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: inventoryCategorySelect,
    });
    return Response.json({ categories });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load inventory categories");
  }
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    const name = masterName(body.name, "Category name");
    const nameKey = comparisonName(name);
    const description = hasOwn(body, "description")
      ? optionalText(body.description, "Description", MASTER_LIMITS.description)
      : null;
    const isActive = hasOwn(body, "isActive")
      ? booleanValue(body.isActive, "Active status")
      : true;

    const category = await prisma.$transaction(async (tx) => {
      if (await inventoryCategoryNameConflict(tx, storeId, nameKey)) {
        throw new InventoryMasterError(
          "A category with this name already exists in this outlet",
          409
        );
      }
      return tx.inventoryCategory.create({
        data: { storeId, name, nameKey, description, isActive },
        select: inventoryCategorySelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ category }, { status: 201 });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to create inventory category");
  }
}
