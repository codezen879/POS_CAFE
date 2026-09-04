"use client";

import { useEffect, useMemo, useState } from "react";
import { cn, formatCurrency } from "@/lib/utils";
import { Check, Minus, Plus, ShoppingBag, X } from "lucide-react";
import toast from "react-hot-toast";
import { computeSummary, useCart, type CartAddon } from "@/store/cart";

export function DiningMenu({ store, categories, table }: any) {
  const { lines, addItem, updateQty, removeItem, clearCart } = useCart();
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const [cartOpen, setCartOpen] = useState(false);
  const [picker, setPicker] = useState<any>(null);
  const [pickerQty, setPickerQty] = useState(1);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, boolean>>({});
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ count: number; tableName: string } | null>(null);
  const [openTables, setOpenTables] = useState<any[]>([]);
  const [guestTableId, setGuestTableId] = useState<string | null>(null);

  const tableLocked = !!table?.id && !table?.sessions?.[0];
  const canAdd = !tableLocked;
  const targetTableId = table?.id || guestTableId;
  const targetTableName = table?.tableName || openTables.find((t) => t.id === guestTableId)?.tableName;

  useEffect(() => {
    if (table?.id) return;
    fetch("/api/m/tables")
      .then((r) => r.json())
      .then((d) => setOpenTables(d.tables ?? []))
      .catch(() => {});
  }, [table?.id]);

  const activeProducts = categories.find((c: any) => c.id === activeCat)?.products ?? [];
  const cartCount = lines.reduce((s, l) => s + l.quantity, 0);
  const summary = useMemo(() => computeSummary(lines), [lines]);

  function openPicker(product: any) {
    setSelectedAddons({});
    setPickerQty(1);
    setPicker(product);
    setCartOpen(false);
  }

  function addProduct(product: any, qty = 1) {
    addItem({
      productId: product.id,
      name: product.name,
      unitPrice: Number(product.basePrice) || 0,
      quantity: qty,
      addons: [],
    });
    toast.success(`${product.name} added`);
  }

  function addCustomized() {
    if (!picker) return;
    const addons: CartAddon[] = (picker.addons ?? [])
      .map((a: any) => a.addon)
      .filter((a: any) => a?.isActive && selectedAddons[a.id])
      .map((a: any) => ({ id: a.id, name: a.name, price: Number(a.price) || 0, quantity: 1 }));
    addItem({
      productId: picker.id,
      name: picker.name,
      unitPrice: Number(picker.basePrice) || 0,
      quantity: pickerQty,
      addons,
    });
    toast.success(`${picker.name} added`);
    setPicker(null);
  }

  async function sendOrder() {
    if (!targetTableId || lines.length === 0) return;
    setSending(true);
    try {
      const res = await fetch("/api/m/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tableId: targetTableId,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            note: l.note || undefined,
            addons: l.addons.map((a) => ({ id: a.id, quantity: a.quantity })),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to send order");
      setSent({ count: cartCount, tableName: targetTableName || "" });
      clearCart();
      setCartOpen(false);
    } catch (e: any) {
      toast.error(e.message || "Failed to send order");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary px-5 py-6 text-primary-foreground">
        <div className="flex items-center justify-between gap-3">
          <div className="text-xl font-bold">{store?.name || "Menu"}</div>
          {table?.tableName && (
            <span className="rounded-full bg-primary-foreground/20 px-3 py-1 text-xs font-semibold">
              Table {table.tableName}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-xs opacity-80">{store?.address ? `${store.address}${store.city ? `, ${store.city}` : ""}` : ""}</div>
        {tableLocked ? (
          <div className="mt-4 text-sm font-medium opacity-90">This table isn&apos;t open yet — please ask your server.</div>
        ) : (
          <div className="mt-4 text-sm opacity-90">Tap items to add them, then send your order to the kitchen.</div>
        )}
      </div>

      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b bg-background px-3 py-2 shadow-sm scrollbar-thin">
        {categories.map((c: any) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium",
              activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-4">
        {activeProducts.map((p: any) => {
          const addons = p.addons?.filter((a: any) => a.addon?.isActive) ?? [];
          const hasAddons = addons.length > 0;
          return (
            <button
              key={p.id}
              onClick={() => (hasAddons ? openPicker(p) : addProduct(p))}
              disabled={!canAdd}
              className={cn(
                "w-full rounded-xl border bg-card p-4 text-left transition-transform active:scale-[0.98]",
                canAdd ? "border-neutral-200" : "cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-2">
                  <span className={cn("mt-1 h-3.5 w-3.5 rounded-sm border-2", p.isVeg ? "border-green-600" : "border-red-600")} />
                  <div>
                    <div className="font-semibold leading-tight">{p.name}</div>
                    {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>}
                    {hasAddons && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        Add-ons: {addons.map((a: any) => `${a.addon.name} (+${formatCurrency(a.addon.price)})`).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <div className="whitespace-nowrap font-bold">{formatCurrency(p.basePrice)}</div>
                  <span
                    className={cn(
                      "pointer-events-none flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold",
                      canAdd ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <Plus className="h-3.5 w-3.5" />
                    {hasAddons ? "Customize" : "Add"}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
        {activeProducts.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No items in this category.</div>
        )}
      </div>

      {canAdd && cartCount > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => setCartOpen(true)}
            className="flex w-full items-center justify-between rounded-full bg-primary px-5 py-3 text-primary-foreground"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <ShoppingBag className="h-4 w-4" />
              View cart · {cartCount} item{cartCount > 1 ? "s" : ""}
            </span>
            <span className="text-sm font-bold">{formatCurrency(summary.total)}</span>
          </button>
        </div>
      )}

      {cartOpen && canAdd && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setCartOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-bold">Your order</div>
              <button onClick={() => setCartOpen(false)} className="rounded-full p-1 hover:bg-muted" aria-label="Close cart">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              {lines.map((l) => (
                <div key={l.key} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{l.name}</div>
                    {l.addons.length > 0 && (
                      <div className="text-[11px] text-muted-foreground">
                        {l.addons.map((a) => `${a.name} ×${a.quantity}`).join(", ")}
                      </div>
                    )}
                    <div className="mt-1 flex items-center gap-2">
                      <button
                        onClick={() => updateQty(l.key, l.quantity + 1)}
                        className="rounded-full border p-1"
                        aria-label="Increase"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-5 text-center text-sm font-semibold">{l.quantity}</span>
                      <button
                        onClick={() => updateQty(l.key, l.quantity - 1)}
                        className="rounded-full border p-1"
                        aria-label="Decrease"
                      >
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-sm font-bold">
                      {formatCurrency((Number(l.unitPrice) + l.addons.reduce((s, a) => s + Number(a.price) * a.quantity, 0)) * l.quantity)}
                    </div>
                    <button onClick={() => removeItem(l.key)} className="text-xs text-muted-foreground hover:text-destructive">
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {!table?.id && (
              <div className="mt-4 rounded-xl border bg-muted/40 p-3">
                <div className="text-xs font-semibold text-muted-foreground">Choose your table</div>
                {openTables.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {openTables.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setGuestTableId(t.id === guestTableId ? null : t.id)}
                        className={cn(
                          "rounded-full px-3 py-1.5 text-sm font-medium",
                          guestTableId === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                        )}
                      >
                        {t.tableName}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 text-xs text-muted-foreground">
                    No open tables right now — please ask your server to open your table.
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 flex items-center justify-between border-t pt-3">
              <span className="text-sm text-muted-foreground">Total</span>
              <span className="text-lg font-bold">{formatCurrency(summary.total)}</span>
            </div>
            <button
              onClick={sendOrder}
              disabled={sending || lines.length === 0 || !targetTableId}
              className="mt-4 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {sending ? "Sending..." : !table?.id && !targetTableId ? "Pick your table, then send" : "Send order to kitchen"}
            </button>
          </div>
        </div>
      )}

      {picker && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setPicker(null)} />
          <div className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-background p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-lg font-bold">{picker.name}</div>
              <button onClick={() => setPicker(null)} className="rounded-full p-1 hover:bg-muted" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mb-2 text-sm text-muted-foreground">{picker.description}</div>
            <div className="space-y-2">
              {(picker.addons ?? []).map(({ addon }: any) =>
                addon?.isActive ? (
                  <button
                    key={addon.id}
                    onClick={() => setSelectedAddons((s) => ({ ...s, [addon.id]: !s[addon.id] }))}
                    className={cn(
                      "flex w-full items-center justify-between rounded-xl border px-3 py-2.5 text-left",
                      selectedAddons[addon.id] ? "border-primary bg-primary/5" : "border-muted"
                    )}
                    aria-pressed={selectedAddons[addon.id] || undefined}
                  >
                    <span className="text-sm font-medium">{addon.name}</span>
                    <span className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">+{formatCurrency(addon.price)}</span>
                      {selectedAddons[addon.id] && <Check className="h-4 w-4 text-primary" />}
                    </span>
                  </button>
                ) : null
              )}
            </div>
            <div className="mt-4 flex items-center justify-between rounded-xl border px-3 py-2.5">
              <span className="text-sm font-medium">Quantity</span>
              <span className="flex items-center gap-3">
                <button onClick={() => setPickerQty((q) => Math.max(1, q - 1))} className="rounded-full border p-1" aria-label="Decrease">
                  <Minus className="h-4 w-4" />
                </button>
                <span className="w-6 text-center font-semibold">{pickerQty}</span>
                <button onClick={() => setPickerQty((q) => Math.min(99, q + 1))} className="rounded-full border p-1" aria-label="Increase">
                  <Plus className="h-4 w-4" />
                </button>
              </span>
            </div>
            <button
              onClick={addCustomized}
              className="mt-4 w-full rounded-full bg-primary py-3 text-sm font-semibold text-primary-foreground"
            >
              Add {pickerQty} to your order
            </button>
          </div>
        </div>
      )}

      {sent && (
        <div className="fixed inset-x-0 top-3 z-50 flex justify-center px-4">
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 shadow">
            <Check className="h-4 w-4" />
            {sent.count} item{sent.count > 1 ? "s" : ""} sent to the kitchen{sent.tableName ? ` for Table ${sent.tableName}` : ""}
            <button onClick={() => setSent(null)} className="text-emerald-600 hover:text-emerald-800" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}