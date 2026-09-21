import { apiAuth } from "@/lib/api";
import {
  InventoryMasterError,
  MASTER_LIMITS,
  booleanValue,
  decimalValue,
  hasOwn,
  inventoryMasterErrorResponse,
  isRecord,
  optionalId,
  requiredId,
  requireInventoryStore,
  storeIngredientSelect,
} from "@/lib/inventory/master-data";
import {
  lockStoreIngredientMaster,
  lockSupplierMaster,
} from "@/lib/inventory/master-locks";
import { prisma } from "@/lib/prisma";

/**
 * Backward-compatible outlet settings endpoint. New clients should use
 * PATCH /api/inventory/ingredients/:storeIngredientId.
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ ingredientId: string }> }
) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { ingredientId: rawId } = await params;
    const requestedId = requiredId(rawId, "Product");
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");
    const hasReorderLevel = hasOwn(body, "reorderLevel");
    const hasCostPerUnit = hasOwn(body, "costPerUnit");
    const hasSupplier = hasOwn(body, "preferredSupplierId");
    const hasDailyTracking = hasOwn(body, "dailyStockTracking");
    if (!hasReorderLevel && !hasCostPerUnit && !hasSupplier && !hasDailyTracking) {
      throw new InventoryMasterError("No outlet inventory settings were provided");
    }
    const reorderLevel = hasReorderLevel
      ? decimalValue(body.reorderLevel, {
          label: "Reorder level",
          scale: 3,
          max: MASTER_LIMITS.maxReorderLevel,
        })
      : undefined;
    const costPerUnit = hasCostPerUnit
      ? decimalValue(body.costPerUnit, {
          label: "Reference cost per unit",
          scale: 2,
          max: MASTER_LIMITS.maxCost,
          nullable: true,
        })
      : undefined;
    const preferredSupplierId = hasSupplier
      ? optionalId(body.preferredSupplierId, "Preferred supplier")
      : undefined;
    const dailyStockTracking = hasDailyTracking
      ? booleanValue(body.dailyStockTracking, "Daily stock tracking")
      : undefined;

    const storeIngredient = await prisma.$transaction(async (tx) => {
      const candidate = await tx.storeIngredient.findFirst({
        where: {
          storeId,
          OR: [{ id: requestedId }, { ingredientId: requestedId }],
        },
        select: { id: true, preferredSupplierId: true },
      });
      if (!candidate) throw new InventoryMasterError("Product not found", 404);

      await lockStoreIngredientMaster(tx, candidate.id);
      const existing = await tx.storeIngredient.findFirst({
        where: { id: candidate.id, storeId },
        select: { id: true, preferredSupplierId: true },
      });
      if (!existing) throw new InventoryMasterError("Product not found", 404);

      if (preferredSupplierId && preferredSupplierId !== existing.preferredSupplierId) {
        await lockSupplierMaster(tx, preferredSupplierId);
        const supplier = await tx.supplier.findFirst({
          where: { id: preferredSupplierId, storeId },
          select: { isActive: true },
        });
        if (!supplier) throw new InventoryMasterError("Preferred supplier not found", 400);
        if (!supplier.isActive) {
          throw new InventoryMasterError("Select an active preferred supplier", 400);
        }
      }

      return tx.storeIngredient.update({
        where: { id: existing.id },
        data: {
          ...(reorderLevel !== undefined ? { reorderLevel } : {}),
          ...(costPerUnit !== undefined ? { costPerUnit } : {}),
          ...(hasSupplier ? { preferredSupplierId } : {}),
          ...(dailyStockTracking !== undefined ? { dailyStockTracking } : {}),
        },
        select: storeIngredientSelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ storeIngredient });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to update outlet inventory settings");
  }
}
