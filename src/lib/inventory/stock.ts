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

function isUniqueConflict(error: unknown) {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "P2002";
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

function resolveUnitCost(value: number | null | undefined, fallback: unknown) {
  if (value === null) return null;
  const candidate = value === undefined && fallback != null ? Number(fallback) : value;
  if (candidate == null) return null;
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > MAX_UNIT_COST) {
    throw new StoreStockError("Unit cost is invalid", 400, "INVALID_COST");
  }
  const rounded = Math.round(candidate * 100) / 100;
  if (Math.abs(candidate - rounded) > 1e-9) {
    throw new StoreStockError("Unit cost must use at most two decimal places", 400, "INVALID_COST");
  }
  return rounded;
}

/**
 * Ensures that a catalogue ingredient is configured for one caller-selected
 * store. Missing rows inherit configuration only; stock always starts at zero.
 */
export async function ensureStoreIngredient(
  tx: any,
  input: EnsureStoreIngredientInput
) {
  const storeId = requiredId(input.storeId, "store");
  const ingredientId = requiredId(input.ingredientId, "ingredient");
  const ingredient = await tx.ingredient.findUnique({ where: { id: ingredientId } });
  if (!ingredient) {
    throw new StoreStockError("Ingredient not found", 404, "INGREDIENT_NOT_FOUND");
  }

  try {
    return await tx.storeIngredient.upsert({
      where: { storeId_ingredientId: { storeId, ingredientId } },
      update: {},
      create: {
        storeId,
        ingredientId,
        stockQty: 0,
        reorderLevel: ingredient.reorderLevel,
        costPerUnit: ingredient.costPerUnit,
        preferredSupplierId: ingredient.supplierId,
      },
      include: { ingredient: true },
    });
  } catch (error) {
    // Prisma's MySQL upsert is read-then-create, so two first-use requests can
    // race on the compound unique key. Abort this transaction and let the
    // caller retry after the winning transaction commits.
    if (isUniqueConflict(error)) {
      throw new StoreStockError(
        "Store stock was initialized by another request. Please retry.",
        409,
        "STOCK_CONFLICT"
      );
    }
    throw error;
  }
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
          `${storeIngredient.ingredient.name} has only ${currentMilliunits / QUANTITY_PRECISION} ${storeIngredient.ingredient.unit} available`,
          409,
          "INSUFFICIENT_STOCK"
        );
      }
      actualMilliunits = -currentMilliunits;
    }
  } else if (currentMilliunits + requested.milliunits > MAX_STOCK_MILLIUNITS) {
    throw new StoreStockError(
      `${storeIngredient.ingredient.name} cannot exceed ${MAX_STOCK_QUANTITY.toLocaleString("en-IN")} ${storeIngredient.ingredient.unit}`,
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
    },
  });
  if (claimed.count !== 1) {
    throw new StoreStockError(
      "Store stock changed while this movement was posted. Please retry.",
      409,
      "STOCK_CONFLICT"
    );
  }

  const resolvedUnitCost = resolveUnitCost(
    input.unitCost,
    locked.costPerUnit ?? storeIngredient.ingredient.costPerUnit
  );
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
    },
  });
  const updated = await tx.storeIngredient.findUniqueOrThrow({
    where: { id: storeIngredient.id },
    include: { ingredient: true },
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
    stockQty: storeIngredient.stockQty,
    reorderLevel: storeIngredient.reorderLevel,
    costPerUnit: storeIngredient.costPerUnit ?? storeIngredient.ingredient?.costPerUnit ?? null,
    supplierId: storeIngredient.preferredSupplierId ?? storeIngredient.ingredient?.supplierId ?? null,
    storeIngredientId: storeIngredient.id,
    storeId: storeIngredient.storeId,
    stockVersion: storeIngredient.version,
  };
}
