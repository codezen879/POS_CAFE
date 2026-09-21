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
  requiredId,
  requireInventoryStore,
} from "@/lib/inventory/master-data";
import { lockInventoryCategoryMaster } from "@/lib/inventory/master-locks";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Category");
    const category = await prisma.inventoryCategory.findFirst({
      where: {
        id,
        storeId,
        ...(user.role === "MANAGER" ? { isActive: true } : {}),
      },
      select: inventoryCategorySelect,
    });
    if (!category) throw new InventoryMasterError("Category not found", 404);
    return Response.json({ category });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load inventory category");
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Category");
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    const data: Record<string, unknown> = {};
    if (hasOwn(body, "name")) {
      data.name = masterName(body.name, "Category name");
      data.nameKey = comparisonName(data.name as string);
    }
    if (hasOwn(body, "description")) {
      data.description = optionalText(
        body.description,
        "Description",
        MASTER_LIMITS.description
      );
    }
    if (hasOwn(body, "isActive")) {
      data.isActive = booleanValue(body.isActive, "Active status");
    }
    if (Object.keys(data).length === 0) {
      throw new InventoryMasterError("No supported category changes were provided");
    }

    const category = await prisma.$transaction(async (tx) => {
      await lockInventoryCategoryMaster(tx, id);
      const existing = await tx.inventoryCategory.findFirst({
        where: { id, storeId },
        select: { id: true, name: true, nameKey: true, isActive: true },
      });
      if (!existing) throw new InventoryMasterError("Category not found", 404);

      const finalNameKey = typeof data.nameKey === "string" ? data.nameKey : existing.nameKey;
      if (await inventoryCategoryNameConflict(tx, storeId, finalNameKey, id)) {
        throw new InventoryMasterError(
          "A category with this name already exists in this outlet",
          409
        );
      }

      if (data.isActive === false && existing.isActive) {
        const activeProductCount = await tx.storeIngredient.count({
          where: { storeId, categoryId: id, isActive: true },
        });
        if (activeProductCount > 0) {
          throw new InventoryMasterError(
            "Deactivate or move all active products before deactivating this category",
            409
          );
        }
      }

      return tx.inventoryCategory.update({
        where: { id },
        data,
        select: inventoryCategorySelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ category });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to update inventory category");
  }
}
