"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export const INVENTORY_UNITS = [
  "mg", "g", "kg", "ml", "l", "pcs", "pack", "packet", "box",
  "bottle", "can", "jar", "tin", "bag", "tray", "portion", "dozen",
];

type Category = {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
};

type Supplier = {
  id: string;
  name: string;
  contact?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  isActive: boolean;
};

type Ingredient = {
  id: string;
  ingredientId: string;
  name: string;
  unit: string;
  description?: string | null;
  categoryId: string;
  category?: Category | null;
  reorderLevel: string | number;
  costPerUnit?: string | number | null;
  stockQty?: string | number;
  preferredSupplierId?: string | null;
  supplier?: Supplier | null;
  dailyStockTracking?: boolean;
  isActive: boolean;
  unitLocked?: boolean;
};

async function responseData(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "The request could not be completed");
  return data;
}

function optionalNumber(value: string) {
  return value.trim() ? Number(value) : null;
}

function hasPrecision(value: number, scale: number) {
  const factor = 10 ** scale;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-7;
}

export function IngredientMasterDialog({
  ingredient,
  categories,
  suppliers,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient | null;
  categories: Category[];
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(ingredient);
  const activeCategories = categories.filter((category) => category.isActive);
  const categoryOptions = ingredient?.category
    && !ingredient.category.isActive
    && !activeCategories.some((category) => category.id === ingredient.categoryId)
      ? [...activeCategories, ingredient.category]
      : activeCategories;
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const supplierOptions = ingredient?.supplier
    && !ingredient.supplier.isActive
    && !activeSuppliers.some((supplier) => supplier.id === ingredient.supplier?.id)
      ? [...activeSuppliers, ingredient.supplier]
      : activeSuppliers;

  const [name, setName] = useState(ingredient?.name ?? "");
  const [categoryId, setCategoryId] = useState(
    ingredient?.categoryId ?? activeCategories[0]?.id ?? ""
  );
  const [unit, setUnit] = useState(ingredient?.unit ?? "kg");
  const [description, setDescription] = useState(ingredient?.description ?? "");
  const [reorderLevel, setReorderLevel] = useState(String(ingredient?.reorderLevel ?? "0"));
  const [unitCost, setUnitCost] = useState(
    ingredient?.costPerUnit == null ? "" : String(ingredient.costPerUnit)
  );
  const [openingQuantity, setOpeningQuantity] = useState("0");
  const [supplierId, setSupplierId] = useState(
    ingredient?.preferredSupplierId ?? ingredient?.supplier?.id ?? "none"
  );
  const [dailyStockTracking, setDailyStockTracking] = useState(
    ingredient?.dailyStockTracking ?? false
  );
  const [loading, setLoading] = useState(false);

  async function save() {
    const normalizedName = name.trim();
    const normalizedDescription = description.trim();
    const reorder = Number(reorderLevel);
    const cost = optionalNumber(unitCost);
    const opening = editing ? 0 : Number(openingQuantity);

    if (!categoryId) return toast.error("Select a category");
    if (!normalizedName) return toast.error("Enter a product name");
    if (!INVENTORY_UNITS.includes(unit)) return toast.error("Select a valid base unit");
    if (!Number.isFinite(reorder) || reorder < 0 || !hasPrecision(reorder, 3)) {
      return toast.error("Enter a valid reorder level with at most 3 decimal places");
    }
    if (!Number.isFinite(opening) || opening < 0 || !hasPrecision(opening, 3)) {
      return toast.error("Enter a valid opening stock with at most 3 decimal places");
    }
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || !hasPrecision(cost, 2))) {
      return toast.error("Enter a valid unit cost with at most 2 decimal places");
    }
    if (opening > 0 && (cost === null || cost <= 0)) {
      return toast.error("Unit cost is required when opening stock is greater than zero");
    }
    if (normalizedDescription.length > 500) {
      return toast.error("Description must be 500 characters or fewer");
    }

    setLoading(true);
    try {
      const url = editing
        ? `/api/inventory/ingredients/${ingredient!.id}`
        : "/api/inventory/ingredients";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          categoryId,
          unit,
          description: normalizedDescription || null,
          reorderLevel: reorder,
          costPerUnit: cost,
          ...(!editing
            ? { openingQuantity: opening, openingUnitCost: cost }
            : {}),
          preferredSupplierId: supplierId === "none" ? null : supplierId,
          dailyStockTracking,
        }),
      });
      await responseData(res);
      toast.success(editing ? "Inventory product updated" : "Inventory product added");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save inventory product");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit inventory product" : "Add inventory product"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Select value={categoryId} onValueChange={setCategoryId} disabled={loading}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((category) => (
                    <SelectItem key={category.id} value={category.id} disabled={!category.isActive}>
                      {category.name}{category.isActive ? "" : " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeCategories.length === 0 && (
                <p className="text-xs text-destructive">Add an active category before adding a product.</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ingredient-name">Product name</Label>
              <Input
                id="ingredient-name"
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={loading}
                placeholder="e.g. Full cream milk"
                autoFocus
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Base stock unit</Label>
              <Select value={unit} onValueChange={setUnit} disabled={loading || Boolean(ingredient?.unitLocked)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {INVENTORY_UNITS.map((option) => (
                    <SelectItem key={option} value={option}>{option}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {ingredient?.unitLocked
                  ? "The unit is locked because this product already has stock history or recipe usage."
                  : "All stock for this product will use this base unit."}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ingredient-reorder">Minimum stock level</Label>
              <Input
                id="ingredient-reorder"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.001"
                value={reorderLevel}
                onChange={(event) => setReorderLevel(event.target.value)}
                disabled={loading}
              />
            </div>
          </div>

          {!editing && (
            <div className="grid gap-4 rounded-xl border bg-muted/20 p-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="opening-stock">Opening stock ({unit})</Label>
                <Input
                  id="opening-stock"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.001"
                  value={openingQuantity}
                  onChange={(event) => setOpeningQuantity(event.target.value)}
                  disabled={loading}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="opening-cost">Opening cost per {unit}</Label>
                <Input
                  id="opening-cost"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  disabled={loading}
                  placeholder={Number(openingQuantity) > 0 ? "Required" : "Optional"}
                />
                <p className="text-xs text-muted-foreground">
                  Opening stock creates the first FIFO cost layer.
                </p>
              </div>
            </div>
          )}

          {editing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Current stock</Label>
                <div className="flex h-10 items-center rounded-md border bg-muted/50 px-3 text-sm font-medium">
                  {Number(ingredient?.stockQty ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 })} {unit}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="reference-cost">Current reference cost per {unit}</Label>
                <Input
                  id="reference-cost"
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  disabled={loading}
                  placeholder="Optional"
                />
                <p className="text-xs text-muted-foreground">This does not rewrite existing FIFO layers.</p>
              </div>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Preferred supplier</Label>
              <Select value={supplierId} onValueChange={setSupplierId} disabled={loading}>
                <SelectTrigger><SelectValue placeholder="No supplier" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No supplier</SelectItem>
                  {supplierOptions.map((supplier) => (
                    <SelectItem key={supplier.id} value={supplier.id} disabled={!supplier.isActive}>
                      {supplier.name}{supplier.isActive ? "" : " (inactive)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
              <div>
                <Label htmlFor="daily-stock-tracking">Daily stock tracking</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Mark this product for the daily opening and closing workflow.
                </p>
              </div>
              <Switch
                id="daily-stock-tracking"
                checked={dailyStockTracking}
                onCheckedChange={setDailyStockTracking}
                disabled={loading}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="ingredient-description">Description</Label>
            <Textarea
              id="ingredient-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading}
              placeholder="Optional notes about quality, storage or usage"
              rows={3}
            />
          </div>
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            This product, its category, pricing and stock belong only to the current outlet.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading || !categoryId || activeCategories.length === 0}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function CategoryMasterDialog({
  category,
  onClose,
  onSaved,
}: {
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(category);
  const [name, setName] = useState(category?.name ?? "");
  const [description, setDescription] = useState(category?.description ?? "");
  const [loading, setLoading] = useState(false);

  async function save() {
    const normalizedName = name.trim();
    const normalizedDescription = description.trim();
    if (!normalizedName) return toast.error("Enter a category name");
    if (normalizedDescription.length > 500) {
      return toast.error("Description must be 500 characters or fewer");
    }
    setLoading(true);
    try {
      const res = await fetch(
        editing ? `/api/inventory/categories/${category!.id}` : "/api/inventory/categories",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: normalizedName,
            description: normalizedDescription || null,
          }),
        }
      );
      await responseData(res);
      toast.success(editing ? "Category updated" : "Category added");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save category");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit inventory category" : "Add inventory category"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="category-name">Category name</Label>
            <Input
              id="category-name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={loading}
              placeholder="e.g. Dairy"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="category-description">Description</Label>
            <Textarea
              id="category-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={loading}
              placeholder="Optional"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Add category"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SupplierMasterDialog({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = Boolean(supplier);
  const [name, setName] = useState(supplier?.name ?? "");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [phone, setPhone] = useState(supplier?.phone ?? "");
  const [email, setEmail] = useState(supplier?.email ?? "");
  const [address, setAddress] = useState(supplier?.address ?? "");
  const [loading, setLoading] = useState(false);

  async function save() {
    const normalizedName = name.trim();
    if (!normalizedName) return toast.error("Enter a supplier name");
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      return toast.error("Enter a valid email address");
    }

    setLoading(true);
    try {
      const url = editing
        ? `/api/inventory/suppliers/${supplier!.id}`
        : "/api/inventory/suppliers";
      const res = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: normalizedName,
          contact: contact.trim() || null,
          phone: phone.trim() || null,
          email: email.trim() || null,
          address: address.trim() || null,
        }),
      });
      await responseData(res);
      toast.success(editing ? "Supplier updated" : "Supplier added");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save supplier");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit supplier" : "Add supplier"}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="supplier-name">Supplier name</Label>
            <Input id="supplier-name" maxLength={100} value={name} onChange={(event) => setName(event.target.value)} disabled={loading} autoFocus />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-contact">Contact person</Label>
            <Input id="supplier-contact" maxLength={100} value={contact} onChange={(event) => setContact(event.target.value)} disabled={loading} placeholder="Optional" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier-phone">Phone</Label>
              <Input id="supplier-phone" maxLength={32} value={phone} onChange={(event) => setPhone(event.target.value)} disabled={loading} placeholder="Optional" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="supplier-email">Email</Label>
              <Input id="supplier-email" type="email" maxLength={191} value={email} onChange={(event) => setEmail(event.target.value)} disabled={loading} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="supplier-address">Address</Label>
            <Textarea id="supplier-address" maxLength={191} value={address} onChange={(event) => setAddress(event.target.value)} disabled={loading} placeholder="Optional" rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {editing ? "Save changes" : "Add supplier"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function OutletInventoryDialog({
  ingredient,
  suppliers,
  onClose,
  onSaved,
}: {
  ingredient: Ingredient;
  suppliers: Supplier[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [reorderLevel, setReorderLevel] = useState(String(ingredient.reorderLevel ?? "0"));
  const [costPerUnit, setCostPerUnit] = useState(
    ingredient.costPerUnit == null ? "" : String(ingredient.costPerUnit)
  );
  const [preferredSupplierId, setPreferredSupplierId] = useState(
    ingredient.preferredSupplierId ?? ingredient.supplier?.id ?? "none"
  );
  const [dailyStockTracking, setDailyStockTracking] = useState(
    ingredient.dailyStockTracking ?? false
  );
  const [loading, setLoading] = useState(false);
  const activeSuppliers = suppliers.filter((supplier) => supplier.isActive);
  const supplierOptions = ingredient.supplier
    && !ingredient.supplier.isActive
    && !activeSuppliers.some((supplier) => supplier.id === ingredient.supplier?.id)
      ? [...activeSuppliers, ingredient.supplier]
      : activeSuppliers;

  async function save() {
    const reorder = Number(reorderLevel);
    const cost = optionalNumber(costPerUnit);
    if (!Number.isFinite(reorder) || reorder < 0 || !hasPrecision(reorder, 3)) {
      return toast.error("Enter a valid reorder level with at most 3 decimal places");
    }
    if (cost !== null && (!Number.isFinite(cost) || cost < 0 || !hasPrecision(cost, 2))) {
      return toast.error("Enter a valid cost per unit with at most 2 decimal places");
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/inventory/store-ingredients/${ingredient.ingredientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reorderLevel: reorder,
          costPerUnit: cost,
          preferredSupplierId: preferredSupplierId === "none" ? null : preferredSupplierId,
          dailyStockTracking,
        }),
      });
      await responseData(res);
      toast.success("Outlet inventory settings updated");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update outlet settings");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Outlet settings — {ingredient.name}</DialogTitle></DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="outlet-reorder">Minimum stock ({ingredient.unit})</Label>
              <Input id="outlet-reorder" type="number" inputMode="decimal" min="0" step="0.001" value={reorderLevel} onChange={(event) => setReorderLevel(event.target.value)} disabled={loading} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="outlet-cost">Reference cost per {ingredient.unit}</Label>
              <Input id="outlet-cost" type="number" inputMode="decimal" min="0" step="0.01" value={costPerUnit} onChange={(event) => setCostPerUnit(event.target.value)} disabled={loading} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Preferred supplier</Label>
            <Select value={preferredSupplierId} onValueChange={setPreferredSupplierId} disabled={loading}>
              <SelectTrigger><SelectValue placeholder="No supplier" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No supplier</SelectItem>
                {supplierOptions.map((supplier) => (
                  <SelectItem key={supplier.id} value={supplier.id} disabled={!supplier.isActive}>
                    {supplier.name}{supplier.isActive ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label htmlFor="outlet-daily-tracking">Daily stock tracking</Label>
              <p className="mt-1 text-xs text-muted-foreground">Mark this product for the daily opening and closing workflow.</p>
            </div>
            <Switch id="outlet-daily-tracking" checked={dailyStockTracking} onCheckedChange={setDailyStockTracking} disabled={loading} />
          </div>
          <p className="rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
            Updating these settings does not change stock quantity or rewrite FIFO cost layers.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Save outlet settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
