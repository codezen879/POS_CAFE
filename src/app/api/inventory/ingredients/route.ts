import { apiAuth } from "@/lib/api";
import {
  INGREDIENT_UNITS,
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
  requireInventoryStore,
  storeIngredientNameConflict,
  storeIngredientSelect,
} from "@/lib/inventory/master-data";
import {
  lockInventoryCategoryMaster,
  lockSupplierMaster,
} from "@/lib/inventory/master-locks";
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
    const ingredients = await prisma.storeIngredient.findMany({
      where: { storeId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: storeIngredientSelect,
    });
    return Response.json({ ingredients, units: INGREDIENT_UNITS });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load ingredients");
  }
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    const name = masterName(body.name, "Product name");
    const nameKey = comparisonName(name);
    const unit = ingredientUnit(body.unit);
    const categoryId = optionalId(body.categoryId, "Category");
    if (!categoryId) throw new InventoryMasterError("Category is required");
    const description = hasOwn(body, "description")
      ? optionalText(body.description, "Description", MASTER_LIMITS.description)
      : null;
    const dailyStockTracking = hasOwn(body, "dailyStockTracking")
      ? booleanValue(body.dailyStockTracking, "Daily stock tracking")
      : false;
    const reorderLevel = hasOwn(body, "reorderLevel")
      ? decimalValue(body.reorderLevel, {
          label: "Reorder level",
          scale: 3,
          max: MASTER_LIMITS.maxReorderLevel,
        })
      : 0;
    const openingQuantity = hasOwn(body, "openingQuantity")
      ? decimalValue(body.openingQuantity, {
          label: "Opening quantity",
          scale: 3,
          max: MASTER_LIMITS.maxReorderLevel,
        })
      : 0;
    const openingUnitCost = hasOwn(body, "openingUnitCost")
      ? decimalValue(body.openingUnitCost, {
          label: "Opening unit cost",
          scale: 2,
          max: MASTER_LIMITS.maxCost,
          nullable: true,
        })
      : null;
    if (openingQuantity > 0 && (openingUnitCost === null || openingUnitCost <= 0)) {
      throw new InventoryMasterError(
        "Opening unit cost must be greater than zero when opening quantity is entered"
      );
    }
    const preferredSupplierId = hasOwn(body, "preferredSupplierId")
      ? optionalId(body.preferredSupplierId, "Preferred supplier")
      : null;
    const isActive = hasOwn(body, "isActive")
      ? booleanValue(body.isActive, "Active status")
      : true;
    const storedUnitCost = openingUnitCost && openingUnitCost > 0 ? openingUnitCost : null;

    const ingredient = await prisma.$transaction(async (tx) => {
      await lockInventoryCategoryMaster(tx, categoryId);
      const category = await tx.inventoryCategory.findFirst({
        where: { id: categoryId, storeId },
        select: { isActive: true },
      });
      if (!category) throw new InventoryMasterError("Category not found", 400);
      if (!category.isActive) throw new InventoryMasterError("Select an active category", 400);

      if (preferredSupplierId) {
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

      if (await storeIngredientNameConflict(tx, storeId, nameKey)) {
        throw new InventoryMasterError(
          "A product with this name already exists in this outlet",
          409
        );
      }

      const backingIngredient = await tx.ingredient.create({
        data: {
          name,
          unit,
          stockQty: 0,
          reorderLevel,
          costPerUnit: storedUnitCost,
          supplierId: preferredSupplierId,
          // The backing row is an internal recipe/movement identity. Outlet
          // availability is owned solely by StoreIngredient.isActive.
          isActive: true,
        },
        select: { id: true },
      });
      const storeIngredient = await tx.storeIngredient.create({
        data: {
          storeId,
          ingredientId: backingIngredient.id,
          name,
          nameKey,
          unit,
          description,
          categoryId,
          dailyStockTracking,
          stockQty: openingQuantity,
          reorderLevel,
          costPerUnit: storedUnitCost,
          preferredSupplierId,
          isActive,
          version: openingQuantity > 0 ? 1 : 0,
        },
        select: { id: true, ingredientId: true },
      });

      if (openingQuantity > 0) {
        const receivedAt = new Date();
        const movement = await tx.stockMovement.create({
          data: {
            storeId,
            storeIngredientId: storeIngredient.id,
            ingredientId: backingIngredient.id,
            type: "STOCKTAKE",
            quantity: openingQuantity,
            unitCost: openingUnitCost,
            supplierId: preferredSupplierId,
            note: "Opening stock",
            createdAt: receivedAt,
          },
          select: { id: true },
        });
        await tx.inventoryStockLayer.create({
          data: {
            storeId,
            storeIngredientId: storeIngredient.id,
            sourceMovementId: movement.id,
            sourceType: "OPENING",
            openingKey: storeIngredient.id,
            originalQty: openingQuantity,
            remainingQty: openingQuantity,
            unitCost: openingUnitCost!,
            receivedAt,
          },
        });
      }

      return tx.storeIngredient.findUniqueOrThrow({
        where: { id: storeIngredient.id },
        select: storeIngredientSelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ ingredient }, { status: 201 });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to create ingredient");
  }
}
