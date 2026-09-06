"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus, Loader2, PackagePlus } from "lucide-react";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import toast from "react-hot-toast";

const REASON_LABEL: Record<string, string> = {
  DEFECTIVE_FOOD: "Defective food",
  NOT_STARTED: "Never started",
  SPILLAGE: "Spillage",
  EXPIRED: "Expired",
  OTHER: "Other",
};

const REASON_COLOR: Record<string, string> = {
  DEFECTIVE_FOOD: "bg-red-500",
  NOT_STARTED: "bg-slate-500",
  SPILLAGE: "bg-amber-500",
  EXPIRED: "bg-violet-500",
  OTHER: "bg-slate-400",
};

function isManager(role: string) {
  return ["SUPER_ADMIN", "ADMIN", "MANAGER"].includes(role);
}

export function WasteList({ records, ingredients, userRole, todayTotal, todayCount }: any) {
  const router = useRouter();
  const manager = isManager(userRole);

  const [manualOpen, setManualOpen] = useState(false);
  const [ingredientOpen, setIngredientOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("SPILLAGE");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<any[]>([{ name: "", unitCost: "", quantity: "1" }]);
  const [ingRows, setIngRows] = useState<any[]>([{ ingredientId: "", quantity: "1" }]);
  const [saving, setSaving] = useState(false);

  const itemCount = records.reduce((s: number, r: any) => s + r.items.reduce((x: number, i: any) => x + i.quantity, 0), 0);
  const movementQty = records.reduce(
    (s: number, r: any) => s + r.movements.reduce((x: number, m: any) => x + Number(m.quantity), 0),
    0
  );

  async function submitManual() {
    const items = rows
      .filter((r) => r.name.trim())
      .map((r) => ({ name: r.name, unitCost: Number(r.unitCost) || 0, quantity: Math.max(1, Math.floor(Number(r.quantity)) || 1) }));
    const ings = ingRows
      .filter((r) => r.ingredientId)
      .map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity) || 0 }));
    if (items.length === 0 && ings.length === 0) return toast.error("Add at least one item or ingredient");
    setSaving(true);
    try {
      const res = await fetch("/api/waste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason, note: note || undefined, items, ingredients: ings }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to record waste");
      toast.success("Waste recorded");
      setManualOpen(false);
      setRows([{ name: "", unitCost: "", quantity: "1" }]);
      setIngRows([{ ingredientId: "", quantity: "1" }]);
      setNote("");
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function submitIngredients(recordId: string) {
    const rowsToSend = ingRows.filter((r) => r.ingredientId && (Number(r.quantity) || 0) > 0);
    if (rowsToSend.length === 0) return toast.error("Pick at least one ingredient with a quantity");
    setSaving(true);
    try {
      for (const row of rowsToSend) {
        const res = await fetch(`/api/waste/${recordId}/ingredients`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ingredientId: row.ingredientId, quantity: Number(row.quantity) }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to deduct ingredient");
      }
      toast.success("Ingredients deducted from stock");
      setIngredientOpen(null);
      setIngRows([{ ingredientId: "", quantity: "1" }]);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  const IngredientPicker = ({ rows, onChange }: any) => (
    <div className="space-y-2">
      {rows.map((r: any, idx: number) => (
        <div key={idx} className="flex items-center gap-2">
          <Select
            value={r.ingredientId}
            onValueChange={(v) => {
              const next = rows.map((x: any, i: number) => (i === idx ? { ...x, ingredientId: v } : x));
              onChange(next);
            }}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Ingredient" />
            </SelectTrigger>
            <SelectContent>
              {ingredients.map((ing: any) => (
                <SelectItem key={ing.id} value={ing.id}>
                  {ing.name} ({Number(ing.stockQty)} {ing.unit})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            min={0}
            step="any"
            className="w-24"
            value={r.quantity}
            onChange={(e) => {
              const next = rows.map((x: any, i: number) => (i === idx ? { ...x, quantity: e.target.value } : x));
              onChange(next);
            }}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onChange(rows.filter((_: any, i: number) => i !== idx))}
            aria-label="Remove ingredient"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        onClick={() => onChange([...rows, { ingredientId: "", quantity: "1" }])}
      >
        <Plus className="h-4 w-4" /> Add ingredient
      </Button>
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Waste &amp; Trash</h1>
          <p className="text-sm text-muted-foreground">
            Inventory used with no revenue — defective returns, unstarted cancels, spillage, expiry.
          </p>
        </div>
        {manager && (
          <Button onClick={() => setManualOpen(true)}>
            <Plus className="h-4 w-4" /> Record waste
          </Button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Today's waste value</div>
          <div className="mt-1 text-2xl font-bold">{formatCurrency(Number(todayTotal))}</div>
          <div className="text-xs text-muted-foreground">{todayCount} record{todayCount === 1 ? "" : "s"}</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Total waste value</div>
          <div className="mt-1 text-2xl font-bold">{formatCurrency(records.reduce((s: number, r: any) => s + Number(r.totalCost), 0))}</div>
          <div className="text-xs text-muted-foreground">{itemCount} wasted item lines</div>
        </div>
        <div className="rounded-xl border p-4">
          <div className="text-sm text-muted-foreground">Ingredients written off</div>
          <div className="mt-1 text-2xl font-bold">{Number(movementQty.toFixed(3))}</div>
          <div className="text-xs text-muted-foreground">units across {records.length} record{records.length === 1 ? "" : "s"}</div>
        </div>
      </div>

      <div className="space-y-3">
        {records.length === 0 && (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            No waste recorded yet. Defective-food cancellations from Table Service show up here automatically.
          </div>
        )}
        {records.map((r: any) => (
          <div key={r.id} className="rounded-xl border p-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={cn("capitalize", REASON_COLOR[r.reason] ?? "bg-slate-400")}>
                {REASON_LABEL[r.reason] ?? r.reason.toLowerCase().replace(/_/g, " ")}
              </Badge>
              <Badge variant="outline">{r.source === "ORDER_CANCEL" ? "Order cancelled" : "Manual"}</Badge>
              <span className="text-xs text-muted-foreground">
                {formatDateTime(r.recordedAt)}
                {r.recordedBy?.name ? ` · by ${r.recordedBy.name}` : ""}
              </span>
              {r.order?.orderNumber && (
                <span className="text-xs font-semibold text-muted-foreground">#{r.order.orderNumber}</span>
              )}
              {r.tableName && <span className="text-xs text-muted-foreground">· {r.tableName}</span>}
              <span className="ml-auto text-sm font-bold">{formatCurrency(Number(r.totalCost))}</span>
            </div>

            {r.note && <p className="mt-2 text-sm italic text-muted-foreground">{r.note}</p>}

            {r.items.length > 0 && (
              <div className="mt-3 space-y-1">
                {r.items.map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between rounded-md bg-muted/40 px-2 py-1 text-sm">
                    <span>
                      {i.name} ×{i.quantity}
                    </span>
                    <span className="text-xs text-muted-foreground">{formatCurrency(Number(i.lineCost))}</span>
                  </div>
                ))}
              </div>
            )}

            {r.movements.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-muted-foreground">Stock written off:</span>
                {r.movements.map((m: any) => (
                  <span key={m.id} className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] text-destructive">
                    {m.ingredient.name} −{Number(m.quantity)}
                    {m.ingredient.unit}
                  </span>
                ))}
              </div>
            )}

            {manager && (
              <div className="mt-3 flex justify-end">
                <Button variant="outline" size="sm" onClick={() => { setIngredientOpen(r.id); setIngRows([{ ingredientId: "", quantity: "1" }]); }}>
                  <PackagePlus className="h-4 w-4" /> Add ingredients
                </Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <Dialog open={manualOpen} onOpenChange={(o) => !o && setManualOpen(false)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Record waste</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="DEFECTIVE_FOOD">Defective food</SelectItem>
                  <SelectItem value="NOT_STARTED">Never started</SelectItem>
                  <SelectItem value="SPILLAGE">Spillage</SelectItem>
                  <SelectItem value="EXPIRED">Expired</SelectItem>
                  <SelectItem value="OTHER">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Wasted items (lost value)</Label>
              {rows.map((r: any, idx: number) => (
                <div key={idx} className="flex items-center gap-2">
                  <Input
                    placeholder="Item name"
                    value={r.name}
                    onChange={(e) => setRows(rows.map((x: any, i: number) => (i === idx ? { ...x, name: e.target.value } : x)))}
                  />
                  <Input
                    type="number"
                    min={0}
                    step="any"
                    placeholder="Cost ₹"
                    className="w-24"
                    value={r.unitCost}
                    onChange={(e) => setRows(rows.map((x: any, i: number) => (i === idx ? { ...x, unitCost: e.target.value } : x)))}
                  />
                  <Input
                    type="number"
                    min={1}
                    className="w-16"
                    value={r.quantity}
                    onChange={(e) => setRows(rows.map((x: any, i: number) => (i === idx ? { ...x, quantity: e.target.value } : x)))}
                  />
                  <Button variant="ghost" size="sm" onClick={() => setRows(rows.filter((_: any, i: number) => i !== idx))} aria-label="Remove item">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", unitCost: "", quantity: "1" }])}>
                <Plus className="h-4 w-4" /> Add item
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>Ingredients to write off from stock</Label>
              <IngredientPicker rows={ingRows} onChange={setIngRows} />
            </div>
            <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button className="w-full" disabled={saving} onClick={submitManual}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Save waste record
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!ingredientOpen} onOpenChange={(o) => !o && setIngredientOpen(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Write off ingredients from stock</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <IngredientPicker rows={ingRows} onChange={setIngRows} />
            <Button className="w-full" disabled={saving} onClick={() => ingredientOpen && submitIngredients(ingredientOpen)}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackagePlus className="h-4 w-4" />}
              Deduct from stock
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}