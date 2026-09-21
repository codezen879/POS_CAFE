"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Package,
  ArrowDownRight,
  ArrowUpRight,
  AlertTriangle,
  Loader2,
  Plus,
  Pencil,
  Settings2,
  Search,
  Tags,
  CalendarCheck2,
} from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  CategoryMasterDialog,
  IngredientMasterDialog,
  OutletInventoryDialog,
  SupplierMasterDialog,
} from "@/components/inventory/inventory-master-dialogs";
import toast from "react-hot-toast";

type StockAction = "RECEIVE" | "ISSUE";
const QUANTITY_PRECISION = 1000;
const MAX_STOCK_MILLIUNITS = 999_999_999_999;
const MAX_STOCK_QUANTITY = MAX_STOCK_MILLIUNITS / QUANTITY_PRECISION;

function formatQuantity(value: unknown) {
  const quantity = Number(value);
  return Number.isFinite(quantity)
    ? quantity.toLocaleString("en-IN", { maximumFractionDigits: 3 })
    : "0";
}

function movementDelta(movement: any) {
  const quantity = Number(movement.quantity) || 0;
  if (movement.type === "PURCHASE") return Math.abs(quantity);
  if (movement.type === "CONSUMPTION" || movement.type === "WASTAGE") return -Math.abs(quantity);
  return quantity;
}

function movementLabel(type: string, delta: number) {
  return ({
    PURCHASE: "Received",
    CONSUMPTION: "Consumed",
    ADJUSTMENT: delta < 0 ? "Issued" : "Adjusted",
    STOCKTAKE: "Stocktake",
    WASTAGE: "Waste",
  } as Record<string, string>)[type] ?? type.replaceAll("_", " ");
}

type StatusFilter = "ACTIVE" | "INACTIVE" | "ALL";

function matchesStatus(item: any, filter: StatusFilter) {
  if (filter === "ALL") return true;
  return filter === "ACTIVE" ? item.isActive !== false : item.isActive === false;
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(value);
}

export function InventoryManager({
  ingredients,
  categories,
  suppliers,
  movements,
  canManageMasters,
  canManageStock,
  hasOutlet,
  storeName,
}: any) {
  const router = useRouter();
  const [adjust, setAdjust] = useState<null | any>(null);
  const [outletEditor, setOutletEditor] = useState<null | any>(null);
  const [ingredientEditor, setIngredientEditor] = useState<any | null | undefined>(undefined);
  const [categoryEditor, setCategoryEditor] = useState<any | null | undefined>(undefined);
  const [supplierEditor, setSupplierEditor] = useState<any | null | undefined>(undefined);
  const [ingredientQuery, setIngredientQuery] = useState("");
  const [categoryQuery, setCategoryQuery] = useState("");
  const [supplierQuery, setSupplierQuery] = useState("");
  const [ingredientStatus, setIngredientStatus] = useState<StatusFilter>("ACTIVE");
  const [categoryStatus, setCategoryStatus] = useState<StatusFilter>("ACTIVE");
  const [supplierStatus, setSupplierStatus] = useState<StatusFilter>("ACTIVE");
  const [ingredientCategory, setIngredientCategory] = useState("ALL");
  const [statusChange, setStatusChange] = useState<null | { kind: "ingredient" | "category" | "supplier"; item: any }>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const refresh = () => router.refresh();

  const normalizedIngredientQuery = ingredientQuery.trim().toLocaleLowerCase();
  const normalizedCategoryQuery = categoryQuery.trim().toLocaleLowerCase();
  const normalizedSupplierQuery = supplierQuery.trim().toLocaleLowerCase();
  const visibleIngredients = ingredients.filter((ingredient: any) =>
    matchesStatus(ingredient, canManageMasters ? ingredientStatus : "ACTIVE")
    && (ingredientCategory === "ALL" || ingredient.categoryId === ingredientCategory)
    && (!normalizedIngredientQuery
      || ingredient.name.toLocaleLowerCase().includes(normalizedIngredientQuery)
      || ingredient.unit.toLocaleLowerCase().includes(normalizedIngredientQuery)
      || ingredient.category?.name?.toLocaleLowerCase().includes(normalizedIngredientQuery)
      || ingredient.supplier?.name?.toLocaleLowerCase().includes(normalizedIngredientQuery))
  );
  const visibleCategories = categories.filter((category: any) =>
    matchesStatus(category, canManageMasters ? categoryStatus : "ACTIVE")
    && (!normalizedCategoryQuery
      || category.name.toLocaleLowerCase().includes(normalizedCategoryQuery)
      || category.description?.toLocaleLowerCase().includes(normalizedCategoryQuery))
  );
  const visibleSuppliers = suppliers.filter((supplier: any) =>
    matchesStatus(supplier, canManageMasters ? supplierStatus : "ACTIVE")
    && (!normalizedSupplierQuery
      || supplier.name.toLocaleLowerCase().includes(normalizedSupplierQuery)
      || supplier.contact?.toLocaleLowerCase().includes(normalizedSupplierQuery)
      || supplier.phone?.toLocaleLowerCase().includes(normalizedSupplierQuery)
      || supplier.email?.toLocaleLowerCase().includes(normalizedSupplierQuery))
  );
  const lowStockCount = hasOutlet
    ? ingredients.filter((ingredient: any) =>
        ingredient.isActive !== false
        && Number(ingredient.stockQty) <= Number(ingredient.reorderLevel)
      ).length
    : 0;
  const stockValue = hasOutlet
    ? ingredients.reduce(
        (total: number, ingredient: any) =>
          total + Number(ingredient.stockValue || 0),
        0
      )
    : 0;

  function saved(close: () => void) {
    close();
    refresh();
  }

  async function applyStatusChange() {
    if (!statusChange) return;
    const { kind, item } = statusChange;
    const nextActive = !item.isActive;
    setStatusLoading(true);
    try {
      const collection = kind === "ingredient"
        ? "ingredients"
        : kind === "category"
          ? "categories"
          : "suppliers";
      const res = await fetch(`/api/inventory/${collection}/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to update status");
      const label = kind === "ingredient" ? "Product" : kind === "category" ? "Category" : "Supplier";
      toast.success(`${label} ${nextActive ? "reactivated" : "deactivated"}`);
      setStatusChange(null);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update status");
    } finally {
      setStatusLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">Manage outlet products, categories, suppliers and stock.</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant="outline" className="max-w-full whitespace-normal text-left">Outlet: {storeName}</Badge>
          {canManageMasters && (
            <>
              <Button variant="outline" onClick={() => setCategoryEditor(null)}>
                <Plus className="h-4 w-4" /> Category
              </Button>
              <Button variant="outline" onClick={() => setSupplierEditor(null)}>
                <Plus className="h-4 w-4" /> Supplier
              </Button>
              <Button onClick={() => setIngredientEditor(null)}>
                <Plus className="h-4 w-4" /> Product
              </Button>
            </>
          )}
        </div>
      </div>

      {!hasOutlet && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100">
          Ask an administrator to assign your account to an outlet before viewing or changing its inventory.
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Active products</div>
          <div className="mt-1 text-2xl font-bold">{ingredients.filter((item: any) => item.isActive !== false).length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Daily-count products</div>
          <div className="mt-1 text-2xl font-bold">{ingredients.filter((item: any) => item.isActive !== false && item.dailyStockTracking).length}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Low stock</div>
          <div className={cn("mt-1 text-2xl font-bold", lowStockCount > 0 && "text-destructive")}>{hasOutlet ? lowStockCount : "—"}</div>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Estimated stock value</div>
          <div className="mt-1 break-words text-2xl font-bold">{hasOutlet ? formatMoney(stockValue) : "—"}</div>
        </div>
      </div>

      <Tabs defaultValue="ingredients">
        <TabsList className="grid h-auto w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="ingredients" className="px-2 text-xs sm:px-3 sm:text-sm">Products</TabsTrigger>
          <TabsTrigger value="movements" className="px-2 text-xs sm:px-3 sm:text-sm">Movements</TabsTrigger>
          <TabsTrigger value="categories" className="px-2 text-xs sm:px-3 sm:text-sm">Categories</TabsTrigger>
          <TabsTrigger value="suppliers" className="px-2 text-xs sm:px-3 sm:text-sm">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="ingredients" className="mt-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={ingredientQuery} onChange={(event) => setIngredientQuery(event.target.value)} className="pl-9" placeholder="Search products, categories or suppliers" />
            </div>
            <Select value={ingredientCategory} onValueChange={setIngredientCategory}>
              <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="All categories" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.filter((category: any) => category.isActive).map((category: any) => (
                  <SelectItem key={category.id} value={category.id}>{category.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {canManageMasters && (
              <Select value={ingredientStatus} onValueChange={(value) => setIngredientStatus(value as StatusFilter)}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="ALL">All statuses</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleIngredients.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                {ingredients.length === 0 ? "No inventory products have been added yet." : "No products match these filters."}
              </div>
            )}
            {visibleIngredients.map((i: any) => {
              const low = Number(i.stockQty) <= Number(i.reorderLevel);
              return (
                <div key={i.id} className={cn("rounded-xl border bg-card p-4", i.isActive === false && "opacity-70")}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Package className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <div className="break-words font-semibold">{i.name}</div>
                        <div className="mt-1 flex flex-wrap gap-1">
                          <Badge variant="outline">{i.category?.name ?? "Uncategorized"}</Badge>
                          {i.dailyStockTracking && (
                            <Badge variant="secondary"><CalendarCheck2 className="h-3 w-3" /> Daily count</Badge>
                          )}
                        </div>
                        <div className="mt-1 break-words text-xs text-muted-foreground">{i.supplier?.name ?? "No supplier"}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      {i.isActive === false && <Badge variant="secondary">Inactive</Badge>}
                      {hasOutlet && i.isActive !== false && low && <Badge variant="destructive"><AlertTriangle className="h-3 w-3" /> Low</Badge>}
                    </div>
                  </div>
                  {i.description && <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{i.description}</p>}
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      {hasOutlet ? (
                        <>
                          <div className="break-words text-xl font-bold">{formatQuantity(i.stockQty)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span></div>
                          <div className="text-xs text-muted-foreground">Reorder at {formatQuantity(i.reorderLevel)} {i.unit}</div>
                          <div className="text-xs text-muted-foreground">Last/reference cost: {i.costPerUnit == null ? "Not set" : `${formatMoney(Number(i.costPerUnit))}/${i.unit}`}</div>
                          <div className="text-xs text-muted-foreground">FIFO value: {formatMoney(Number(i.stockValue || 0))}</div>
                        </>
                      ) : (
                        <div className="text-sm text-muted-foreground">Base unit: {i.unit}</div>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    {canManageStock && i.isActive !== false && (
                      <>
                        <Button size="sm" onClick={() => setAdjust(i)}>Adjust</Button>
                        <Button size="sm" variant="outline" onClick={() => setOutletEditor(i)}><Settings2 className="h-3.5 w-3.5" /> Outlet settings</Button>
                      </>
                    )}
                    {canManageMasters && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => setIngredientEditor(i)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                        <Button size="sm" variant="ghost" className={i.isActive ? "text-destructive" : "text-emerald-700"} onClick={() => setStatusChange({ kind: "ingredient", item: i })}>
                          {i.isActive ? "Deactivate" : "Reactivate"}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <div className="rounded-xl border bg-card">
            <div className="divide-y">
              {movements.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">{hasOutlet ? "No movements yet." : "Assign an outlet to view stock movements."}</div>}
              {movements.map((m: any) => {
                const delta = movementDelta(m);
                const incoming = delta >= 0;
                return (
                  <div key={m.id} className="grid gap-2 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <div className="flex min-w-0 items-start gap-2">
                      {incoming
                        ? <ArrowDownRight className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        : <ArrowUpRight className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />}
                      <div className="min-w-0">
                        <div className="font-medium">{m.ingredient?.name}</div>
                        {m.note && <div className="truncate text-xs text-muted-foreground">{m.note}</div>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <Badge variant={incoming ? "success" : "destructive"}>{movementLabel(m.type, delta)}</Badge>
                      <span className={cn("font-bold tabular-nums", incoming ? "text-emerald-700" : "text-red-700")}>
                        {incoming ? "+" : "−"}{formatQuantity(Math.abs(delta))} {m.ingredient?.unit}
                      </span>
                      <span className="w-full text-xs text-muted-foreground sm:w-auto">{formatDateTime(m.createdAt)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="categories" className="mt-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} className="pl-9" placeholder="Search categories" />
            </div>
            {canManageMasters && (
              <Select value={categoryStatus} onValueChange={(value) => setCategoryStatus(value as StatusFilter)}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="ALL">All statuses</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCategories.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                {categories.length === 0 ? "No categories have been added yet." : "No categories match these filters."}
              </div>
            )}
            {visibleCategories.map((category: any) => (
              <div key={category.id} className={cn("rounded-xl border bg-card p-4", !category.isActive && "opacity-70")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-2">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Tags className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="break-words font-semibold">{category.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {category._count?.items ?? 0} product{Number(category._count?.items ?? 0) === 1 ? "" : "s"}
                      </div>
                    </div>
                  </div>
                  {!category.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                {category.description && <p className="mt-3 line-clamp-2 text-xs text-muted-foreground">{category.description}</p>}
                {canManageMasters && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" variant="outline" onClick={() => setCategoryEditor(category)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className={category.isActive ? "text-destructive" : "text-emerald-700"}
                      onClick={() => setStatusChange({ kind: "category", item: category })}
                    >
                      {category.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <div className="mb-3 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={supplierQuery} onChange={(event) => setSupplierQuery(event.target.value)} className="pl-9" placeholder="Search suppliers or contacts" />
            </div>
            {canManageMasters && (
              <Select value={supplierStatus} onValueChange={(value) => setSupplierStatus(value as StatusFilter)}>
                <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="INACTIVE">Inactive</SelectItem>
                  <SelectItem value="ALL">All statuses</SelectItem>
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleSuppliers.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                {suppliers.length === 0 ? "No suppliers have been added yet." : "No suppliers match these filters."}
              </div>
            )}
            {visibleSuppliers.map((s: any) => (
              <div key={s.id} className={cn("rounded-xl border bg-card p-4", !s.isActive && "opacity-70")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="break-words font-semibold">{s.name}</div>
                  {!s.isActive && <Badge variant="secondary">Inactive</Badge>}
                </div>
                {s.contact && <div className="mt-1 break-words text-xs text-muted-foreground">Contact: {s.contact}</div>}
                {(s.phone || s.email) && (
                  <div className="break-words text-xs text-muted-foreground">{[s.phone, s.email].filter(Boolean).join(" · ")}</div>
                )}
                {s.address && <div className="mt-2 line-clamp-2 break-words text-xs text-muted-foreground">{s.address}</div>}
                {canManageMasters && (
                  <div className="mt-4 flex flex-wrap gap-2 border-t pt-3">
                    <Button size="sm" variant="outline" onClick={() => setSupplierEditor(s)}><Pencil className="h-3.5 w-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" className={s.isActive ? "text-destructive" : "text-emerald-700"} onClick={() => setStatusChange({ kind: "supplier", item: s })}>
                      {s.isActive ? "Deactivate" : "Reactivate"}
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AdjustDialog key={adjust?.id ?? "closed"} ingredient={adjust} suppliers={suppliers} onClose={() => setAdjust(null)} onSaved={() => saved(() => setAdjust(null))} isManager={canManageStock} />
      {outletEditor && (
        <OutletInventoryDialog key={outletEditor.id} ingredient={outletEditor} suppliers={suppliers} onClose={() => setOutletEditor(null)} onSaved={() => saved(() => setOutletEditor(null))} />
      )}
      {ingredientEditor !== undefined && (
        <IngredientMasterDialog key={ingredientEditor?.id ?? "new"} ingredient={ingredientEditor} categories={categories} suppliers={suppliers} onClose={() => setIngredientEditor(undefined)} onSaved={() => saved(() => setIngredientEditor(undefined))} />
      )}
      {categoryEditor !== undefined && (
        <CategoryMasterDialog key={categoryEditor?.id ?? "new"} category={categoryEditor} onClose={() => setCategoryEditor(undefined)} onSaved={() => saved(() => setCategoryEditor(undefined))} />
      )}
      {supplierEditor !== undefined && (
        <SupplierMasterDialog key={supplierEditor?.id ?? "new"} supplier={supplierEditor} onClose={() => setSupplierEditor(undefined)} onSaved={() => saved(() => setSupplierEditor(undefined))} />
      )}
      {statusChange && (
        <Dialog open onOpenChange={(open) => !open && !statusLoading && setStatusChange(null)}>
          <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{statusChange.item.isActive ? "Deactivate" : "Reactivate"} {statusChange.kind}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {statusChange.item.isActive
                ? statusChange.kind === "ingredient"
                  ? `${statusChange.item.name} will be hidden from new inventory selections. Its balance must already be zero; configuration and history will be preserved.`
                  : statusChange.kind === "category"
                    ? `${statusChange.item.name} can be deactivated only when it has no active products.`
                    : `${statusChange.item.name} will be hidden from new supplier selections. Existing links and history will be preserved.`
                : `${statusChange.item.name} will become available for inventory use again.`}
            </p>
            <DialogFooter>
              <Button variant="outline" onClick={() => setStatusChange(null)} disabled={statusLoading}>Cancel</Button>
              <Button variant={statusChange.item.isActive ? "destructive" : "default"} onClick={applyStatusChange} disabled={statusLoading}>
                {statusLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {statusChange.item.isActive ? "Deactivate" : "Reactivate"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function AdjustDialog({ ingredient, suppliers, onClose, onSaved, isManager }: any) {
  const [action, setAction] = useState<StockAction>("RECEIVE");
  const [qty, setQty] = useState("");
  const [unitCost, setUnitCost] = useState(
    ingredient?.costPerUnit == null ? "" : String(ingredient.costPerUnit)
  );
  const [supplierId, setSupplierId] = useState(
    ingredient?.supplier?.isActive ? ingredient.supplier.id : "none"
  );
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);
  const requestRef = useRef<{ fingerprint: string; idempotencyKey: string } | null>(null);

  const rawQuantity = Number(qty);
  const quantityMilliunits = Math.round(rawQuantity * QUANTITY_PRECISION);
  const quantity = quantityMilliunits / QUANTITY_PRECISION;
  const quantityError = !qty.trim()
    ? null
    : !Number.isFinite(rawQuantity) || rawQuantity < 0.001
      ? "Enter at least 0.001"
      : rawQuantity > MAX_STOCK_QUANTITY
        ? "Quantity is too large"
        : Math.abs(rawQuantity - quantity) > 1e-9
          ? "Use at most 3 decimal places"
          : null;
  const validQuantity = Boolean(qty.trim()) && !quantityError;
  const currentQuantity = Number(ingredient?.stockQty) || 0;
  const currentMilliunits = Math.round(currentQuantity * QUANTITY_PRECISION);
  const resultingMilliunits = action === "RECEIVE"
    ? currentMilliunits + (validQuantity ? quantityMilliunits : 0)
    : currentMilliunits - (validQuantity ? quantityMilliunits : 0);
  const resultingQuantity = resultingMilliunits / QUANTITY_PRECISION;
  const insufficientStock = action === "ISSUE" && validQuantity && resultingMilliunits < 0;
  const exceedsStockLimit = action === "RECEIVE" && validQuantity && resultingMilliunits > MAX_STOCK_MILLIUNITS;
  const rawUnitCost = Number(unitCost);
  const validUnitCost = Boolean(unitCost.trim())
    && Number.isFinite(rawUnitCost)
    && rawUnitCost > 0
    && rawUnitCost <= 99_999_999.99
    && Math.abs(rawUnitCost * 100 - Math.round(rawUnitCost * 100)) < 1e-7;

  async function save() {
    if (!qty.trim() || !Number.isFinite(rawQuantity) || rawQuantity < 0.001) {
      return toast.error("Enter a quantity of at least 0.001");
    }
    if (rawQuantity > MAX_STOCK_QUANTITY) return toast.error("Quantity is too large");
    if (Math.abs(rawQuantity - quantity) > 1e-9) {
      return toast.error("Use at most 3 decimal places");
    }
    if (insufficientStock) return toast.error("You cannot issue more than the available stock");
    if (exceedsStockLimit) return toast.error("The resulting stock quantity is too large");
    if (action === "RECEIVE" && !validUnitCost) {
      return toast.error("Enter a unit cost greater than zero with at most 2 decimal places");
    }
    if (action === "ISSUE" && !note.trim()) return toast.error("Enter a reason for issuing stock");

    setLoading(true);
    try {
      const requestFingerprint = JSON.stringify([
        ingredient.id,
        action,
        quantity,
        action === "RECEIVE" ? rawUnitCost : null,
        action === "RECEIVE" ? supplierId : null,
        note.trim(),
      ]);
      if (!requestRef.current || requestRef.current.fingerprint !== requestFingerprint) {
        requestRef.current = {
          fingerprint: requestFingerprint,
          idempotencyKey: globalThis.crypto.randomUUID(),
        };
      }
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ingredientId: ingredient.ingredientId,
          action,
          quantity,
          ...(action === "RECEIVE"
            ? {
                unitCost: rawUnitCost,
                supplierId: supplierId === "none" ? null : supplierId,
              }
            : {}),
          note: note.trim() || undefined,
          idempotencyKey: requestRef.current.idempotencyKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      requestRef.current = null;
      toast.success(action === "RECEIVE" ? "Stock received" : "Stock issued");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  if (!ingredient) return null;
  if (!isManager) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && !loading && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Adjust stock — {ingredient.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            {(["RECEIVE", "ISSUE"] as const).map((option) => (
              <button type="button" key={option} aria-pressed={action === option} disabled={loading} onClick={() => setAction(option)}
                className={cn("min-h-11 flex-1 rounded-lg border px-3 py-2 text-sm font-medium", action === option ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/15" : "text-muted-foreground")}>
                {option === "RECEIVE" ? "Receive (+)" : "Issue (−)"}
              </button>
            ))}
          </div>
          <div className="rounded-lg bg-muted/60 p-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Current stock</span><strong>{formatQuantity(currentQuantity)} {ingredient.unit}</strong></div>
            {validQuantity && (
              <div className={cn("mt-1 flex justify-between", (insufficientStock || exceedsStockLimit) && "text-destructive")}>
                <span>After this change</span><strong>{formatQuantity(resultingQuantity)} {ingredient.unit}</strong>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <Label>Quantity ({ingredient.unit})</Label>
            <Input
              type="number"
              inputMode="decimal"
              min="0.001"
              step="0.001"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              disabled={loading}
              placeholder="0"
              aria-invalid={Boolean(quantityError || insufficientStock || exceedsStockLimit)}
            />
            {quantityError && <p className="text-xs text-destructive">{quantityError}</p>}
            {!quantityError && insufficientStock && (
              <p className="text-xs text-destructive">Only {formatQuantity(currentQuantity)} {ingredient.unit} is available.</p>
            )}
            {!quantityError && exceedsStockLimit && (
              <p className="text-xs text-destructive">The resulting stock quantity is too large.</p>
            )}
          </div>
          {action === "RECEIVE" && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Unit cost (₹/{ingredient.unit})</Label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  step="0.01"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  disabled={loading}
                  placeholder="Required"
                  aria-invalid={Boolean(unitCost.trim()) && !validUnitCost}
                />
              </div>
              <div className="space-y-1">
                <Label>Supplier</Label>
                <Select value={supplierId} onValueChange={setSupplierId} disabled={loading}>
                  <SelectTrigger><SelectValue placeholder="No supplier" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No supplier</SelectItem>
                    {suppliers.filter((supplier: any) => supplier.isActive).map((supplier: any) => (
                      <SelectItem key={supplier.id} value={supplier.id}>{supplier.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <div className="space-y-1">
            <Label>Reason {action === "ISSUE" ? "(required)" : "(optional)"}</Label>
            <Input maxLength={191} value={note} onChange={(e) => setNote(e.target.value)} disabled={loading} placeholder={action === "RECEIVE" ? "e.g. Supplier delivery" : "e.g. Kitchen issue or correction"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading || !validQuantity || insufficientStock || exceedsStockLimit || (action === "RECEIVE" && !validUnitCost) || (action === "ISSUE" && !note.trim())}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {action === "RECEIVE" ? "Receive stock" : "Issue stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
