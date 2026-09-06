"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Plus, Minus, Send, ReceiptText, IndianRupee, Loader2, Trash2, ShoppingBag, ChefHat } from "lucide-react";
import { cn, formatCurrency, timeAgo } from "@/lib/utils";
import { useCart, type CartLine } from "@/store/cart";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { BillView } from "./bill-view";

type TableType = {
  id: string;
  tableName: string;
  seatCount: number;
  status: string;
  sessions: { id: string; sessionNumber: string; guestCount: number; customer: { name: string | null; phone: string | null; loyaltyPoints: number } | null; orders: any[] }[];
};

type ProductType = {
  id: string;
  name: string;
  code: string | null;
  basePrice: number;
  description: string | null;
  isVeg: boolean;
  isBestseller: boolean;
  isAvailable: boolean;
  prepTimeMins: number | null;
  addons: { addon: { id: string; name: string; price: number; flavour: string | null } }[];
};

export function TableTerminal({
  table,
  menu,
  store,
  onClose,
  onChanged,
}: {
  table: TableType | null;
  menu: any[];
  store: any;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [view, setView] = useState<"order" | "bill">("order");
  const [addonFor, setAddonFor] = useState<ProductType | null>(null);
  const [addonSel, setAddonSel] = useState<Record<string, number>>({});
  const [sending, setSending] = useState(false);
  const [loadingBill, setLoadingBill] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelNote, setCancelNote] = useState<string>("");

  const { lines, addItem, removeItem, updateQty, clearCart, setOrderId } = useCart();

  const session = table?.sessions[0];

  useEffect(() => {
    if (table) {
      setActiveCat(menu[0]?.id ?? null);
      setView("order");
      clearCart();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table?.id, clearCart]);

  const activeProducts: ProductType[] = useMemo(() => {
    const cat = menu.find((c) => c.id === activeCat);
    return cat?.products ?? [];
  }, [menu, activeCat]);

  const cartTotal = useMemo(() => lines.reduce((s, l) => s + (l.unitPrice + l.addons.reduce((x, a) => x + a.price * a.quantity, 0)) * l.quantity, 0), [lines]);

  if (!table || !session) return null;

  const sessionOrders = session.orders;

  function openAddonPicker(product: ProductType) {
    const applicable = product.addons.map((a) => a.addon);
    if (applicable.length === 0) {
      addItem({ productId: product.id, name: product.name, unitPrice: Number(product.basePrice), quantity: 1, addons: [] });
      return;
    }
    setAddonFor(product);
    setAddonSel({});
  }

  function confirmAddon() {
    if (!addonFor) return;
    const chosen = Object.entries(addonSel)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => {
        const addon = addonFor.addons.find((a) => a.addon.id === id)!.addon;
        return { id, name: addon.name, price: Number(addon.price), quantity: q };
      });
    addItem({
      productId: addonFor.id,
      name: addonFor.name,
      unitPrice: Number(addonFor.basePrice),
      quantity: 1,
      addons: chosen,
    });
    setAddonFor(null);
    setAddonSel({});
  }

  async function sendToKitchen() {
    if (lines.length === 0) return;
    if (!session) return;
    setSending(true);
    try {
      const items = lines.map((l) => ({
        productId: l.productId,
        name: l.name,
        unitPrice: l.unitPrice,
        quantity: l.quantity,
        note: l.note,
        addons: l.addons.map((a) => ({ id: a.id, name: a.name, price: a.price, quantity: a.quantity })),
      }));
      const res = await fetch(`/api/pos/sessions/${session.id}/order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, type: "DINE_IN" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send order");
      toast.success("Order sent to kitchen");
      clearCart();
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSending(false);
    }
  }

  const EDITABLE_STATUSES = ["DRAFT", "SENT_TO_KITCHEN", "PREPARING"];
  const CANCELLABLE_STATUSES = ["DRAFT", "SENT_TO_KITCHEN", "PREPARING", "READY"];

  function isEditable(status: string) {
    return EDITABLE_STATUSES.includes(status);
  }

  function isCancellable(status: string) {
    return CANCELLABLE_STATUSES.includes(status);
  }

  async function updateOrderItemQty(orderId: string, itemId: string, quantity: number) {
    if (quantity < 1) return removeOrderItem(orderId, itemId);
    setBusy(itemId);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ quantity }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update item");
      toast.success("Item updated");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function removeOrderItem(orderId: string, itemId: string) {
    setBusy(itemId);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}/items/${itemId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Failed to remove item");
      toast.success(data.orderCancelled ? "Order cancelled (no items left)" : "Item removed");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  async function confirmCancelOrder(orderId: string) {
    setBusy(orderId);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELLED", reason: cancelReason, note: cancelNote || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel order");
      const waste = data.waste;
      toast.success(
        waste ? `Order cancelled · waste logged (${formatCurrency(waste.totalCost)})` : "Order cancelled"
      );
      setCancelTarget(null);
      setCancelReason("");
      setCancelNote("");
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(null);
    }
  }

  function openCancelDialog(orderId: string) {
    setCancelReason("");
    setCancelNote("");
    setCancelTarget(orderId);
  }

  return (
    <Dialog open={!!table} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl gap-0 p-0 sm:rounded-2xl">
        <DialogHeader className="flex-row items-center justify-between border-b px-5 py-4">
          <div className="flex items-center gap-3">
            <DialogTitle>
              {table.tableName} · {session.sessionNumber}
            </DialogTitle>
            <span className="text-muted-foreground text-sm">
              {session.guestCount} guest{session.guestCount > 1 ? "s" : ""}
            </span>
            {session.customer?.name && (
              <span className="text-sm text-muted-foreground">· {session.customer.name}</span>
            )}
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              onClick={() => setView("order")}
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", view === "order" ? "bg-card shadow" : "text-muted-foreground")}
            >
              <ShoppingBag className="h-4 w-4" /> Order
            </button>
            <button
              onClick={() => setView("bill")}
              className={cn("flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium", view === "bill" ? "bg-card shadow" : "text-muted-foreground")}
            >
              <ReceiptText className="h-4 w-4" /> Bill
            </button>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] overflow-y-auto">
          {view === "order" ? (
            <div>
              <div className="grid md:grid-cols-[1fr_340px]">
                <OrderMenu
                  menu={menu}
                  activeCat={activeCat}
                  setActiveCat={setActiveCat}
                  activeProducts={activeProducts}
                  onPick={openAddonPicker}
                />
                <CartPanel
                  lines={lines}
                  cartTotal={cartTotal}
                  updateQty={updateQty}
                  removeItem={removeItem}
                  sending={sending}
                  onSend={sendToKitchen}
                  orderCount={sessionOrders.length}
                />
              </div>
              <PlacedOrders
                orders={sessionOrders}
                busy={busy}
                isEditable={isEditable}
                isCancellable={isCancellable}
                onUpdateQty={(orderId: string, itemId: string, quantity: number) => updateOrderItemQty(orderId, itemId, quantity)}
                onRemoveItem={(orderId: string, itemId: string) => removeOrderItem(orderId, itemId)}
                onCancel={openCancelDialog}
              />
            </div>
          ) : (
            <BillView
              sessionId={session.id}
              store={store}
              onChanged={onChanged}
              onClose={onClose}
            />
          )}
        </div>

        {addonFor && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-card p-5 shadow-xl">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold">{addonFor.name} · Add-ons</h3>
                <button onClick={() => setAddonFor(null)}><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-3">
                {addonFor.addons.map((a) => (
                  <div key={a.addon.id} className="flex items-center justify-between rounded-lg border p-3">
                    <div>
                      <div className="text-sm font-medium">{a.addon.name}</div>
                      <div className="text-xs text-muted-foreground">{formatCurrency(a.addon.price)}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setAddonSel((s) => ({ ...s, [a.addon.id]: Math.max(0, (s[a.addon.id] ?? 0) - 1) }))}
                        className="rounded-md border p-1"
                      >
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-6 text-center">{addonSel[a.addon.id] ?? 0}</span>
                      <button
                        onClick={() => setAddonSel((s) => ({ ...s, [a.addon.id]: (s[a.addon.id] ?? 0) + 1 }))}
                        className="rounded-md border p-1"
                      >
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <Button className="mt-4 w-full" onClick={confirmAddon}>
                Add to cart
              </Button>
            </div>
          </div>
        )}
      </DialogContent>

      <Dialog open={!!cancelTarget} onOpenChange={(o) => !o && setCancelTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Cancel order</DialogTitle>
          </DialogHeader>
          {(() => {
            const target = sessionOrders.find((o: any) => o.id === cancelTarget);
            if (!target) return null;
            const prepStarted = ["PREPARING", "READY"].includes(target.status);
            const allowedReasons: { value: string; label: string }[] = prepStarted
              ? [{ value: "DEFECTIVE_FOOD", label: "Food defect / damaged — dish returned" }]
              : [
                  { value: "DEFECTIVE_FOOD", label: "Food defect / damaged — dish returned" },
                  { value: "NOT_STARTED", label: "Kitchen hasn't started — no food was made" },
                  { value: "OTHER", label: "Other (guest no longer wants it)" },
                ];
            return (
              <div className="space-y-4">
                {prepStarted && (
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    This order is already being {target.status === "READY" ? "prepared" : "prepared"}. Unless the food is
                    defective, the guest has to pay.
                  </p>
                )}
                <div className="space-y-2">
                  {allowedReasons.map((r) => (
                    <label
                      key={r.value}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-sm",
                        cancelReason === r.value ? "border-primary bg-primary/5" : "hover:bg-muted"
                      )}
                    >
                      <input
                        type="radio"
                        name="cancel-reason"
                        value={r.value}
                        checked={cancelReason === r.value}
                        onChange={() => setCancelReason(r.value)}
                        className="mt-0.5"
                      />
                      <span>{r.label}</span>
                    </label>
                  ))}
                </div>
                <Input
                  placeholder="Note (optional)"
                  value={cancelNote}
                  onChange={(e) => setCancelNote(e.target.value)}
                />
                <Button
                  className="w-full"
                  disabled={!cancelReason || busy === target.id}
                  onClick={() => confirmCancelOrder(target.id)}
                >
                  {busy === target.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                  Cancel order
                </Button>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

function OrderMenu({ menu, activeCat, setActiveCat, activeProducts, onPick }: any) {
  return (
    <div className="border-r">
      <div className="flex gap-2 overflow-x-auto border-b p-3 scrollbar-thin">
        {menu.map((c: any) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-4 py-1.5 text-sm font-medium",
              activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-foreground hover:bg-accent"
            )}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-3">
        {activeProducts.map((p: any) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            disabled={!p.isAvailable}
            className={cn(
              "relative rounded-xl border p-3 text-left transition-all hover:border-primary hover:shadow-md",
              !p.isAvailable && "opacity-40"
            )}
          >
            {p.isBestseller && (
              <span className="absolute right-2 top-2 rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold text-white">
                Bestseller
              </span>
            )}
            <div className="mb-1 flex items-center gap-1">
              <span className={cn("h-3 w-3 rounded-sm border", p.isVeg ? "border-green-600" : "border-red-600")}>
                <span className={cn("block h-1.5 w-1.5 rounded-full m-auto mt-0.5", p.isVeg ? "bg-green-600" : "bg-red-600")} />
              </span>
              <span className="text-[11px] text-muted-foreground">{p.code}</span>
            </div>
            <div className="text-sm font-semibold leading-tight">{p.name}</div>
            {p.prepTimeMins && <div className="text-[11px] text-muted-foreground">~{p.prepTimeMins} min</div>}
            <div className="mt-1 flex items-center justify-between">
              <span className="font-bold">{formatCurrency(p.basePrice)}</span>
              {p.addons.length > 0 && <Plus className="h-4 w-4 text-primary" />}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CartPanel({ lines, cartTotal, updateQty, removeItem, sending, onSend, orderCount }: any) {
  return (
    <div className="flex flex-col bg-muted/30">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <span className="font-semibold">Current order</span>
        <span className="text-xs text-muted-foreground">{orderCount} order{orderCount !== 1 ? "s" : ""} so far</span>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {lines.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No items yet. Tap a product to add.
          </div>
        )}
        {lines.map((l: CartLine) => (
          <div key={l.key} className="rounded-lg border bg-card p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium">{l.name}</div>
                {l.addons.length > 0 && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {l.addons.map((a) => `${a.name} ×${a.quantity}`).join(", ")}
                  </div>
                )}
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatCurrency(l.unitPrice)}
                  {l.addons.length > 0 && ` + ${formatCurrency(l.addons.reduce((s, a) => s + a.price * a.quantity, 0))}`}
                </div>
              </div>
              <button onClick={() => removeItem(l.key)} className="text-muted-foreground hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button onClick={() => updateQty(l.key, l.quantity - 1)} className="rounded-md border p-1"><Minus className="h-3.5 w-3.5" /></button>
                <span className="w-6 text-center text-sm">{l.quantity}</span>
                <button onClick={() => updateQty(l.key, l.quantity + 1)} className="rounded-md border p-1"><Plus className="h-3.5 w-3.5" /></button>
              </div>
              <span className="font-semibold">{formatCurrency((l.unitPrice + l.addons.reduce((s, a) => s + a.price * a.quantity, 0)) * l.quantity)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="border-t p-4">
        <div className="mb-2 flex items-center justify-between text-sm font-semibold">
          <span>Subtotal</span>
          <span>{formatCurrency(cartTotal)}</span>
        </div>
        <Button className="w-full" onClick={onSend} disabled={sending || lines.length === 0}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChefHat className="h-4 w-4" />}
          Send to kitchen
        </Button>
      </div>
    </div>
  );
}

const ORDER_STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT_TO_KITCHEN: "bg-sky-100 text-sky-700",
  PREPARING: "bg-amber-100 text-amber-700",
  READY: "bg-emerald-100 text-emerald-700",
  PARTIALLY_SERVED: "bg-violet-100 text-violet-700",
  SERVED: "bg-green-100 text-green-700",
  CANCELLED: "bg-red-100 text-red-600",
};

function PlacedOrders({ orders, busy, isEditable, isCancellable, onUpdateQty, onRemoveItem, onCancel }: any) {
  if (orders.length === 0) {
    return (
      <div className="border-t px-5 py-4">
        <h3 className="font-semibold">Placed orders</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          No orders yet — send your cart to the kitchen and they will appear here with live status.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t px-5 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-semibold">Placed orders</h3>
        <span className="text-xs text-muted-foreground">
          {orders.length} order{orders.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-3">
        {orders.map((o: any) => {
          const editable = isEditable(o.status);
          const orderTotal = o.items.reduce(
            (s: number, it: any) =>
              s + (Number(it.unitPrice) + it.addons.reduce((x: number, a: any) => x + Number(a.price) * a.quantity, 0)) * it.quantity,
            0
          );
          return (
            <div key={o.id} className="rounded-xl border p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{o.orderNumber}</span>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] capitalize", ORDER_STATUS_STYLE[o.status] ?? "bg-muted text-muted-foreground")}>
                    {o.status.toLowerCase().replace(/_/g, " ")}
                  </span>
                  {o.placedAt && <span className="text-xs text-muted-foreground">{timeAgo(o.placedAt)}</span>}
                </div>
                {isCancellable(o.status) && (
                  <button
                    onClick={() => onCancel(o.id)}
                    disabled={busy === o.id}
                    className="flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    {busy === o.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                    Cancel
                  </button>
                )}
              </div>

              {o.note && <div className="mt-1 text-xs italic text-muted-foreground">{o.note}</div>}

              <div className="mt-2 space-y-1">
                {o.items.map((it: any) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-md bg-muted/40 px-2 py-1.5 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {it.name} ×{it.quantity}
                      </div>
                      {it.addons.length > 0 && (
                        <div className="text-[11px] text-muted-foreground">
                          {it.addons.map((a: any) => `${a.name} ×${a.quantity}`).join(", ")}
                        </div>
                      )}
                      {it.note && <div className="text-[11px] italic text-muted-foreground">{it.note}</div>}
                    </div>
                    <div className="flex items-center gap-2">
                      {editable && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => onUpdateQty(o.id, it.id, it.quantity - 1)}
                            disabled={busy === it.id}
                            className="rounded-md border p-1 disabled:opacity-50"
                            aria-label={`Decrease ${it.name}`}
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <span className="w-6 text-center text-xs">{it.quantity}</span>
                          <button
                            onClick={() => onUpdateQty(o.id, it.id, it.quantity + 1)}
                            disabled={busy === it.id}
                            className="rounded-md border p-1 disabled:opacity-50"
                            aria-label={`Increase ${it.name}`}
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <button
                        onClick={() => onRemoveItem(o.id, it.id)}
                        disabled={busy === it.id}
                        className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                        aria-label={`Remove ${it.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <span className="w-24 text-right text-xs font-semibold">
                        {formatCurrency(
                          (Number(it.unitPrice) + it.addons.reduce((x: number, a: any) => x + Number(a.price) * a.quantity, 0)) * it.quantity
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {!editable && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  {o.status === "CANCELLED" ? "This order was cancelled." : "This order can no longer be edited."}
                </div>
              )}

              <div className="mt-2 flex justify-end border-t pt-2 text-sm font-bold">{formatCurrency(orderTotal)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
