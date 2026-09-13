"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Package, ArrowDownRight, ArrowUpRight, AlertTriangle, Loader2 } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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

export function InventoryManager({ ingredients, suppliers, movements, isManager, storeName }: any) {
  const router = useRouter();
  const [adjust, setAdjust] = useState<null | any>(null);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-muted-foreground">Track raw materials, stock levels and reorder points.</p>
        </div>
        <Badge variant="outline" className="max-w-full whitespace-normal text-left">
          Outlet: {storeName}
        </Badge>
      </div>

      <Tabs defaultValue="ingredients">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="ingredients" className="px-2 text-xs sm:px-3 sm:text-sm">Ingredients</TabsTrigger>
          <TabsTrigger value="movements" className="px-2 text-xs sm:px-3 sm:text-sm">Movements</TabsTrigger>
          <TabsTrigger value="suppliers" className="px-2 text-xs sm:px-3 sm:text-sm">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="ingredients" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ingredients.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                No ingredients have been added yet.
              </div>
            )}
            {ingredients.map((i: any) => {
              const low = Number(i.stockQty) <= Number(i.reorderLevel);
              return (
                <div key={i.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-start gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Package className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <div className="break-words font-semibold">{i.name}</div>
                        <div className="break-words text-xs text-muted-foreground">{i.supplier?.name ?? "No supplier"}</div>
                      </div>
                    </div>
                    {i.isStockConfigured === false
                      ? <Badge variant="outline" className="shrink-0">Not configured</Badge>
                      : low && <Badge variant="destructive" className="shrink-0"><AlertTriangle className="h-3 w-3" /> Low</Badge>}
                  </div>
                  <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-0">
                      <div className="break-words text-xl font-bold">{formatQuantity(i.stockQty)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span></div>
                      <div className="text-xs text-muted-foreground">Reorder at {formatQuantity(i.reorderLevel)} {i.unit}</div>
                    </div>
                    {isManager && <Button className="shrink-0" size="sm" variant="outline" onClick={() => setAdjust(i)}>Adjust</Button>}
                  </div>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="movements" className="mt-4">
          <div className="rounded-xl border bg-card">
            <div className="divide-y">
              {movements.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No movements yet.</div>}
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

        <TabsContent value="suppliers" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.length === 0 && (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground sm:col-span-2 lg:col-span-3">
                No suppliers have been added yet.
              </div>
            )}
            {suppliers.map((s: any) => (
              <div key={s.id} className="rounded-xl border bg-card p-4">
                <div className="break-words font-semibold">{s.name}</div>
                {(s.phone || s.email) && (
                  <div className="break-words text-xs text-muted-foreground">{[s.phone, s.email].filter(Boolean).join(" · ")}</div>
                )}
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AdjustDialog key={adjust?.id ?? "closed"} ingredient={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); refresh(); }} isManager={isManager} />
    </div>
  );
}

function AdjustDialog({ ingredient, onClose, onSaved, isManager }: any) {
  const [action, setAction] = useState<StockAction>("RECEIVE");
  const [qty, setQty] = useState("");
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
    if (action === "ISSUE" && !note.trim()) return toast.error("Enter a reason for issuing stock");

    setLoading(true);
    try {
      const requestFingerprint = JSON.stringify([ingredient.id, action, quantity, note.trim()]);
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
          ingredientId: ingredient.id,
          action,
          quantity,
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
      <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-sm">
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
          <div className="space-y-1">
            <Label>Reason {action === "ISSUE" ? "(required)" : "(optional)"}</Label>
            <Input maxLength={191} value={note} onChange={(e) => setNote(e.target.value)} disabled={loading} placeholder={action === "RECEIVE" ? "e.g. Supplier delivery" : "e.g. Kitchen issue or correction"} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button onClick={save} disabled={loading || !validQuantity || insufficientStock || exceedsStockLimit || (action === "ISSUE" && !note.trim())}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {action === "RECEIVE" ? "Receive stock" : "Issue stock"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
