import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import {
  postStoreMovement,
  StoreStockError,
  toIngredientStockDto,
} from "@/lib/inventory/stock";

const STOCK_ACTIONS = new Set(["RECEIVE", "ISSUE"]);
const QUANTITY_PRECISION = 1000;
const MAX_STOCK_MILLIUNITS = 999_999_999_999;
const MAX_STOCK_QUANTITY = MAX_STOCK_MILLIUNITS / QUANTITY_PRECISION;
const MAX_UNIT_COST = 99_999_999.99;

const replayMovementSelect = {
  id: true,
  storeId: true,
  storeIngredientId: true,
  ingredientId: true,
  type: true,
  quantity: true,
  unitCost: true,
  supplierId: true,
  wasteRecordId: true,
  note: true,
  createdAt: true,
  storeIngredient: {
    select: {
      id: true,
      storeId: true,
      ingredientId: true,
      name: true,
      unit: true,
      description: true,
      categoryId: true,
      dailyStockTracking: true,
      stockQty: true,
      reorderLevel: true,
      costPerUnit: true,
      preferredSupplierId: true,
      isActive: true,
      version: true,
      category: {
        select: { id: true, name: true, isActive: true },
      },
      preferredSupplier: {
        select: { id: true, name: true, isActive: true },
      },
      ingredient: {
        select: {
          id: true,
          name: true,
          unit: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  },
} as const;

class StockRequestError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

function isPrismaUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function stockMovementId(storeId: string, userId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(`manual-stock:v2:${storeId}:${userId}:${idempotencyKey}`)
    .digest("hex")
    .slice(0, 32);
  return `stk_${digest}`;
}

export async function POST(req: Request) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  if (!user.storeId) {
    return Response.json({ error: "Select an outlet before changing stock" }, { status: 400 });
  }
  const storeId = user.storeId;

  const body = await req.json().catch(() => ({}));
  const ingredientId = typeof body.ingredientId === "string" ? body.ingredientId.trim() : "";
  const action = typeof body.action === "string" ? body.action.toUpperCase() : "";
  const rawQuantity = body.quantity;
  const quantityMilliunits = typeof rawQuantity === "number"
    ? Math.round(rawQuantity * QUANTITY_PRECISION)
    : Number.NaN;
  const quantity = quantityMilliunits / QUANTITY_PRECISION;
  const note = typeof body.note === "string" ? body.note.trim() : "";
  const rawUnitCost = body.unitCost;
  const unitCost = typeof rawUnitCost === "number" ? rawUnitCost : Number.NaN;
  const supplierId = body.supplierId == null
    ? null
    : typeof body.supplierId === "string"
      ? body.supplierId.trim()
      : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!ingredientId || ingredientId.length > 191) {
    return Response.json({ error: "A valid ingredient is required" }, { status: 400 });
  }
  if (!STOCK_ACTIONS.has(action)) {
    return Response.json({ error: "Action must be RECEIVE or ISSUE" }, { status: 400 });
  }
  if (typeof rawQuantity !== "number" || !Number.isFinite(rawQuantity) || rawQuantity < 0.001 || rawQuantity > MAX_STOCK_QUANTITY) {
    return Response.json({ error: "Quantity must be between 0.001 and 999,999,999.999" }, { status: 400 });
  }
  if (Math.abs(rawQuantity - quantity) > 1e-9) {
    return Response.json({ error: "Quantity can have at most 3 decimal places" }, { status: 400 });
  }
  if (note.length > 191) {
    return Response.json({ error: "Note must be 191 characters or fewer" }, { status: 400 });
  }
  if (action === "ISSUE" && !note) {
    return Response.json({ error: "A reason is required when issuing stock" }, { status: 400 });
  }
  if (
    action === "RECEIVE"
    && (
      typeof rawUnitCost !== "number"
      || !Number.isFinite(unitCost)
      || unitCost <= 0
      || unitCost > MAX_UNIT_COST
      || Math.abs(unitCost * 100 - Math.round(unitCost * 100)) > 1e-7
    )
  ) {
    return Response.json(
      { error: "Unit cost must be greater than zero with at most 2 decimal places" },
      { status: 400 }
    );
  }
  if (supplierId !== null && (!supplierId || supplierId.length > 191)) {
    return Response.json({ error: "A valid supplier is required" }, { status: 400 });
  }
  if (!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey)) {
    return Response.json({ error: "A valid request key is required" }, { status: 400 });
  }

  const movementType = action === "RECEIVE" ? "PURCHASE" : "ADJUSTMENT";
  const movementQuantity = action === "RECEIVE" ? quantity : -quantity;
  const movementNote = note || "Manual stock receipt";
  const movementId = stockMovementId(storeId, user.id, idempotencyKey);

  function matchesRequest(movement: {
    storeId: string;
    ingredientId: string;
    type: string;
    quantity: unknown;
    unitCost: unknown;
    supplierId: string | null;
    note: string | null;
  }) {
    return movement.storeId === storeId
      && movement.ingredientId === ingredientId
      && movement.type === movementType
      && Number(movement.quantity) === movementQuantity
      && (
        action !== "RECEIVE"
        || (
          Number(movement.unitCost) === unitCost
          && movement.supplierId === supplierId
        )
      )
      && (movement.note ?? "") === movementNote;
  }

  async function findReplayResponse() {
    const movement = await prisma.stockMovement.findUnique({
      where: { id: movementId },
      select: replayMovementSelect,
    });
    if (!movement) return null;
    if (matchesRequest(movement)) {
      const { storeIngredient, ...safeMovement } = movement;
      return Response.json({
        ingredient: toIngredientStockDto(storeIngredient),
        movement: safeMovement,
        replayed: true,
      });
    }
    return Response.json(
      { error: "This request key was already used for a different stock change" },
      { status: 409 }
    );
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.stockMovement.findUnique({
        where: { id: movementId },
        select: replayMovementSelect,
      });
      if (existing) {
        if (!matchesRequest(existing)) {
          throw new StockRequestError("This request key was already used for a different stock change", 409);
        }
        const { storeIngredient, ...safeMovement } = existing;
        return {
          ingredient: toIngredientStockDto(storeIngredient),
          movement: safeMovement,
          replayed: true,
        };
      }

      const posted = await postStoreMovement(tx, {
        storeId,
        ingredientId,
        movementId,
        type: movementType,
        quantityDelta: movementQuantity,
        unitCost: action === "RECEIVE" ? unitCost : undefined,
        supplierId: action === "RECEIVE" ? supplierId : undefined,
        note: movementNote,
        insufficientPolicy: "REJECT",
      });
      if (!posted.movement) {
        throw new StoreStockError("No stock movement was created", 409, "EMPTY_MOVEMENT");
      }

      return {
        ingredient: toIngredientStockDto(posted.storeIngredient),
        movement: posted.movement,
        replayed: false,
      };
    });

    return Response.json(result);
  } catch (error) {
    if (error instanceof StockRequestError) {
      if (error.status === 409) {
        const replay = await findReplayResponse();
        if (replay) return replay;
      }
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof StoreStockError) {
      if (error.status === 409) {
        const replay = await findReplayResponse();
        if (replay) return replay;
      }
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (isPrismaUniqueConflict(error)) {
      const replay = await findReplayResponse();
      if (replay) return replay;
    }
    console.error("Failed to update stock", error);
    return Response.json({ error: "Failed to update stock" }, { status: 500 });
  }
}
