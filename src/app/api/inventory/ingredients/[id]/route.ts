import { apiAuth } from "@/lib/api";
import {
  InventoryMasterError,
  MASTER_LIMITS,
  booleanValue,
  comparisonName,
  decimalValue,
  hasOwn,
  ingredientUnit,
  inventoryMasterErrorResponse,
  isRecord,
  masterName,
  optionalId,
  optionalText,
  requiredId,
  requireInventoryStore,
  storeIngredientNameConflict,
  storeIngredientSelect,
} from "@/lib/inventory/master-data";
import {
  lockInventoryCategoryMaster,
  lockStoreIngredientMaster,
  lockSupplierMaster,
} from "@/lib/inventory/master-locks";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Product");
    const ingredient = await prisma.storeIngredient.findFirst({
      where: {
        id,
        storeId,
        ...(user.role === "MANAGER" ? { isActive: true } : {}),
      },
      select: storeIngredientSelect,
    });
    if (!ingredient) throw new InventoryMasterError("Product not found", 404);
    return Response.json({ ingredient });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load ingredient");
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Product");
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    for (const forbiddenField of [
      "openingQuantity",
      "openingUnitCost",
      "stockQty",
      "ingredientId",
      "storeId",
      "nameKey",
    ]) {
      if (hasOwn(body, forbiddenField)) {
        throw new InventoryMasterError(
          "Opening stock and FIFO cost cannot be edited from product settings"
        );
      }
    }

    const data: Record<string, unknown> = {};
    if (hasOwn(body, "name")) {
      data.name = masterName(body.name, "Product name");
      data.nameKey = comparisonName(data.name as string);
    }
    if (hasOwn(body, "unit")) data.unit = ingredientUnit(body.unit);
    if (hasOwn(body, "description")) {
      data.description = optionalText(
        body.description,
        "Description",
        MASTER_LIMITS.description
      );
    }
    if (hasOwn(body, "categoryId")) {
      const categoryId = optionalId(body.categoryId, "Category");
      if (!categoryId) throw new InventoryMasterError("Category is required");
      data.categoryId = categoryId;
    }
    if (hasOwn(body, "dailyStockTracking")) {
      data.dailyStockTracking = booleanValue(
        body.dailyStockTracking,
        "Daily stock tracking"
      );
    }
    if (hasOwn(body, "reorderLevel")) {
      data.reorderLevel = decimalValue(body.reorderLevel, {
        label: "Reorder level",
        scale: 3,
        max: MASTER_LIMITS.maxReorderLevel,
      });
    }
    if (hasOwn(body, "costPerUnit")) {
      data.costPerUnit = decimalValue(body.costPerUnit, {
        label: "Reference cost per unit",
        scale: 2,
        max: MASTER_LIMITS.maxCost,
        nullable: true,
      });
    }
    const hasPreferredSupplier = hasOwn(body, "preferredSupplierId");
    if (hasPreferredSupplier) {
      data.preferredSupplierId = optionalId(
        body.preferredSupplierId,
        "Preferred supplier"
      );
    }
    if (hasOwn(body, "isActive")) {
      data.isActive = booleanValue(body.isActive, "Active status");
    }
    if (Object.keys(data).length === 0) {
      throw new InventoryMasterError("No supported product changes were provided");
    }

    const ingredient = await prisma.$transaction(async (tx) => {
      await lockStoreIngredientMaster(tx, id);
      const existing = await tx.storeIngredient.findFirst({
        where: { id, storeId },
        select: {
          id: true,
          ingredientId: true,
          nameKey: true,
          unit: true,
          categoryId: true,
          preferredSupplierId: true,
          isActive: true,
          stockQty: true,
        },
      });
      if (!existing) throw new InventoryMasterError("Product not found", 404);

      const finalNameKey = typeof data.nameKey === "string" ? data.nameKey : existing.nameKey;
      if (await storeIngredientNameConflict(tx, storeId, finalNameKey, id)) {
        throw new InventoryMasterError(
          "A product with this name already exists in this outlet",
          409
        );
      }

      if (typeof data.unit === "string" && data.unit !== existing.unit) {
        const [movementCount, layerCount, recipeCount] = await Promise.all([
          tx.stockMovement.count({ where: { storeId, storeIngredientId: id } }),
          tx.inventoryStockLayer.count({ where: { storeId, storeIngredientId: id } }),
          tx.recipeItem.count({ where: { ingredientId: existing.ingredientId } }),
        ]);
        if (
          movementCount > 0 ||
          layerCount > 0 ||
          recipeCount > 0 ||
          Number(existing.stockQty) !== 0
        ) {
          throw new InventoryMasterError(
            "Unit cannot be changed after stock activity or recipe use",
            409
          );
        }
      }

      if (data.isActive === false && existing.isActive) {
        if (Number(existing.stockQty) !== 0) {
          throw new InventoryMasterError(
            "Bring this product's outlet stock to zero before deactivating it",
            409
          );
        }
        const recipeCount = await tx.recipeItem.count({
          where: { ingredientId: existing.ingredientId },
        });
        if (recipeCount > 0) {
          throw new InventoryMasterError(
            "Remove this product from all recipes before deactivating it",
            409
          );
        }
      }

      const finalCategoryId =
        typeof data.categoryId === "string" ? data.categoryId : existing.categoryId;
      const categoryChanged = finalCategoryId !== existing.categoryId;
      const activating = data.isActive === true && !existing.isActive;
      if (categoryChanged || activating) {
        await lockInventoryCategoryMaster(tx, finalCategoryId);
        const category = await tx.inventoryCategory.findFirst({
          where: { id: finalCategoryId, storeId },
          select: { isActive: true },
        });
        if (!category) throw new InventoryMasterError("Category not found", 400);
        if (!category.isActive) throw new InventoryMasterError("Select an active category", 400);
      }

      const preferredSupplierId = data.preferredSupplierId as string | null | undefined;
      if (
        preferredSupplierId &&
        (hasPreferredSupplier || preferredSupplierId !== existing.preferredSupplierId)
      ) {
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
        where: { id },
        data,
        select: storeIngredientSelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ ingredient });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to update ingredient");
  }
}
