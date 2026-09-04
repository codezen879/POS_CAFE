"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Package, ArrowDownRight, ArrowUpRight, AlertTriangle } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

export function InventoryManager({ ingredients, suppliers, movements, isManager }: any) {
  const router = useRouter();
  const [adjust, setAdjust] = useState<null | any>(null);
  const refresh = () => router.refresh();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Inventory</h1>
      <p className="text-sm text-muted-foreground">Track raw materials, stock levels and reorder points.</p>

      <Tabs defaultValue="ingredients">
        <TabsList>
          <TabsTrigger value="ingredients">Ingredients</TabsTrigger>
          <TabsTrigger value="movements">Stock movements</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>

        <TabsContent value="ingredients" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {ingredients.map((i: any) => {
              const low = Number(i.stockQty) <= Number(i.reorderLevel);
              return (
                <div key={i.id} className="rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Package className="h-4 w-4" /></div>
                      <div>
                        <div className="font-semibold">{i.name}</div>
                        <div className="text-xs text-muted-foreground">{i.supplier?.name ?? "No supplier"}</div>
                      </div>
                    </div>
                    {low && <Badge variant="destructive"><AlertTriangle className="h-3 w-3" /> Low</Badge>}
                  </div>
                  <div className="mt-3 flex items-end justify-between">
                    <div>
                      <div className="text-xl font-bold">{Number(i.stockQty)} <span className="text-xs font-normal text-muted-foreground">{i.unit}</span></div>
                      <div className="text-xs text-muted-foreground">Reorder at {Number(i.reorderLevel)} {i.unit}</div>
                    </div>
                    {isManager && <Button size="sm" variant="outline" onClick={() => setAdjust(i)}>Adjust</Button>}
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
              {movements.map((m: any) => (
                <div key={m.id} className="flex items-center justify-between p-3 text-sm">
                  <div className="flex items-center gap-2">
                    {m.type === "IN" ? <ArrowDownRight className="h-4 w-4 text-emerald-600" /> : <ArrowUpRight className="h-4 w-4 text-red-600" />}
                    <span className="font-medium">{m.ingredient?.name}</span>
                    <span className="text-muted-foreground">{m.note}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={m.type === "IN" ? "success" : "destructive"}>{m.type}</Badge>
                    <span className="font-bold">{m.quantity}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(m.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="suppliers" className="mt-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {suppliers.map((s: any) => (
              <div key={s.id} className="rounded-xl border bg-card p-4">
                <div className="font-semibold">{s.name}</div>
                <div className="text-xs text-muted-foreground">{s.phone} · {s.email}</div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <AdjustDialog ingredient={adjust} onClose={() => setAdjust(null)} onSaved={() => { setAdjust(null); refresh(); }} isManager={isManager} />
    </div>
  );
}

function AdjustDialog({ ingredient, onClose, onSaved, isManager }: any) {
  const [type, setType] = useState<"IN" | "OUT">("IN");
  const [qty, setQty] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(false);

  async function save() {
    setLoading(true);
    try {
      const quantity = Number(qty);
      if (!quantity) { toast.error("Enter a quantity"); return; }
      const res = await fetch("/api/stock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ingredientId: ingredient.id, type, quantity: type === "OUT" ? -Math.abs(quantity) : Math.abs(quantity), note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Stock updated");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  if (!ingredient) return null;
  if (!isManager) return null;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Adjust stock — {ingredient.name}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="flex gap-2">
            {(["IN", "OUT"] as const).map((t) => (
              <button key={t} onClick={() => setType(t)}
                className={cn("flex-1 rounded-lg border px-3 py-2 text-sm font-medium", type === t ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}>
                {t === "IN" ? "Receive (+)" : "Issue (–)"}
              </button>
            ))}
          </div>
          <div className="space-y-1"><Label>Quantity ({ingredient.unit})</Label><Input type="number" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div className="space-y-1"><Label>Note</Label><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. purchase order #12" /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}