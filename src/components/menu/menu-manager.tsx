"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { cn, formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

export function MenuManager({ categories, taxRates, addons, isManager }: any) {
  const router = useRouter();
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [productDialog, setProductDialog] = useState<null | "new" | { id: string; data: any }>(null);

  const refresh = () => router.refresh();
  const activeProducts = categories.find((c: any) => c.id === activeCat)?.products ?? [];

  if (!isManager) {
    return <div className="text-sm text-muted-foreground">You don't have permission to manage the menu.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Digital Menu</h1>
          <p className="text-sm text-muted-foreground">Manage categories, products, prices and GST.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddCatOpen(true)}>
            <Plus className="h-4 w-4" /> Category
          </Button>
          <Button onClick={() => setProductDialog("new")}>
            <Plus className="h-4 w-4" /> Product
          </Button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto border-b pb-2 scrollbar-thin">
        {categories.map((c: any) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium",
              activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
            )}
          >
            {c.icon} {c.name} <span className="opacity-60">({c.products.length})</span>
          </button>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {activeProducts.map((p: any) => (
          <div key={p.id} className="rounded-xl border p-4">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <span className={cn("mt-0.5 h-3 w-3 rounded-sm border", p.isVeg ? "border-green-600" : "border-red-600")} />
                <div>
                  <div className="font-semibold leading-tight">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">{p.code}</div>
                </div>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon" onClick={() => setProductDialog({ id: p.id, data: p })}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  onClick={async () => {
                    if (!confirm(`Delete ${p.name}?`)) return;
                    const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
                    if (res.ok) { toast.success("Deleted"); refresh(); } else toast.error("Failed");
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <span className="font-bold">{formatCurrency(p.basePrice)}</span>
              {p.taxRate && <Badge variant="outline">{p.taxRate.name}</Badge>}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {p.isBestseller && <Badge variant="warning">Bestseller</Badge>}
              {!p.isAvailable && <Badge variant="destructive">Unavailable</Badge>}
              {p.isVeg ? <Badge variant="success">Veg</Badge> : <Badge variant="destructive">Non-veg</Badge>}
            </div>
            {p.prepTimeMins && <div className="mt-2 text-[11px] text-muted-foreground">~{p.prepTimeMins} min prep</div>}
          </div>
        ))}
      </div>

      <AddCategoryDialog open={addCatOpen} onOpenChange={setAddCatOpen} onSaved={refresh} />
      {productDialog && (
        <ProductDialog
          mode={productDialog === "new" ? "new" : "edit"}
          product={productDialog === "new" ? null : (productDialog as any).data}
          categories={categories}
          taxRates={taxRates}
          allAddons={addons}
          onClose={() => setProductDialog(null)}
          onSaved={() => { setProductDialog(null); refresh(); }}
        />
      )}
    </div>
  );
}

function AddCategoryDialog({ open, onOpenChange, onSaved }: any) {
  const [name, setName] = useState("");
  const [icon, setIcon] = useState("");
  const [loading, setLoading] = useState(false);
  async function save() {
    setLoading(true);
    try {
      const res = await fetch("/api/menu/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Category added");
      setName(""); setIcon("");
      onSaved();
      onOpenChange(false);
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle>Add category</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coffee" />
          </div>
          <div className="space-y-1">
            <Label>Icon (emoji)</Label>
            <Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="☕" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={loading || !name}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProductDialog({ mode, product, categories, taxRates, allAddons, onClose, onSaved }: any) {
  const [name, setName] = useState(product?.name ?? "");
  const [code, setCode] = useState(product?.code ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? categories[0]?.id ?? "");
  const [price, setPrice] = useState(product?.basePrice ?? "");
  const [cost, setCost] = useState(product?.costPrice ?? "");
  const [taxRateId, setTaxRateId] = useState(product?.taxRateId ?? "");
  const [isVeg, setIsVeg] = useState(product?.isVeg ?? true);
  const [isBestseller, setIsBestseller] = useState(product?.isBestseller ?? false);
  const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);
  const [prepTime, setPrepTime] = useState(product?.prepTimeMins ?? "");
  const [maxQty, setMaxQty] = useState(product?.maxOrderQty ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [selectedAddons, setSelectedAddons] = useState<string[]>(product?.addons?.map((a: any) => a.addonId) ?? []);
  const [loading, setLoading] = useState(false);

  function toggleAddon(id: string) {
    setSelectedAddons((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!name || !categoryId || price === "") { toast.error("Name, category and price required"); return; }
    setLoading(true);
    const payload = {
      name, code, categoryId, description, basePrice: Number(price), costPrice: cost ? Number(cost) : null,
      taxRateId: taxRateId || null, isVeg, isBestseller, isAvailable,
      prepTimeMins: prepTime ? Number(prepTime) : null, maxOrderQty: maxQty ? Number(maxQty) : null,
      addonIds: selectedAddons,
    };
    try {
      const url = mode === "edit" ? `/api/products/${product.id}` : "/api/products";
      const method = mode === "edit" ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(mode === "edit" ? "Product updated" : "Product created");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>{mode === "edit" ? "Edit product" : "Add product"}</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Code</Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="101" /></div>
          </div>
          <div className="space-y-1"><Label>Category *</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{categories.map((c: any) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1"><Label>Price *</Label><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
            <div className="space-y-1"><Label>Cost price</Label><Input type="number" value={cost} onChange={(e) => setCost(e.target.value)} /></div>
            <div className="space-y-1"><Label>GST</Label>
              <Select value={taxRateId} onValueChange={setTaxRateId}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>{taxRates.map((t: any) => <SelectItem key={t.id} value={t.id}>{t.name} ({t.rate}%)</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Prep time (min)</Label><Input type="number" value={prepTime} onChange={(e) => setPrepTime(e.target.value)} /></div>
            <div className="space-y-1"><Label>Max order qty</Label><Input type="number" value={maxQty} onChange={(e) => setMaxQty(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle label="Vegetarian" checked={isVeg} onCheckedChange={setIsVeg} />
            <Toggle label="Bestseller" checked={isBestseller} onCheckedChange={setIsBestseller} />
            <Toggle label="Available" checked={isAvailable} onCheckedChange={setIsAvailable} />
          </div>
          <div className="space-y-1">
            <Label>Add-ons</Label>
            <div className="flex flex-wrap gap-2">
              {allAddons.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAddon(a.id)}
                  className={cn("rounded-full border px-3 py-1 text-xs", selectedAddons.includes(a.id) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground")}
                >
                  {a.name} · {formatCurrency(a.price)}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Toggle({ label, checked, onCheckedChange }: any) {
  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <span className="text-sm">{label}</span>
      <Switch checked={!!checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}