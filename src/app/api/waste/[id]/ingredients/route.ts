import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { apiAuth } from "@/lib/api";
import { jsonError } from "@/lib/utils";
import { postStoreMovement, StoreStockError } from "@/lib/inventory/stock";

const MAX_QTY = 9_999_999.999;
const MAX_MONEY = 99_999_999.99;

class WasteIngredientError extends Error {
  constructor(message: string, readonly status = 409) {
    super(message);
  }
}

function movementIdFor(storeId: string, idempotencyKey: string) {
  const digest = createHash("sha256")
    .update(`waste-ingredient:v2:${storeId}:${idempotencyKey}`)
    .digest("hex");
  return `wi_${digest}`;
}

function shiftDecimal(value: number, places: number) {
  const [coefficient, exponent = "0"] = value.toString().split("e");
  return Number(`${coefficient}e${Number(exponent) + places}`);
}

function round2(value: number) {
  return shiftDecimal(Math.round(shiftDecimal(value, 2)), -2);
}

function matchesRequest(
  movement: {
    storeId: string;
    ingredientId: string;
    wasteRecordId: string | null;
    quantity: unknown;
    type: unknown;
  },
  input: { storeId: string; recordId: string; ingredientId: string; quantity: number }
) {
  return (
    movement.storeId === input.storeId &&
    movement.wasteRecordId === input.recordId &&
    movement.ingredientId === input.ingredientId &&
    movement.type === "WASTAGE" &&
    Number(movement.quantity) === -input.quantity
  );
}

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;
  if (!user.storeId) return jsonError("Select a store before updating waste", 400);
  const storeId = user.storeId;

  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const ingredientId = typeof body.ingredientId === "string" ? body.ingredientId.trim() : "";
  const requestedQty = body.quantity;
  const idempotencyKey =
    typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";

  if (!ingredientId || ingredientId.length > 191) {
    return jsonError("A valid ingredient is required", 400);
  }
  if (typeof requestedQty !== "number" || !Number.isFinite(requestedQty) || requestedQty < 0.001) {
    return jsonError("Quantity must be a positive number", 400);
  }
  const qty = Math.round(requestedQty * 1000) / 1000;
  if (Math.abs(qty - requestedQty) > 0.000000001) {
    return jsonError("Quantity can have at most three decimal places", 400);
  }
  if (qty > MAX_QTY) return jsonError("Quantity is too large", 400);
  if (
    idempotencyKey.length < 16 ||
    idempotencyKey.length > 128 ||
    !/^[A-Za-z0-9_-]+$/.test(idempotencyKey)
  ) {
    return jsonError("A valid idempotency key is required", 400);
  }

  const movementId = movementIdFor(storeId, idempotencyKey);
  const requestIdentity = { storeId, recordId: id, ingredientId, quantity: qty };

  const runWriteOff = () =>
    prisma.$transaction(
      async (tx) => {
        const record = await tx.wasteRecord.findUnique({ where: { id } });
        if (!record) throw new WasteIngredientError("Waste record not found", 404);
        if (record.storeId !== storeId) {
          throw new WasteIngredientError("Forbidden", 403);
        }
        if (record.source === "ITEM_RETURN_READY_POOL") {
          throw new WasteIngredientError(
            "This returned item is still held ready. Move it to waste before writing off stock."
          );
        }

        const existingMovement = await tx.stockMovement.findUnique({
          where: { id: movementId },
        });
        if (existingMovement) {
          if (!matchesRequest(existingMovement, requestIdentity)) {
            throw new WasteIngredientError(
              "This idempotency key was already used with different waste details"
            );
          }
          return {
            movement: existingMovement,
            wasteTotal: record.totalCost,
            idempotent: true,
          };
        }

        const posted = await postStoreMovement(tx, {
          storeId,
          ingredientId,
          quantityDelta: -qty,
          movementId,
          type: "WASTAGE",
          wasteRecordId: id,
          note: `Waste for ${record.source === "ORDER_CANCEL" ? "cancelled order" : "manual entry"}`,
          insufficientPolicy: "REJECT",
        });
        if (!posted.movement) {
          throw new WasteIngredientError("No ingredient stock was written off");
        }
        const movement = posted.movement;
        const unitCost = movement.unitCost != null ? Number(movement.unitCost) : 0;
        const lineCost = round2(unitCost * Math.abs(posted.actualDelta));
        if (!Number.isFinite(lineCost) || Number(record.totalCost) + lineCost > MAX_MONEY) {
          throw new WasteIngredientError("Waste value is too large", 400);
        }
        const updatedWaste = await tx.wasteRecord.update({
          where: { id: record.id },
          data: { totalCost: { increment: lineCost } },
          select: { totalCost: true },
        });

        return {
          movement,
          wasteTotal: updatedWaste.totalCost,
          idempotent: false,
        };
      },
      { isolationLevel: "Serializable" }
    );

  const findCommittedMovement = () =>
    prisma.stockMovement.findUnique({
      where: { id: movementId },
      include: { wasteRecord: { select: { storeId: true, totalCost: true } } },
    });

  try {
    const result = await runWriteOff().catch((firstError: unknown) => {
      if ((firstError as any)?.code === "P2034") return runWriteOff();
      throw firstError;
    });
    return Response.json(result);
  } catch (error: unknown) {
    if (error instanceof StoreStockError) {
      if (error.status === 409) {
        const committedMovement = await findCommittedMovement();
        if (committedMovement) {
          if (
            committedMovement.wasteRecord?.storeId === storeId &&
            matchesRequest(committedMovement, requestIdentity)
          ) {
            return Response.json({
              movement: committedMovement,
              wasteTotal: committedMovement.wasteRecord?.totalCost ?? null,
              idempotent: true,
            });
          }
          return jsonError(
            "This idempotency key was already used with different waste details",
            409
          );
        }
      }
      return jsonError(error.message, error.status);
    }
    if (error instanceof WasteIngredientError) return jsonError(error.message, error.status);
    if ((error as any)?.code === "P2002" || (error as any)?.code === "P2034") {
      let committedMovement = await findCommittedMovement();
      for (const delay of [25, 75]) {
        if (committedMovement) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        committedMovement = await findCommittedMovement();
      }

      if (committedMovement) {
        if (
          committedMovement.wasteRecord?.storeId === storeId &&
          matchesRequest(committedMovement, requestIdentity)
        ) {
          return Response.json({
            movement: committedMovement,
            wasteTotal: committedMovement.wasteRecord?.totalCost ?? null,
            idempotent: true,
          });
        }
        return jsonError(
          "This idempotency key was already used with different waste details",
          409
        );
      }

      return jsonError("Stock changed while waste was updated. Please try again.", 409);
    }
    return jsonError(error instanceof Error ? error.message : "Failed to add ingredient");
  }
}
