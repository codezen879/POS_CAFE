import { lockIngredientMaster, lockSupplierMaster } from "@/lib/inventory/master-locks";

const QUANTITY_PRECISION = 1000;
const MAX_STOCK_MILLIUNITS = 999_999_999_999;
const MAX_STOCK_QUANTITY = MAX_STOCK_MILLIUNITS / QUANTITY_PRECISION;
const MAX_UNIT_COST = 99_999_999.99;
const MOVEMENT_TYPES = new Set(["PURCHASE", "CONSUMPTION", "ADJUSTMENT", "STOCKTAKE", "WASTAGE"]);

export type InsufficientPolicy = "REJECT" | "CLAMP";

export type StoreMovementType =
  | "PURCHASE"
  | "CONSUMPTION"
  | "ADJUSTMENT"
  | "STOCKTAKE"
  | "WASTAGE";

export type EnsureStoreIngredientInput = {
  storeId: string;
  ingredientId: string;
};

export type PostStoreMovementInput = EnsureStoreIngredientInput & {
  /** Signed physical stock change: positive receives stock, negative removes it. */
  quantityDelta: number;
  movementId?: string;
  type: StoreMovementType;
  note?: string | null;
  unitCost?: number | null;
  supplierId?: string | null;
  wasteRecordId?: string | null;
  insufficientPolicy?: InsufficientPolicy;
};

export type PostStoreMovementResult = {
  storeIngredient: any;
  movement: any | null;
  requestedDelta: number;
  actualDelta: number;
  balance: number;
  clamped: boolean;
};

export class StoreStockError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "STORE_STOCK_ERROR"
  ) {
    super(message);
    this.name = "StoreStockError";
  }
}

function requiredId(value: string, label: string) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.length > 191) {
    throw new StoreStockError(`A valid ${label} is required`, 400, "INVALID_INPUT");
  }
  return normalized;
}

function optionalId(value: string | null | undefined, label: string) {
  if (value == null) return null;
  const normalized = String(value).trim();
  if (!normalized || normalized.length > 191) {
    throw new StoreStockError(`A valid ${label} is required`, 400, "INVALID_INPUT");
  }
  return normalized;
}

function toMilliunits(value: number) {
  return Math.round(value * QUANTITY_PRECISION);
}

function validateQuantityDelta(value: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) {
    throw new StoreStockError("Stock quantity change must be a non-zero number", 400, "INVALID_QUANTITY");
  }
  if (Math.abs(value) > MAX_STOCK_QUANTITY) {
    throw new StoreStockError("Stock quantity change is too large", 400, "INVALID_QUANTITY");
  }

  const milliunits = toMilliunits(value);
  const rounded = milliunits / QUANTITY_PRECISION;
  if (milliunits === 0 || Math.abs(value - rounded) > 1e-9) {
    throw new StoreStockError(
      "Stock quantity change must use at most three decimal places",
      400,
      "INVALID_QUANTITY"
    );
  }
  return { milliunits, rounded };
}

function requiredReceiptUnitCost(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > MAX_UNIT_COST) {
    throw new StoreStockError(
      "A positive unit cost is required when receiving stock",
      400,
      "UNIT_COST_REQUIRED"
    );
  }
  const rounded = Math.round(value * 100) / 100;
  if (Math.abs(value - rounded) > 1e-9) {
    throw new StoreStockError("Unit cost must use at most two decimal places", 400, "INVALID_COST");
  }
  return rounded;
}

function layerQuantityMilliunits(value: unknown) {
  const quantity = Number(value);
  const milliunits = toMilliunits(quantity);
  if (
    !Number.isFinite(quantity)
    || !Number.isSafeInteger(milliunits)
    || milliunits < 0
    || Math.abs(quantity - milliunits / QUANTITY_PRECISION) > 1e-9
  ) {
    throw new StoreStockError(
      "FIFO stock layer quantity is invalid",
      409,
      "INVALID_FIFO_LAYER"
    );
  }
  return milliunits;
}

function layerUnitCostCents(value: unknown) {
  const unitCost = Number(value);
  const cents = Math.round(unitCost * 100);
  if (
    !Number.isFinite(unitCost)
    || !Number.isSafeInteger(cents)
    || unitCost < 0
    || unitCost > MAX_UNIT_COST
    || Math.abs(unitCost - cents / 100) > 1e-9
  ) {
    throw new StoreStockError("FIFO stock layer cost is invalid", 409, "INVALID_FIFO_LAYER");
  }
  return cents;
}

async function lockFifoLayers(tx: any, storeId: string, storeIngredientId: string) {
  const candidates = await tx.inventoryStockLayer.findMany({
    where: { storeId, storeIngredientId, remainingQty: { gt: 0 } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: { id: true },
  });

  // The StoreIngredient row is already locked, so all supported stock writers
  // are serialized. Lock layer rows in FIFO order as a second line of defence.
  // This raw query uses only portable table/id names on PostgreSQL and MySQL.
  for (const candidate of candidates) {
    await tx.$queryRaw`
      SELECT id FROM inventory_stock_layers WHERE id = ${candidate.id} FOR UPDATE
    `;
  }

  return tx.inventoryStockLayer.findMany({
    where: { storeId, storeIngredientId, remainingQty: { gt: 0 } },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      remainingQty: true,
      unitCost: true,
      version: true,
    },
  });
}

/**
 * Loads the outlet-owned inventory product for one backing ingredient.
 * Products are never auto-provisioned into another outlet: doing that would
 * leak catalogue definitions across outlets.
 */
export async function ensureStoreIngredient(
  tx: any,
  input: EnsureStoreIngredientInput
) {
  const storeId = requiredId(input.storeId, "store");
  const ingredientId = requiredId(input.ingredientId, "ingredient");
  await lockIngredientMaster(tx, ingredientId);
  const storeIngredient = await tx.storeIngredient.findUnique({
    where: { storeId_ingredientId: { storeId, ingredientId } },
    include: {
      ingredient: true,
      category: true,
      preferredSupplier: true,
    },
  });
  if (!storeIngredient || storeIngredient.isActive === false) {
    throw new StoreStockError("Ingredient not found", 404, "INGREDIENT_NOT_FOUND");
  }
  return storeIngredient;
}

/**
 * Posts one signed physical movement and its store balance atomically inside
 * the caller's transaction. The catalogue Ingredient balance is never used or
 * mutated. CLAMP applies only to removals and posts the amount actually held.
 */
export async function postStoreMovement(
  tx: any,
  input: PostStoreMovementInput
): Promise<PostStoreMovementResult> {
  const storeId = requiredId(input.storeId, "store");
  const ingredientId = requiredId(input.ingredientId, "ingredient");
  const movementId = input.movementId === undefined
    ? undefined
    : optionalId(input.movementId, "movement id") ?? undefined;
  const supplierId = optionalId(input.supplierId, "supplier");
  const wasteRecordId = optionalId(input.wasteRecordId, "waste record");
  const note = input.note == null ? null : String(input.note).trim() || null;
  if (note && note.length > 191) {
    throw new StoreStockError("Stock movement note must be 191 characters or fewer", 400, "INVALID_INPUT");
  }
  if (input.insufficientPolicy && !["REJECT", "CLAMP"].includes(input.insufficientPolicy)) {
    throw new StoreStockError("Invalid insufficient-stock policy", 400, "INVALID_INPUT");
  }
  if (!MOVEMENT_TYPES.has(input.type)) {
    throw new StoreStockError("Invalid stock movement type", 400, "INVALID_INPUT");
  }

  const requested = validateQuantityDelta(input.quantityDelta);
  const receiptUnitCost = requested.milliunits > 0
    ? requiredReceiptUnitCost(input.unitCost)
    : null;
  const storeIngredient = await ensureStoreIngredient(tx, { storeId, ingredientId });

  // A locking read makes CLAMP deterministic under concurrent writers on both
  // supported databases. The mapped table and id column are lowercase in both.
  const lockedRows = await tx.$queryRaw`
    SELECT * FROM store_ingredients WHERE id = ${storeIngredient.id} FOR UPDATE
  `;
  const locked = Array.isArray(lockedRows) ? lockedRows[0] : null;
  if (!locked || locked.storeId !== storeId || locked.ingredientId !== ingredientId) {
    throw new StoreStockError("Store ingredient not found", 404, "STORE_INGREDIENT_NOT_FOUND");
  }

  // Keep the shared lock order StoreIngredient -> Supplier. Outlet settings
  // follows the same order, preventing a supplier/store deadlock.
  if (supplierId) {
    await lockSupplierMaster(tx, supplierId);
    const supplier = await tx.supplier.findUnique({
      where: { id: supplierId },
      select: { storeId: true, isActive: true },
    });
    if (!supplier || supplier.storeId !== storeId) {
      throw new StoreStockError("Supplier not found", 404, "SUPPLIER_NOT_FOUND");
    }
    if (!supplier.isActive) {
      throw new StoreStockError("Select an active supplier", 409, "SUPPLIER_INACTIVE");
    }
  }

  if (wasteRecordId) {
    const wasteRecord = await tx.wasteRecord.findUnique({
      where: { id: wasteRecordId },
      select: { storeId: true },
    });
    if (!wasteRecord) {
      throw new StoreStockError("Waste record not found", 404, "WASTE_RECORD_NOT_FOUND");
    }
    if (wasteRecord.storeId !== storeId) {
      throw new StoreStockError(
        "Waste record belongs to a different store",
        403,
        "STORE_MISMATCH"
      );
    }
  }

  const currentMilliunits = toMilliunits(Number(locked.stockQty));
  if (!Number.isSafeInteger(currentMilliunits) || currentMilliunits < 0 || currentMilliunits > MAX_STOCK_MILLIUNITS) {
    throw new StoreStockError("Stored stock quantity is invalid", 409, "INVALID_STORED_QUANTITY");
  }

  let actualMilliunits = requested.milliunits;
  const policy = input.insufficientPolicy ?? "REJECT";
  if (requested.milliunits < 0) {
    const requestedRemoval = Math.abs(requested.milliunits);
    if (requestedRemoval > currentMilliunits) {
      if (policy === "REJECT") {
        throw new StoreStockError(
          `${storeIngredient.name} has only ${currentMilliunits / QUANTITY_PRECISION} ${storeIngredient.unit} available`,
          409,
          "INSUFFICIENT_STOCK"
        );
      }
      actualMilliunits = -currentMilliunits;
    }
  } else if (currentMilliunits + requested.milliunits > MAX_STOCK_MILLIUNITS) {
    throw new StoreStockError(
      `${storeIngredient.name} cannot exceed ${MAX_STOCK_QUANTITY.toLocaleString("en-IN")} ${storeIngredient.unit}`,
      409,
      "STOCK_LIMIT_EXCEEDED"
    );
  }

  if (actualMilliunits === 0) {
    const currentStoreIngredient = {
      ...storeIngredient,
      stockQty: locked.stockQty,
      costPerUnit: locked.costPerUnit,
      preferredSupplierId: locked.preferredSupplierId,
      version: locked.version,
    };
    return {
      storeIngredient: currentStoreIngredient,
      movement: null,
      requestedDelta: requested.rounded,
      actualDelta: 0,
      balance: currentMilliunits / QUANTITY_PRECISION,
      clamped: true,
    };
  }

  const actualDelta = actualMilliunits / QUANTITY_PRECISION;
  const resultingMilliunits = currentMilliunits + actualMilliunits;
  const fifoLayers = await lockFifoLayers(tx, storeId, storeIngredient.id);
  const layerBalanceMilliunits = fifoLayers.reduce(
    (total: number, layer: any) => total + layerQuantityMilliunits(layer.remainingQty),
    0
  );
  if (!Number.isSafeInteger(layerBalanceMilliunits) || layerBalanceMilliunits !== currentMilliunits) {
    throw new StoreStockError(
      "FIFO layer balance does not match the stored stock balance",
      409,
      "FIFO_BALANCE_MISMATCH"
    );
  }

  const layerConsumptions: Array<{
    id: string;
    version: number;
    quantityMilliunits: number;
  }> = [];
  let resolvedUnitCost = receiptUnitCost;
  if (actualMilliunits < 0) {
    let remainingToConsume = Math.abs(actualMilliunits);
    let totalCostCentMilliunits = 0n;

    for (const layer of fifoLayers) {
      if (remainingToConsume === 0) break;
      const availableMilliunits = layerQuantityMilliunits(layer.remainingQty);
      const quantityMilliunits = Math.min(availableMilliunits, remainingToConsume);
      if (quantityMilliunits === 0) continue;

      const version = Number(layer.version);
      if (!Number.isSafeInteger(version) || version < 0) {
        throw new StoreStockError("FIFO stock layer version is invalid", 409, "INVALID_FIFO_LAYER");
      }
      totalCostCentMilliunits += BigInt(quantityMilliunits) * BigInt(layerUnitCostCents(layer.unitCost));
      layerConsumptions.push({ id: layer.id, version, quantityMilliunits });
      remainingToConsume -= quantityMilliunits;
    }

    if (remainingToConsume !== 0) {
      throw new StoreStockError(
        "FIFO layers do not contain enough stock for this movement",
        409,
        "FIFO_BALANCE_MISMATCH"
      );
    }

    const consumedMilliunits = BigInt(Math.abs(actualMilliunits));
    const weightedCostCents = (totalCostCentMilliunits + consumedMilliunits / 2n)
      / consumedMilliunits;
    resolvedUnitCost = Number(weightedCostCents) / 100;
  }

  const currentVersion = Number(locked.version);
  if (!Number.isSafeInteger(currentVersion) || currentVersion < 0) {
    throw new StoreStockError("Stored stock version is invalid", 409, "INVALID_STOCK_VERSION");
  }
  const claimed = await tx.storeIngredient.updateMany({
    where: {
      id: storeIngredient.id,
      storeId,
      version: currentVersion,
      ...(actualMilliunits < 0
        ? { stockQty: { gte: Math.abs(actualDelta) } }
        : { stockQty: { lte: (MAX_STOCK_MILLIUNITS - actualMilliunits) / QUANTITY_PRECISION } }),
    },
    data: {
      stockQty: { increment: actualDelta },
      version: { increment: 1 },
      ...(actualMilliunits > 0 ? { costPerUnit: receiptUnitCost } : {}),
    },
  });
  if (claimed.count !== 1) {
    throw new StoreStockError(
      "Store stock changed while this movement was posted. Please retry.",
      409,
      "STOCK_CONFLICT"
    );
  }

  for (const consumption of layerConsumptions) {
    const quantity = consumption.quantityMilliunits / QUANTITY_PRECISION;
    const consumed = await tx.inventoryStockLayer.updateMany({
      where: {
        id: consumption.id,
        storeId,
        storeIngredientId: storeIngredient.id,
        version: consumption.version,
        remainingQty: { gte: quantity },
      },
      data: {
        remainingQty: { decrement: quantity },
        version: { increment: 1 },
      },
    });
    if (consumed.count !== 1) {
      throw new StoreStockError(
        "FIFO stock changed while this movement was posted. Please retry.",
        409,
        "STOCK_CONFLICT"
      );
    }
  }

  const movementAt = new Date();
  const movement = await tx.stockMovement.create({
    data: {
      ...(movementId ? { id: movementId } : {}),
      storeId,
      storeIngredientId: storeIngredient.id,
      ingredientId,
      type: input.type,
      quantity: actualDelta,
      unitCost: resolvedUnitCost,
      supplierId,
      wasteRecordId,
      note,
      createdAt: movementAt,
    },
  });
  if (actualMilliunits > 0) {
    await tx.inventoryStockLayer.create({
      data: {
        storeId,
        storeIngredientId: storeIngredient.id,
        sourceMovementId: movement.id,
        sourceType: input.type,
        originalQty: actualDelta,
        remainingQty: actualDelta,
        unitCost: resolvedUnitCost!,
        receivedAt: movementAt,
      },
    });
  }
  const updated = await tx.storeIngredient.findUniqueOrThrow({
    where: { id: storeIngredient.id },
    include: {
      ingredient: true,
      category: true,
      preferredSupplier: true,
    },
  });

  return {
    storeIngredient: updated,
    movement,
    requestedDelta: requested.rounded,
    actualDelta,
    balance: resultingMilliunits / QUANTITY_PRECISION,
    clamped: actualMilliunits !== requested.milliunits,
  };
}

/** Presents a store-specific balance through the legacy Ingredient DTO shape. */
export function toIngredientStockDto(storeIngredient: any) {
  return {
    ...storeIngredient.ingredient,
    id: storeIngredient.ingredientId,
    name: storeIngredient.name,
    unit: storeIngredient.unit,
    description: storeIngredient.description ?? null,
    categoryId: storeIngredient.categoryId,
    category: storeIngredient.category ?? null,
    dailyStockTracking: storeIngredient.dailyStockTracking,
    isActive: storeIngredient.isActive,
    stockQty: storeIngredient.stockQty,
    reorderLevel: storeIngredient.reorderLevel,
    costPerUnit: storeIngredient.costPerUnit ?? null,
    supplierId: storeIngredient.preferredSupplierId ?? null,
    supplier: storeIngredient.preferredSupplier ?? null,
    storeIngredientId: storeIngredient.id,
    storeId: storeIngredient.storeId,
    stockVersion: storeIngredient.version,
  };
}
