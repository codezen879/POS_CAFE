"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Pencil, Trash2, Sparkles, Save, X, Loader2 } from "lucide-react";
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

export function MenuManager({ categories, taxRates, addons, isManager }: any) {
  const router = useRouter();
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const [addCatOpen, setAddCatOpen] = useState(false);
  const [categoryDialog, setCategoryDialog] = useState<any>(null);
  const [productDialog, setProductDialog] = useState<null | "new" | { id: string; data: any }>(null);
  const [addonsOpen, setAddonsOpen] = useState(false);

  const refresh = () => router.refresh();
  const activeProducts = categories.find((c: any) => c.id === activeCat)?.products ?? [];
  const activeCategory = categories.find((c: any) => c.id === activeCat);

  if (!isManager) {
    return <div className="text-sm text-muted-foreground">You don't have permission to manage the menu.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Digital Menu</h1>
          <p className="text-sm text-muted-foreground">Manage categories, products, prices, GST and add-ons.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setAddonsOpen(true)}>
            <Sparkles className="h-4 w-4" /> Add-ons
          </Button>
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
          <div key={c.id} className="group relative">
            <button
              onClick={() => setActiveCat(c.id)}
              className={cn(
                "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium",
                activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
              )}
            >
              {c.icon} {c.name} <span className="opacity-60">({c.products.length})</span>
            </button>
            <button
              onClick={() => setCategoryDialog(c)}
              className="absolute -right-2 -top-2 hidden rounded-full border bg-card p-1 shadow-sm group-hover:block"
              aria-label={`Edit ${c.name}`}
            >
              <Pencil className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {activeProducts.map((p: any) => {
          const inherited = (activeCategory?.addons ?? []).filter((a: any) => a.isActive);
          return (
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
              {(p.addons?.length > 0 || inherited.length > 0) && (
                <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                  {p.addons.map((pa: any) => (
                    <span key={pa.addonId} className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      {pa.addon.name}
                    </span>
                  ))}
                  {inherited
                    .filter((ad: any) => !p.addons.some((pa: any) => pa.addonId === ad.id))
                    .map((ad: any) => (
                      <span key={ad.id} className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground" title="From category">
                        {ad.name} · cat
                      </span>
                    ))}
                </div>
              )}
              {p.prepTimeMins && <div className="mt-2 text-[11px] text-muted-foreground">~{p.prepTimeMins} min prep</div>}
            </div>
          );
        })}
      </div>

      <AddCategoryDialog open={addCatOpen} onOpenChange={setAddCatOpen} onSaved={refresh} />
      {categoryDialog && (
        <CategoryDialog
          category={categoryDialog}
          allAddons={addons}
          onClose={() => setCategoryDialog(null)}
          onSaved={() => { setCategoryDialog(null); refresh(); }}
        />
      )}
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
      {addonsOpen && (
        <AddonsDialog
          allAddons={addons}
          categories={categories}
          onClose={() => setAddonsOpen(false)}
          onSaved={() => { refresh(); }}
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

function CategoryDialog({ category, allAddons, onClose, onSaved }: any) {
  const [name, setName] = useState(category.name);
  const [icon, setIcon] = useState(category.icon ?? "");
  const [isActive, setIsActive] = useState(category.isActive);
  const [selected, setSelected] = useState<string[]>(category.addons?.map((a: any) => a.id) ?? []);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!name.trim()) return toast.error("Name required");
    setLoading(true);
    try {
      const res = await fetch(`/api/menu/categories/${category.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, icon, isActive, addonIds: selected }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Category updated");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  async function del() {
    if (!confirm(`Delete category "${category.name}"?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/menu/categories/${category.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Category deleted");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setDeleting(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader><DialogTitle>Edit category · {category.addons?.length ?? 0} add-ons inherit here</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1"><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="space-y-1"><Label>Icon (emoji)</Label><Input value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="☕" /></div>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <span className="text-sm">Active (shown in menu)</span>
            <Switch checked={!!isActive} onCheckedChange={setIsActive} />
          </div>
          <div className="space-y-1">
            <Label>Add-ons for this category</Label>
            <p className="text-xs text-muted-foreground">
              Each add-on belongs to one category only. Chosen add-ons are offered on every product in this
              category — checking an add-on that lives in another category moves it here.
            </p>
            <div className="flex flex-wrap gap-2">
              {allAddons.map((a: any) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs",
                    selected.includes(a.id) ? "border-primary bg-primary/10 text-primary" : cn("text-muted-foreground", !a.isActive && "opacity-40")
                  )}
                >
                  {a.name} · {formatCurrency(a.price)}
                  {a.category ? <span className="ml-1 opacity-60">{a.category.name}</span> : <span className="ml-1 opacity-40">unassigned</span>}
                </button>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter className="flex items-center justify-between">
          <Button variant="destructive" onClick={del} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={loading || !name}>
              {loading && <Loader2 className="h-4 w-4 animate-spin" />} Save
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddonsDialog({ allAddons, categories, onClose, onSaved }: any) {
  const [newName, setNewName] = useState("");
  const [newFlavour, setNewFlavour] = useState("");
  const [newPrice, setNewPrice] = useState("");
  const [newCategoryId, setNewCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; flavour: string; price: string; isActive: boolean; categoryId: string }>({ name: "", flavour: "", price: "", isActive: true, categoryId: "" });
  const [savingId, setSavingId] = useState<string | null>(null);

  async function create() {
    if (!newName.trim()) return toast.error("Name required");
    setCreating(true);
    try {
      const res = await fetch("/api/addons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName, flavour: newFlavour || undefined, price: Number(newPrice) || 0, categoryId: newCategoryId || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(newCategoryId ? "Add-on added to category" : "Add-on created");
      setNewName(""); setNewFlavour(""); setNewPrice("");
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setCreating(false); }
  }

  function beginEdit(a: any) {
    setEditingId(a.id);
    setEdit({ name: a.name, flavour: a.flavour ?? "", price: String(a.price ?? ""), isActive: a.isActive, categoryId: a.category?.id ?? "" });
  }

  async function update() {
    const id = editingId;
    if (!id) return;
    setSavingId(id);
    try {
      const res = await fetch(`/api/addons/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: edit.name, flavour: edit.flavour || undefined, price: Number(edit.price) || 0, isActive: edit.isActive, categoryId: edit.categoryId === "__none__" ? null : edit.categoryId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Add-on updated");
      setEditingId(null);
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setSavingId(null); }
  }

  async function del(a: any) {
    if (!confirm(`Delete "${a.name}"?`)) return;
    try {
      const res = await fetch(`/api/addons/${a.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Deleted");
      onSaved();
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add-ons</DialogTitle>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label>Add-on used by</Label>
          <div className="flex flex-wrap gap-1.5">
            {allAddons.map((a: any) => (
              <span key={a.id} className={cn("rounded-full border px-2.5 py-1 text-xs", !a.isActive && "opacity-40")}>
                {a.name} · {formatCurrency(a.price)}
                {a._count?.products > 0 && <span className="ml-1 text-muted-foreground">P{a._count.products}</span>}
                {a.category ? <span className="ml-1 text-muted-foreground">{a.category.name}</span> : <span className="ml-1 text-muted-foreground/60">unassigned</span>}
                {!a.isActive && <span className="ml-1 text-destructive">off</span>}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-medium">Create add-on</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Extra Shot" className="w-40" />
            </div>
            <div className="space-y-1">
              <Label>Flavour</Label>
              <Input value={newFlavour} onChange={(e) => setNewFlavour(e.target.value)} placeholder="Optional" className="w-32" />
            </div>
            <div className="space-y-1">
              <Label>Price</Label>
              <Input type="number" min={0} value={newPrice} onChange={(e) => setNewPrice(e.target.value)} className="w-24" />
            </div>
            <div className="space-y-1">
              <Label>Category</Label>
              <Select value={newCategoryId} onValueChange={setNewCategoryId}>
                <SelectTrigger className="w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                <SelectContent>
                  {categories.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={create} disabled={creating || !newName.trim()}>
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          {allAddons.map((a: any) =>
            editingId === a.id ? (
              <div key={a.id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <Label>Name</Label>
                    <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className="w-40" />
                  </div>
                  <div className="space-y-1">
                    <Label>Flavour</Label>
                    <Input value={edit.flavour} onChange={(e) => setEdit({ ...edit, flavour: e.target.value })} className="w-32" />
                  </div>
                  <div className="space-y-1">
                    <Label>Price</Label>
                    <Input type="number" min={0} value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} className="w-24" />
                  </div>
                  <div className="space-y-1">
                    <Label>Category</Label>
                    <Select value={edit.categoryId} onValueChange={(v) => setEdit({ ...edit, categoryId: v })}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Unassigned" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Unassigned</SelectItem>
                        {categories.map((c: any) => (
                          <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <Switch checked={edit.isActive} onCheckedChange={(v) => setEdit({ ...edit, isActive: !!v })} />
                    <span className="text-xs text-muted-foreground">Active</span>
                  </div>
                  <div className="flex gap-2 pb-1">
                    <Button size="sm" onClick={update} disabled={savingId === a.id || !edit.name.trim()}>
                      {savingId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div key={a.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium">{a.name}</span>
                  {a.flavour && <span className="ml-2 text-xs text-muted-foreground">{a.flavour}</span>}
                  <span className="ml-2 text-xs">{formatCurrency(a.price)}</span>
                  {!a.isActive && <Badge variant="outline" className="ml-2">inactive</Badge>}
                  {a.category && <span className="ml-2 text-[11px] text-muted-foreground">in {a.category.name}</span>}
                  {!a.category && <span className="ml-2 text-[11px] text-muted-foreground/60">unassigned</span>}
                  {a._count?.products > 0 && (
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      on {a._count.products} product{a._count.products === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => beginEdit(a)} aria-label={`Edit ${a.name}`}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="text-destructive" onClick={() => del(a)} aria-label={`Delete ${a.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )
          )}
          {allAddons.length === 0 && (
            <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No add-ons yet. Create some above, then assign them to categories and products.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
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

  const activeCategory = categories.find((c: any) => c.id === categoryId);
  const inheritedAddons = (activeCategory?.addons ?? []).filter((a: any) => a.isActive);
  const inheritedIds = inheritedAddons.map((a: any) => a.id);
  const attachableAddons = (allAddons ?? []).filter((a: any) => !a.categoryId || a.categoryId === categoryId);

  useEffect(() => {
    setSelectedAddons((prev) =>
      prev.filter((aid: string) => {
        const a = allAddons.find((x: any) => x.id === aid);
        return !a?.categoryId || a.categoryId === categoryId;
      })
    );
  }, [categoryId, allAddons]);

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
              <SelectContent>
                {categories.map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>
                ))}
              </SelectContent>
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
            <Label>Add-ons for this product</Label>
            <p className="text-xs text-muted-foreground">
              These are added to the product&apos;s category add-ons ({inheritedAddons.length} inherited from &quot;{(activeCategory as any)?.name ?? ""}&quot;).
              Add-ons owned by other categories aren&apos;t shown here.
            </p>
            <div className="flex flex-wrap gap-2">
              {attachableAddons.map((a: any) => {
                const fromCategory = inheritedIds.includes(a.id);
                return (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() => toggleAddon(a.id)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs",
                      selectedAddons.includes(a.id) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground"
                    )}
                  >
                    {a.name} · {formatCurrency(a.price)}
                    {fromCategory && <span className="ml-1 opacity-60">(cat)</span>}
                  </button>
                );
              })}
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