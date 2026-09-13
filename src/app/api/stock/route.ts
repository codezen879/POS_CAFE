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
    note: string | null;
  }) {
    return movement.storeId === storeId
      && movement.ingredientId === ingredientId
      && movement.type === movementType
      && Number(movement.quantity) === movementQuantity
      && (movement.note ?? "") === movementNote;
  }

  async function findReplayResponse() {
    const movement = await prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: { storeIngredient: { include: { ingredient: true } } },
    });
    if (!movement) return null;
    if (matchesRequest(movement)) {
      return Response.json({
        ingredient: toIngredientStockDto(movement.storeIngredient),
        movement,
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
        include: { storeIngredient: { include: { ingredient: true } } },
      });
      if (existing) {
        if (!matchesRequest(existing)) {
          throw new StockRequestError("This request key was already used for a different stock change", 409);
        }
        return {
          ingredient: toIngredientStockDto(existing.storeIngredient),
          movement: existing,
          replayed: true,
        };
      }

      const posted = await postStoreMovement(tx, {
        storeId,
        ingredientId,
        movementId,
        type: movementType,
        quantityDelta: movementQuantity,
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
