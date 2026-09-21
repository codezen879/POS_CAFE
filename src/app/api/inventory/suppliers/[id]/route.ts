import { apiAuth } from "@/lib/api";
import {
  InventoryMasterError,
  MASTER_LIMITS,
  booleanValue,
  comparisonName,
  hasOwn,
  inventoryMasterErrorResponse,
  isRecord,
  masterName,
  optionalEmail,
  optionalPhone,
  optionalText,
  requiredId,
  requireInventoryStore,
  scopedSupplierNameConflict,
  scopedSupplierSelect,
} from "@/lib/inventory/master-data";
import { lockSupplierMaster } from "@/lib/inventory/master-locks";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN", "MANAGER");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Supplier");
    const supplier = await prisma.supplier.findFirst({
      where: {
        id,
        storeId,
        ...(user.role === "MANAGER" ? { isActive: true } : {}),
      },
      select: scopedSupplierSelect,
    });
    if (!supplier) throw new InventoryMasterError("Supplier not found", 404);
    return Response.json({ supplier });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to load supplier");
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const user = await apiAuth("SUPER_ADMIN", "ADMIN");
  if (user instanceof Response) return user;

  try {
    const storeId = requireInventoryStore(user.storeId);
    const { id: rawId } = await params;
    const id = requiredId(rawId, "Supplier");
    const body = await req.json().catch(() => null);
    if (!isRecord(body)) throw new InventoryMasterError("A valid request body is required");

    const data: Record<string, unknown> = {};
    if (hasOwn(body, "name")) {
      data.name = masterName(body.name, "Supplier name");
      data.nameKey = comparisonName(data.name as string);
    }
    if (hasOwn(body, "contact")) {
      data.contact = optionalText(body.contact, "Contact person", MASTER_LIMITS.contact);
    }
    if (hasOwn(body, "phone")) data.phone = optionalPhone(body.phone);
    if (hasOwn(body, "email")) data.email = optionalEmail(body.email);
    if (hasOwn(body, "address")) {
      data.address = optionalText(body.address, "Address", MASTER_LIMITS.address);
    }
    if (hasOwn(body, "isActive")) {
      data.isActive = booleanValue(body.isActive, "Active status");
    }
    if (Object.keys(data).length === 0) {
      throw new InventoryMasterError("No supported supplier changes were provided");
    }

    const supplier = await prisma.$transaction(async (tx) => {
      await lockSupplierMaster(tx, id);
      const existing = await tx.supplier.findFirst({
        where: { id, storeId },
        select: { id: true, nameKey: true },
      });
      if (!existing) throw new InventoryMasterError("Supplier not found", 404);

      const finalNameKey = typeof data.nameKey === "string" ? data.nameKey : existing.nameKey;
      if (await scopedSupplierNameConflict(tx, storeId, finalNameKey, id)) {
        throw new InventoryMasterError(
          "A supplier with this name already exists in this outlet",
          409
        );
      }

      return tx.supplier.update({
        where: { id },
        data,
        select: scopedSupplierSelect,
      });
    }, { isolationLevel: "Serializable" });

    return Response.json({ supplier });
  } catch (error) {
    return inventoryMasterErrorResponse(error, "Failed to update supplier");
  }
}
