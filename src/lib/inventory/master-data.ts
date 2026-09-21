export const INGREDIENT_UNITS = [
  "mg",
  "g",
  "kg",
  "ml",
  "l",
  "pcs",
  "pack",
  "packet",
  "box",
  "bottle",
  "can",
  "jar",
  "tin",
  "bag",
  "tray",
  "portion",
  "dozen",
] as const;

const UNIT_ALIASES: Record<string, (typeof INGREDIENT_UNITS)[number]> = {
  milligram: "mg",
  milligrams: "mg",
  gram: "g",
  grams: "g",
  kilogram: "kg",
  kilograms: "kg",
  milliliter: "ml",
  milliliters: "ml",
  millilitre: "ml",
  millilitres: "ml",
  liter: "l",
  liters: "l",
  litre: "l",
  litres: "l",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
  packs: "pack",
  packets: "packet",
  boxes: "box",
  bottles: "bottle",
  cans: "can",
  jars: "jar",
  tins: "tin",
  bags: "bag",
  trays: "tray",
  portions: "portion",
  dozens: "dozen",
};

const UNIT_SET = new Set<string>(INGREDIENT_UNITS);
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export const MASTER_LIMITS = {
  name: 100,
  description: 500,
  contact: 100,
  phone: 32,
  email: 191,
  address: 191,
  id: 191,
  maxCost: 99_999_999.99,
  maxReorderLevel: 999_999_999.999,
} as const;

export class InventoryMasterError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "InventoryMasterError";
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function cleanText(value: unknown, label: string, maxLength: number) {
  if (typeof value !== "string") {
    throw new InventoryMasterError(`${label} must be text`);
  }
  const cleaned = value.normalize("NFKC").trim().replace(/\s+/g, " ");
  if (!cleaned) {
    throw new InventoryMasterError(`${label} is required`);
  }
  if (cleaned.length > maxLength) {
    throw new InventoryMasterError(`${label} must be ${maxLength} characters or fewer`);
  }
  if (CONTROL_CHARACTERS.test(cleaned)) {
    throw new InventoryMasterError(`${label} contains unsupported characters`);
  }
  return cleaned;
}

export function masterName(value: unknown, label: string) {
  return cleanText(value, label, MASTER_LIMITS.name);
}

export function comparisonName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

export function ingredientUnit(value: unknown) {
  const raw = cleanText(value, "Unit", 20).toLocaleLowerCase("en-US").replace(/\.$/, "");
  const unit = UNIT_ALIASES[raw] ?? raw;
  if (!UNIT_SET.has(unit)) {
    throw new InventoryMasterError(`Unit must be one of: ${INGREDIENT_UNITS.join(", ")}`);
  }
  return unit;
}

export function optionalId(value: unknown, label: string) {
  if (value === null || value === "") return null;
  return cleanText(value, label, MASTER_LIMITS.id);
}

export function requiredId(value: unknown, label: string) {
  const id = optionalId(value, label);
  if (!id) throw new InventoryMasterError(`${label} is required`);
  return id;
}

export function optionalText(value: unknown, label: string, maxLength: number) {
  if (value === null || value === "") return null;
  return cleanText(value, label, maxLength);
}

export function optionalEmail(value: unknown) {
  const email = optionalText(value, "Email", MASTER_LIMITS.email);
  if (email === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new InventoryMasterError("Enter a valid email address");
  }
  return email.toLocaleLowerCase("en-US");
}

export function optionalPhone(value: unknown) {
  const phone = optionalText(value, "Phone", MASTER_LIMITS.phone);
  if (phone === null) return null;
  if (!/^[+()\d.\s-]+$/.test(phone) || phone.replace(/\D/g, "").length < 6) {
    throw new InventoryMasterError("Enter a valid phone number");
  }
  return phone;
}

export function booleanValue(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new InventoryMasterError(`${label} must be true or false`);
  }
  return value;
}

type DecimalOptions = { label: string; scale: number; max: number };

export function decimalValue(
  value: unknown,
  options: DecimalOptions & { nullable: true }
): number | null;
export function decimalValue(
  value: unknown,
  options: DecimalOptions & { nullable?: false }
): number;
export function decimalValue(
  value: unknown,
  options: DecimalOptions & { nullable?: boolean }
): number | null {
  if (options.nullable && (value === null || value === "")) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    throw new InventoryMasterError(`${options.label} must be a number`);
  }
  const raw = String(value).trim();
  const decimalPattern = new RegExp(`^\\d+(?:\\.\\d{1,${options.scale}})?$`);
  if (!decimalPattern.test(raw)) {
    throw new InventoryMasterError(
      `${options.label} must be zero or more with at most ${options.scale} decimal places`
    );
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > options.max) {
    throw new InventoryMasterError(
      `${options.label} must be between 0 and ${options.max.toLocaleString("en-IN")}`
    );
  }
  return parsed;
}

export function inventoryMasterErrorResponse(error: unknown, fallback: string) {
  if (error instanceof InventoryMasterError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (typeof error === "object" && error !== null && "code" in error) {
    if (error.code === "P2002") {
      return Response.json({ error: "A record with this name already exists" }, { status: 409 });
    }
    if (error.code === "P2025") {
      return Response.json({ error: "Record not found" }, { status: 404 });
    }
    if (error.code === "P2034") {
      return Response.json(
        { error: "Inventory master data changed at the same time. Please retry." },
        { status: 409 }
      );
    }
  }
  console.error(fallback, error);
  return Response.json({ error: fallback }, { status: 500 });
}

export const ingredientReadSelect = {
  id: true,
  name: true,
  unit: true,
  reorderLevel: true,
  costPerUnit: true,
  supplierId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true, isActive: true } },
} as const;

export const ingredientMasterSelect = {
  ...ingredientReadSelect,
  _count: { select: { recipe: true, storeIngredients: true, movements: true } },
} as const;

export const supplierMasterRelations = {
  _count: { select: { ingredients: true, storeIngredients: true, movements: true } },
} as const;

export const inventoryCategorySelect = {
  id: true,
  storeId: true,
  name: true,
  nameKey: true,
  description: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const storeIngredientSelect = {
  id: true,
  storeId: true,
  ingredientId: true,
  name: true,
  nameKey: true,
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
  createdAt: true,
  updatedAt: true,
  category: {
    select: { id: true, name: true, isActive: true },
  },
  preferredSupplier: {
    select: { id: true, name: true, isActive: true },
  },
  _count: {
    select: { movements: true, layers: true },
  },
} as const;

export const scopedSupplierSelect = {
  id: true,
  storeId: true,
  name: true,
  nameKey: true,
  contact: true,
  phone: true,
  email: true,
  address: true,
  isActive: true,
  createdAt: true,
  _count: {
    select: { storeIngredients: true, movements: true },
  },
} as const;

export function requireInventoryStore(storeId: string | null | undefined) {
  if (!storeId) {
    throw new InventoryMasterError("Your account is not assigned to an outlet", 400);
  }
  return storeId;
}

export async function storeIngredientNameConflict(
  tx: any,
  storeId: string,
  nameKey: string,
  excludeId?: string
) {
  return Boolean(await tx.storeIngredient.findFirst({
    where: {
      storeId,
      nameKey,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  }));
}

export async function inventoryCategoryNameConflict(
  tx: any,
  storeId: string,
  nameKey: string,
  excludeId?: string
) {
  return Boolean(await tx.inventoryCategory.findFirst({
    where: {
      storeId,
      nameKey,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  }));
}

export async function scopedSupplierNameConflict(
  tx: any,
  storeId: string,
  nameKey: string,
  excludeId?: string
) {
  return Boolean(await tx.supplier.findFirst({
    where: {
      storeId,
      nameKey,
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  }));
}

export async function activeIngredientNameConflict(tx: any, name: string, excludeId?: string) {
  const activeIngredients = await tx.ingredient.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const wanted = comparisonName(name);
  return activeIngredients.some(
    (ingredient: { id: string; name: string }) =>
      ingredient.id !== excludeId && comparisonName(ingredient.name) === wanted
  );
}

export async function activeSupplierNameConflict(tx: any, name: string, excludeId?: string) {
  const activeSuppliers = await tx.supplier.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const wanted = comparisonName(name);
  return activeSuppliers.some(
    (supplier: { id: string; name: string }) =>
      supplier.id !== excludeId && comparisonName(supplier.name) === wanted
  );
}
