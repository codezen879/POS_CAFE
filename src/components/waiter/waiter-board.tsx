"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { toast } from "react-hot-toast";
import {
  AlertCircle,
  Check,
  Clock3,
  Loader2,
  RefreshCw,
  RotateCcw,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { cn, formatTime, timeAgo } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const ZenAccent = dynamic(() => import("@/components/three/zen-scene"), { ssr: false });

type ItemDisposition = "NONE" | "WASTE" | "READY_POOL" | "REUSE_OFFER_PENDING";
type ReuseDecision = "USE" | "NEW";

type QueueItem = {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
  status: string;
  priority: boolean;
  requiresKitchen: boolean;
  billable: boolean;
  disposition: ItemDisposition | null;
  createdAt: string;
  readyAt: string | null;
  servedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  reusedFromItemId: string | null;
  orderId: string;
  orderNumber: string;
  tableName: string | null;
  orderedBy: string | null;
  addons: { name: string; quantity: number }[];
};

type OrderTicket = {
  orderId: string;
  orderNumber: string;
  orderedBy: string | null;
  items: QueueItem[];
};

type TableGroup = {
  key: string;
  tableName: string | null;
  orders: OrderTicket[];
  activeCount: number;
  priorityCount: number;
  readyCount: number;
};

type DialogAction =
  | { kind: "cancel"; item: QueueItem }
  | { kind: "return"; item: QueueItem }
  | { kind: "dispose"; item: QueueItem };

type ItemsResponse = {
  items?: QueueItem[];
  error?: string;
};

const TAKAWAY = "Takeaway";
const ORDERED_STATUSES = new Set(["ORDERED", "IN_PROCESS"]);

const STATUS_TONES = {
  ordered:
    "border-yellow-400 bg-yellow-100 text-yellow-950 dark:border-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-100",
  priority:
    "border-blue-500 bg-blue-100 text-blue-950 dark:border-blue-700 dark:bg-blue-950/50 dark:text-blue-100",
  ready:
    "border-orange-500 bg-orange-100 text-orange-950 dark:border-orange-700 dark:bg-orange-950/50 dark:text-orange-100",
  served:
    "border-green-500 bg-green-100 text-green-950 dark:border-green-700 dark:bg-green-950/50 dark:text-green-100",
  stopped:
    "border-red-500 bg-red-100 text-red-950 dark:border-red-700 dark:bg-red-950/50 dark:text-red-100",
  other: "border-slate-300 bg-slate-100 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100",
} as const;

const LEGEND = [
  { label: "Ordered", detail: "Waiting for kitchen", tone: STATUS_TONES.ordered },
  { label: "Priority", detail: "Moves up in kitchen", tone: STATUS_TONES.priority },
  { label: "Ready", detail: "Ready to serve", tone: STATUS_TONES.ready },
  { label: "Served", detail: "Given to customer", tone: STATUS_TONES.served },
  { label: "Cancelled / waste", detail: "Stopped or returned", tone: STATUS_TONES.stopped },
] as const;

const CANCEL_DISPOSITIONS: {
  value: ItemDisposition;
  title: string;
  description: string;
}[] = [
  { value: "NONE", title: "No waste", description: "Preparation has not started." },
  { value: "READY_POOL", title: "Keep ready", description: "Offer it to a matching new order." },
  { value: "WASTE", title: "Record waste", description: "Send it to the waste module." },
];

const RETURN_DISPOSITIONS = CANCEL_DISPOSITIONS.filter((option) => option.value !== "NONE");

function isOrdered(item: QueueItem) {
  return ORDERED_STATUSES.has(item.status);
}

function isActive(item: QueueItem) {
  return isOrdered(item) || item.status === "READY";
}

function isReadyPool(item: QueueItem) {
  return item.disposition === "READY_POOL" && item.status !== "SERVED";
}

function isReuseOfferPending(item: QueueItem) {
  return item.disposition === "REUSE_OFFER_PENDING";
}

function itemTone(item: QueueItem) {
  if (isReadyPool(item)) return STATUS_TONES.ready;
  if (isReuseOfferPending(item)) return STATUS_TONES.ready;
  if (["CANCELLED", "RETURNED", "DEFECTIVE"].includes(item.status)) return STATUS_TONES.stopped;
  if (item.status === "SERVED") return STATUS_TONES.served;
  if (item.status === "READY") return STATUS_TONES.ready;
  if (isOrdered(item) && item.priority) return STATUS_TONES.priority;
  if (isOrdered(item)) return STATUS_TONES.ordered;
  return STATUS_TONES.other;
}

function itemStatusLabel(item: QueueItem) {
  if (isReadyPool(item)) return "Ready — unassigned";
  if (isReuseOfferPending(item)) return "Ready match pending";
  if (item.status === "READY") return "Ready";
  if (item.status === "SERVED") return "Served";
  if (item.status === "CANCELLED") return item.disposition === "WASTE" ? "Cancelled · waste" : "Cancelled";
  if (item.status === "RETURNED") return item.disposition === "WASTE" ? "Returned · waste" : "Returned";
  if (item.status === "DEFECTIVE") return "Waste";
  if (isOrdered(item)) return item.priority ? "Priority" : "Ordered";
  return item.status.replaceAll("_", " ").toLowerCase();
}

function itemEventReason(item: QueueItem) {
  return item.returnReason ?? item.cancelReason;
}

function compareCreatedAt(a: QueueItem, b: QueueItem) {
  return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
}

export function WaiterBoard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [initialLoading, setInitialLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [busyOrderIds, setBusyOrderIds] = useState<Set<string>>(() => new Set());

  const [dialogAction, setDialogAction] = useState<DialogAction | null>(null);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState<ItemDisposition | null>(null);
  const [billable, setBillable] = useState<boolean | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const load = useCallback(async (manual = false) => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/pos/items", { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as ItemsResponse;
      if (!response.ok) throw new Error(data.error || "Could not load waiter orders.");
      if (!Array.isArray(data.items)) throw new Error("The orders response was invalid.");

      setItems(data.items);
      setLoadError(null);
      setLastUpdated(new Date());
      if (manual) toast.success("Waiter board refreshed");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not load waiter orders.";
      setLoadError(message);
      if (manual) toast.error(message);
    } finally {
      setInitialLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 5000);
    return () => window.clearInterval(timer);
  }, [load]);

  const readyPool = useMemo(() => items.filter(isReadyPool).sort(compareCreatedAt), [items]);
  const pendingItems = useMemo(
    () => items.filter(isReuseOfferPending).sort(compareCreatedAt),
    [items]
  );
  const pendingOrders = useMemo<OrderTicket[]>(() => {
    const grouped = new Map<string, QueueItem[]>();
    for (const item of pendingItems) {
      const orderItems = grouped.get(item.orderId) ?? [];
      orderItems.push(item);
      grouped.set(item.orderId, orderItems);
    }

    return Array.from(grouped.entries())
      .map(([orderId, orderItems]) => {
        const sortedItems = [...orderItems].sort(compareCreatedAt);
        return {
          orderId,
          orderNumber: sortedItems[0]?.orderNumber ?? orderId,
          orderedBy: sortedItems[0]?.orderedBy ?? null,
          items: sortedItems,
        };
      })
      .sort((a, b) => compareCreatedAt(a.items[0], b.items[0]));
  }, [pendingItems]);
  const pendingSourceIds = useMemo(
    () =>
      new Set(
        pendingItems
          .map((item) => item.reusedFromItemId)
          .filter((itemId): itemId is string => Boolean(itemId))
      ),
    [pendingItems]
  );

  const tableGroups = useMemo<TableGroup[]>(() => {
    const tables = new Map<string, { tableName: string | null; orders: Map<string, QueueItem[]> }>();

    for (const item of items) {
      if (isReadyPool(item) || isReuseOfferPending(item)) continue;
      const key = item.tableName ?? TAKAWAY;
      const table = tables.get(key) ?? { tableName: item.tableName, orders: new Map<string, QueueItem[]>() };
      const orderItems = table.orders.get(item.orderId) ?? [];
      orderItems.push(item);
      table.orders.set(item.orderId, orderItems);
      tables.set(key, table);
    }

    const groups = Array.from(tables.entries()).map(([key, table]) => {
      const orders = Array.from(table.orders.entries())
        .map(([orderId, orderItems]) => {
          const sortedItems = [...orderItems].sort(compareCreatedAt);
          return {
            orderId,
            orderNumber: sortedItems[0]?.orderNumber ?? orderId,
            orderedBy: sortedItems[0]?.orderedBy ?? null,
            items: sortedItems,
          };
        })
        .sort((a, b) => compareCreatedAt(a.items[0], b.items[0]));
      const allItems = orders.flatMap((order) => order.items);

      return {
        key,
        tableName: table.tableName,
        orders,
        activeCount: allItems.filter(isActive).length,
        priorityCount: allItems.filter((item) => isOrdered(item) && item.priority).length,
        readyCount: allItems.filter((item) => item.status === "READY").length,
      };
    });

    return groups.sort((a, b) => {
      if (a.tableName === null && b.tableName !== null) return 1;
      if (a.tableName !== null && b.tableName === null) return -1;
      return (a.tableName ?? TAKAWAY).localeCompare(b.tableName ?? TAKAWAY, undefined, {
        numeric: true,
        sensitivity: "base",
      });
    });
  }, [items]);

  const tableItems = useMemo(() => items.filter((item) => !isReadyPool(item)), [items]);
  const activeLines = tableItems.filter(isActive).length;
  const readyLines = tableItems.filter((item) => item.status === "READY").length;
  const activeTables = new Set(
    tableItems.filter(isActive).map((item) => item.tableName ?? TAKAWAY)
  ).size;

  function setItemBusy(itemId: string, busy: boolean) {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(itemId);
      else next.delete(itemId);
      return next;
    });
  }

  function setOrderBusy(orderId: string, busy: boolean) {
    setBusyOrderIds((current) => {
      const next = new Set(current);
      if (busy) next.add(orderId);
      else next.delete(orderId);
      return next;
    });
  }

  async function patchItem(item: QueueItem, payload: Record<string, unknown>, successMessage: string) {
    setItemBusy(item.id, true);
    setOperationError(null);
    setDialogError(null);

    try {
      const response = await fetch(`/api/pos/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(data.error || "The item could not be updated.");

      toast.success(successMessage);
      await load();
      return true;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The item could not be updated.";
      setOperationError(`${item.quantity}× ${item.name}: ${message}`);
      setDialogError(message);
      toast.error(message);
      return false;
    } finally {
      setItemBusy(item.id, false);
    }
  }

  function togglePriority(item: QueueItem) {
    if (isReuseOfferPending(item) || !isOrdered(item) || item.requiresKitchen === false) return;
    void patchItem(
      item,
      { priority: !item.priority },
      `${item.quantity}× ${item.name} ${item.priority ? "returned to FIFO" : "marked priority"}`
    );
  }

  function serve(item: QueueItem) {
    if (isReuseOfferPending(item)) return;
    const canServe = item.status === "READY" || (item.requiresKitchen === false && isOrdered(item));
    if (!canServe) return;
    void patchItem(item, { status: "SERVED" }, `${item.quantity}× ${item.name} served`);
  }

  async function resolveReuseOffer(order: OrderTicket, decision: ReuseDecision) {
    setOrderBusy(order.orderId, true);
    setOperationError(null);
    try {
      const response = await fetch(`/api/pos/orders/${order.orderId}/ready-pool-decision`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || "The ready-food decision could not be saved.");
      }

      toast.success(
        decision === "USE"
          ? `${order.orderNumber}: ready food assigned`
          : `${order.orderNumber}: fresh preparation requested`
      );
      await load();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "The ready-food decision could not be saved.";
      setOperationError(`${order.orderNumber}: ${message}`);
      toast.error(message);
    } finally {
      setOrderBusy(order.orderId, false);
    }
  }

  function openDialog(kind: DialogAction["kind"], item: QueueItem) {
    setDialogAction({ kind, item } as DialogAction);
    setReason("");
    setNote("");
    setDisposition(kind === "dispose" ? "WASTE" : null);
    setBillable(null);
    setDialogError(null);
  }

  function closeDialog() {
    setDialogAction(null);
    setReason("");
    setNote("");
    setDisposition(null);
    setBillable(null);
    setDialogError(null);
  }

  async function confirmDialog() {
    if (!dialogAction) return;
    const cleanReason = reason.trim();
    const cleanNote = note.trim();

    if (!cleanReason) {
      setDialogError("Enter a reason before continuing.");
      return;
    }
    if (dialogAction.kind !== "dispose" && !disposition) {
      setDialogError("Choose what happens to this food.");
      return;
    }
    if (dialogAction.kind === "return" && billable === null) {
      setDialogError("Choose whether the original customer should be billed.");
      return;
    }
    if (dialogAction.kind === "return" && disposition === "READY_POOL" && billable) {
      setDialogError("A reusable item must be removed from the original bill.");
      return;
    }

    const { item, kind } = dialogAction;
    let payload: Record<string, unknown>;
    let message: string;

    if (kind === "return") {
      payload = {
        status: "RETURNED",
        reason: cleanReason,
        note: cleanNote || undefined,
        disposition,
        billable,
      };
      message = `${item.quantity}× ${item.name} returned`;
    } else if (kind === "dispose") {
      payload = { status: "CANCELLED", reason: cleanReason, disposition: "WASTE" };
      message = `${item.quantity}× ${item.name} moved to waste`;
    } else {
      payload = {
        status: "CANCELLED",
        reason: cleanReason,
        note: cleanNote || undefined,
        disposition,
      };
      message = `${item.quantity}× ${item.name} cancelled`;
    }

    const updated = await patchItem(item, payload, message);
    if (updated) closeDialog();
  }

  if (initialLoading) {
    return (
      <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" /> Loading table orders…
        </div>
      </div>
    );
  }

  const dialogBusy = dialogAction ? busyIds.has(dialogAction.item.id) : false;
  const dispositionOptions = dialogAction?.kind === "return"
    ? RETURN_DISPOSITIONS
    : dialogAction?.item && isReuseOfferPending(dialogAction.item)
      ? CANCEL_DISPOSITIONS.filter((option) => option.value === "NONE")
    : dialogAction?.item.status === "READY"
      ? CANCEL_DISPOSITIONS.filter((option) => option.value !== "NONE")
      : CANCEL_DISPOSITIONS.filter((option) => option.value !== "READY_POOL");

  return (
    <div className="space-y-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <ZenAccent variant="beans" className="hidden h-11 w-11 shrink-0 sm:block" />
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">Waiter</h1>
              {readyLines > 0 && (
                <Badge className="border-orange-600 bg-orange-500 text-white hover:bg-orange-500">
                  {readyLines} ready now
                </Badge>
              )}
              {pendingOrders.length > 0 && (
                <Badge className="border-amber-700 bg-amber-600 text-white hover:bg-amber-600">
                  {pendingOrders.length} ready-food decision{pendingOrders.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {activeLines} active line{activeLines !== 1 ? "s" : ""} across {activeTables} table
              {activeTables !== 1 ? "s" : ""} · quantities move together · auto-refresh every 5 seconds
            </p>
            {lastUpdated && (
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <Clock3 className="h-3.5 w-3.5" /> Last synced {formatTime(lastUpdated)}
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full shrink-0 sm:h-9 sm:w-auto"
          disabled={refreshing}
          onClick={() => void load(true)}
        >
          <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} />
          {refreshing ? "Refreshing…" : "Refresh"}
        </Button>
      </header>

      {(loadError || operationError) && (
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {operationError ?? loadError}
              {loadError && items.length > 0 ? " Showing the last synced data." : ""}
            </span>
          </div>
          {loadError && (
            <Button type="button" size="sm" variant="outline" onClick={() => void load(true)} disabled={refreshing}>
              Try again
            </Button>
          )}
          {!loadError && operationError && (
            <Button type="button" size="sm" variant="outline" onClick={() => setOperationError(null)}>
              Dismiss
            </Button>
          )}
        </div>
      )}

      <section aria-label="Order status legend">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
          {LEGEND.map((entry) => (
            <div key={entry.label} className={cn("rounded-lg border-l-4 px-3 py-2", entry.tone)}>
              <div className="text-xs font-bold">{entry.label}</div>
              <div className="text-[10px] opacity-75">{entry.detail}</div>
            </div>
          ))}
        </div>
      </section>

      <Card className="overflow-hidden border-2 border-amber-400 dark:border-amber-700">
        <CardHeader className="gap-2 bg-amber-50/80 p-4 dark:bg-amber-950/20 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold">Ready food decisions</h2>
              <Badge className="bg-amber-600 text-white hover:bg-amber-600">{pendingOrders.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Guest orders are accepted, but matching lines stay out of the kitchen queue until you choose.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          {pendingOrders.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
              No ready-food decisions waiting.
            </div>
          ) : (
            <div className="grid items-start gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {pendingOrders.map((order) => (
                <ReadyPoolDecisionCard
                  key={order.orderId}
                  order={order}
                  busy={busyOrderIds.has(order.orderId)}
                  busyIds={busyIds}
                  onDecision={(decision) => void resolveReuseOffer(order, decision)}
                  onCancel={(item) => openDialog("cancel", item)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-2 border-orange-300 dark:border-orange-800">
        <CardHeader className="gap-2 bg-orange-50/80 p-4 dark:bg-orange-950/20 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-bold">Ready — Unassigned</h2>
              <Badge className="bg-orange-500 text-white hover:bg-orange-500">{readyPool.length}</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Kept for an exact matching order. Guest matches stay here until you decide above.
            </p>
          </div>
        </CardHeader>
        <CardContent className="p-3 sm:p-4">
          {readyPool.length === 0 ? (
            <div className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
              No unassigned ready food.
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {readyPool.map((item) => {
                const awaitingDecision = pendingSourceIds.has(item.id);
                return (
                  <div key={item.id} className={cn("rounded-lg border-2 p-3", STATUS_TONES.ready)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold">
                          {item.quantity}× {item.name}
                        </div>
                        <div className="mt-0.5 text-[11px] opacity-75">
                          From {item.tableName ?? TAKAWAY} · {item.orderNumber} · {timeAgo(item.createdAt)}
                        </div>
                        {awaitingDecision && (
                          <Badge className="mt-2 border-amber-700 bg-amber-600 text-white hover:bg-amber-600">
                            Decision pending
                          </Badge>
                        )}
                      </div>
                      {busyIds.has(item.id) && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
                    </div>
                    {item.addons?.length > 0 && (
                      <div className="mt-1 text-[11px] opacity-75">
                        {item.addons.map((addon) => `+ ${addon.name}×${addon.quantity}`).join(", ")}
                      </div>
                    )}
                    {itemEventReason(item) && (
                      <div className="mt-2 rounded bg-white/50 px-2 py-1 text-[11px] dark:bg-black/20">
                        Reason: {itemEventReason(item)}
                      </div>
                    )}
                    <div className="mt-2 text-[11px] font-medium">
                      Original bill: {item.billable ? "included" : "excluded"}
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-3 h-10 w-full border-red-400 bg-white/70 text-red-800 hover:bg-red-50 dark:bg-slate-950/50 dark:text-red-200 sm:h-8"
                      disabled={busyIds.has(item.id) || awaitingDecision}
                      onClick={() => openDialog("dispose", item)}
                    >
                      {awaitingDecision ? (
                        <>
                          <Clock3 className="h-4 w-4" /> Awaiting waiter decision
                        </>
                      ) : (
                        <>
                          <Trash2 className="h-4 w-4" /> Move to waste
                        </>
                      )}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <section aria-labelledby="table-orders-heading">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 id="table-orders-heading" className="text-lg font-bold">
              Table orders
            </h2>
            <p className="text-xs text-muted-foreground">Each new add-on order stays in its own ticket.</p>
          </div>
          <Badge variant="secondary">{tableGroups.length} table views</Badge>
        </div>

        {tableGroups.length === 0 ? (
          <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            Nothing pending. New orders appear here as soon as they are placed.
          </div>
        ) : (
          <div className="grid items-start gap-4 md:grid-cols-2 2xl:grid-cols-3">
            {tableGroups.map((group) => (
              <TableCard
                key={group.key}
                group={group}
                busyIds={busyIds}
                onServe={serve}
                onPriority={togglePriority}
                onCancel={(item) => openDialog("cancel", item)}
                onReturn={(item) => openDialog("return", item)}
              />
            ))}
          </div>
        )}
      </section>

      <Dialog
        open={dialogAction !== null}
        onOpenChange={(open) => {
          if (!open && !dialogBusy) closeDialog();
        }}
      >
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {dialogAction?.kind === "return"
                ? "Return served item"
                : dialogAction?.kind === "dispose"
                  ? "Move ready food to waste"
                  : "Cancel item"}
            </DialogTitle>
            <DialogDescription>
              {dialogAction?.item.quantity}× {dialogAction?.item.name} · {dialogAction?.item.tableName ?? TAKAWAY} ·{" "}
              {dialogAction?.item.orderNumber}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {dialogAction?.kind === "return" && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                The original served event stays in the audit history. This return will also be recorded.
              </div>
            )}
            {dialogAction?.kind === "dispose" && (
              <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
                This removes the item from the unassigned ready pool and records it in waste.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="waiter-action-reason">Reason *</Label>
              <Input
                id="waiter-action-reason"
                value={reason}
                maxLength={160}
                autoFocus
                disabled={dialogBusy}
                placeholder={dialogAction?.kind === "return" ? "Why was the item returned?" : "Why is this item being stopped?"}
                onChange={(event) => {
                  setReason(event.target.value);
                  setDialogError(null);
                }}
              />
            </div>

            {dialogAction?.kind !== "dispose" && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">What happens to the food? *</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {dispositionOptions.map((option) => (
                    <Button
                      key={option.value}
                      type="button"
                      variant="outline"
                      aria-pressed={disposition === option.value}
                      disabled={dialogBusy}
                      className={cn(
                        "h-auto min-h-16 flex-col items-start justify-start gap-0.5 whitespace-normal px-3 py-2 text-left",
                        disposition === option.value &&
                          (option.value === "WASTE"
                            ? "border-red-600 bg-red-50 text-red-900 ring-2 ring-red-200 dark:bg-red-950/40 dark:text-red-100"
                            : option.value === "READY_POOL"
                              ? "border-orange-600 bg-orange-50 text-orange-900 ring-2 ring-orange-200 dark:bg-orange-950/40 dark:text-orange-100"
                              : "border-slate-600 bg-slate-100 text-slate-900 ring-2 ring-slate-200 dark:bg-slate-900 dark:text-slate-100")
                      )}
                      onClick={() => {
                        setDisposition(option.value);
                        if (dialogAction?.kind === "return" && option.value === "READY_POOL") {
                          setBillable(false);
                        }
                        setDialogError(null);
                      }}
                    >
                      <span className="font-semibold">{option.title}</span>
                      <span className="text-[10px] font-normal opacity-75">{option.description}</span>
                    </Button>
                  ))}
                </div>
              </fieldset>
            )}

            {dialogAction?.kind === "return" && (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Original customer bill *</legend>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={billable === true}
                    disabled={dialogBusy}
                    className={cn(
                      "h-auto min-h-14 whitespace-normal px-3 py-2",
                      billable === true &&
                        "border-green-600 bg-green-50 text-green-900 ring-2 ring-green-200 dark:bg-green-950/40 dark:text-green-100"
                    )}
                    onClick={() => {
                      setBillable(true);
                      if (disposition === "READY_POOL") setDisposition("WASTE");
                      setDialogError(null);
                    }}
                  >
                    Keep on bill
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    aria-pressed={billable === false}
                    disabled={dialogBusy}
                    className={cn(
                      "h-auto min-h-14 whitespace-normal px-3 py-2",
                      billable === false &&
                        "border-slate-600 bg-slate-100 text-slate-900 ring-2 ring-slate-200 dark:bg-slate-900 dark:text-slate-100"
                    )}
                    onClick={() => {
                      setBillable(false);
                      setDialogError(null);
                    }}
                  >
                    Remove from bill
                  </Button>
                </div>
              </fieldset>
            )}

            {dialogAction?.kind !== "dispose" && (
              <div className="space-y-1.5">
                <Label htmlFor="waiter-action-note">Additional detail (optional)</Label>
                <Textarea
                  id="waiter-action-note"
                  value={note}
                  maxLength={500}
                  disabled={dialogBusy}
                  placeholder="Add any useful detail for the audit log"
                  onChange={(event) => setNote(event.target.value)}
                />
              </div>
            )}

            {dialogError && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/40 dark:text-red-100"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {dialogError}
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={dialogBusy} onClick={closeDialog}>
              Keep item
            </Button>
            <Button
              type="button"
              variant={dialogAction?.kind === "return" ? "default" : "destructive"}
              className="h-11 sm:h-9"
              disabled={dialogBusy}
              onClick={() => void confirmDialog()}
            >
              {dialogBusy && <Loader2 className="h-4 w-4 animate-spin" />}
              {dialogAction?.kind === "return"
                ? "Record return"
                : dialogAction?.kind === "dispose"
                  ? "Record waste"
                  : "Cancel item"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ReadyPoolDecisionCard({
  order,
  busy,
  busyIds,
  onDecision,
  onCancel,
}: {
  order: OrderTicket;
  busy: boolean;
  busyIds: Set<string>;
  onDecision: (decision: ReuseDecision) => void;
  onCancel: (item: QueueItem) => void;
}) {
  const firstItem = order.items[0];

  return (
    <article className="overflow-hidden rounded-xl border-2 border-amber-300 bg-amber-50/60 shadow-sm dark:border-amber-800 dark:bg-amber-950/20">
      <div className="flex items-start justify-between gap-3 border-b border-amber-200 px-3 py-2.5 dark:border-amber-800">
        <div className="min-w-0">
          <div className="text-lg font-black leading-tight">{firstItem?.tableName ?? TAKAWAY}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] font-bold">{order.orderNumber}</div>
          <div className="mt-0.5 text-[10px] text-muted-foreground">
            {firstItem ? `Placed ${timeAgo(firstItem.createdAt)}` : "New guest order"}
            {order.orderedBy ? ` · ${order.orderedBy}` : " · Guest order"}
          </div>
        </div>
        {busy ? (
          <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin" aria-label="Saving ready-food decision" />
        ) : (
          <Badge className="shrink-0 bg-amber-600 text-white hover:bg-amber-600">Decision needed</Badge>
        )}
      </div>

      <div className="space-y-2 p-3">
        {order.items.map((item) => (
          <div key={item.id} className="rounded-lg border border-amber-300 bg-white/70 p-3 dark:bg-black/20">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="font-bold leading-tight">
                  <span className="tabular-nums">{item.quantity}×</span> {item.name}
                </div>
                <Badge variant="outline" className="mt-1 border-amber-700 bg-amber-100 text-[10px] text-amber-950 dark:bg-amber-950 dark:text-amber-100">
                  Ready match pending
                </Badge>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-9 shrink-0 px-2 text-red-700 hover:bg-red-50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
                disabled={busy || busyIds.has(item.id)}
                onClick={() => onCancel(item)}
              >
                {busyIds.has(item.id) ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                Cancel
              </Button>
            </div>
            {item.addons?.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                {item.addons.map((addon) => `+ ${addon.quantity}× ${addon.name}`).join(" · ")}
              </div>
            )}
            {item.note && (
              <div className="mt-2 rounded-md bg-amber-100/80 px-2 py-1.5 text-[11px] font-medium dark:bg-amber-950/50">
                Note: {item.note}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="grid gap-2 border-t border-amber-200 p-3 sm:grid-cols-2 dark:border-amber-800">
        <Button
          type="button"
          className="h-11 w-full bg-green-700 text-white hover:bg-green-800"
          disabled={busy}
          onClick={() => onDecision("USE")}
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Use ready food
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full border-blue-500 bg-white/80 text-blue-800 hover:bg-blue-50 dark:bg-slate-950/60 dark:text-blue-200"
          disabled={busy}
          onClick={() => onDecision("NEW")}
        >
          Prepare new
        </Button>
      </div>
    </article>
  );
}

function TableCard({
  group,
  busyIds,
  onServe,
  onPriority,
  onCancel,
  onReturn,
}: {
  group: TableGroup;
  busyIds: Set<string>;
  onServe: (item: QueueItem) => void;
  onPriority: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
  onReturn: (item: QueueItem) => void;
}) {
  return (
    <Card
      className={cn(
        "overflow-hidden border-2",
        group.readyCount > 0 &&
          "border-orange-400 ring-2 ring-orange-100 dark:border-orange-700 dark:ring-orange-950"
      )}
    >
      <CardHeader className="space-y-0 border-b bg-muted/30 p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xl font-black tracking-tight">{group.tableName ?? TAKAWAY}</h3>
          <div className="flex flex-wrap justify-end gap-1">
            {group.readyCount > 0 && (
              <Badge className="bg-orange-500 text-white hover:bg-orange-500">{group.readyCount} ready</Badge>
            )}
            {group.priorityCount > 0 && (
              <Badge className="bg-blue-600 text-white hover:bg-blue-600">{group.priorityCount} priority</Badge>
            )}
            {group.activeCount === 0 && <Badge className="bg-green-600 text-white hover:bg-green-600">Complete</Badge>}
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          {group.orders.length} ticket{group.orders.length !== 1 ? "s" : ""} · {group.activeCount} active line
          {group.activeCount !== 1 ? "s" : ""}
        </p>
      </CardHeader>
      <CardContent className="space-y-3 p-3 sm:p-4">
        {group.orders.map((order) => (
          <article key={order.orderId} className="overflow-hidden rounded-lg border bg-card">
            <div className="flex items-start justify-between gap-2 border-b bg-muted/40 px-3 py-2">
              <div className="min-w-0">
                <div className="truncate font-mono text-xs font-bold">{order.orderNumber}</div>
                <div className="text-[10px] text-muted-foreground">
                  {order.items[0] ? `Placed ${timeAgo(order.items[0].createdAt)}` : ""}
                  {order.orderedBy ? ` · ${order.orderedBy}` : ""}
                </div>
              </div>
              <Badge variant="secondary" className="shrink-0">
                {order.items.length} line{order.items.length !== 1 ? "s" : ""}
              </Badge>
            </div>
            <div className="space-y-2 p-2">
              {order.items.map((item) => (
                <ItemLine
                  key={item.id}
                  item={item}
                  busy={busyIds.has(item.id)}
                  onServe={onServe}
                  onPriority={onPriority}
                  onCancel={onCancel}
                  onReturn={onReturn}
                />
              ))}
            </div>
          </article>
        ))}
      </CardContent>
    </Card>
  );
}

function ItemLine({
  item,
  busy,
  onServe,
  onPriority,
  onCancel,
  onReturn,
}: {
  item: QueueItem;
  busy: boolean;
  onServe: (item: QueueItem) => void;
  onPriority: (item: QueueItem) => void;
  onCancel: (item: QueueItem) => void;
  onReturn: (item: QueueItem) => void;
}) {
  const ordered = isOrdered(item);
  const pendingReuse = isReuseOfferPending(item);
  const directServe = item.requiresKitchen === false && ordered;
  const canServe = !pendingReuse && (item.status === "READY" || directServe);
  const canCancel = ordered || item.status === "READY";
  const canPrioritize = !pendingReuse && ordered && item.requiresKitchen !== false;
  const canReturn = item.status === "SERVED";
  const eventReason = itemEventReason(item);

  return (
    <div className={cn("rounded-lg border-2 p-3", itemTone(item))}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-bold leading-tight">
            <span className="tabular-nums">{item.quantity}×</span> {item.name}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge variant="outline" className="border-current bg-white/50 text-[10px] text-current dark:bg-black/20">
              {itemStatusLabel(item)}
            </Badge>
            {item.requiresKitchen === false && (
              <Badge variant="outline" className="border-current bg-white/50 text-[10px] text-current dark:bg-black/20">
                Waiter direct
              </Badge>
            )}
            {item.reusedFromItemId && (
              <Badge variant="outline" className="border-current bg-white/50 text-[10px] text-current dark:bg-black/20">
                {pendingReuse ? "Ready match pending" : "Reused ready item"}
              </Badge>
            )}
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Updating item" />}
          </div>
        </div>
        <span className="shrink-0 text-[10px] font-medium opacity-70">{formatTime(item.createdAt)}</span>
      </div>

      {item.addons?.length > 0 && (
        <div className="mt-2 text-[11px] opacity-80">
          {item.addons.map((addon) => `+ ${addon.name}×${addon.quantity}`).join(", ")}
        </div>
      )}
      {item.note && <div className="mt-1 text-[11px] italic">“{item.note}”</div>}
      {eventReason && (
        <div className="mt-2 rounded bg-white/50 px-2 py-1 text-[11px] dark:bg-black/20">Reason: {eventReason}</div>
      )}
      {["RETURNED", "CANCELLED"].includes(item.status) && (
        <div className="mt-1 text-[10px] font-medium">
          {item.disposition === "WASTE"
            ? "Recorded as waste"
            : item.disposition === "NONE"
              ? "No waste recorded"
              : "Stopped"}
          {item.status === "RETURNED" ? ` · ${item.billable ? "kept on bill" : "removed from bill"}` : ""}
        </div>
      )}

      {(canServe || canPrioritize || canCancel || canReturn) && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          {canServe && (
            <Button
              type="button"
              size="sm"
              className="h-10 bg-green-700 text-white hover:bg-green-800 sm:h-8"
              disabled={busy}
              onClick={() => onServe(item)}
            >
              <Check className="h-4 w-4" /> {directServe ? "Serve now" : "Mark served"}
            </Button>
          )}
          {canPrioritize && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "h-10 border-blue-500 bg-white/70 text-blue-800 hover:bg-blue-50 dark:bg-slate-950/50 dark:text-blue-200 sm:h-8",
                item.priority &&
                  "border-blue-700 bg-blue-700 text-white hover:bg-blue-800 dark:bg-blue-700 dark:text-white"
              )}
              disabled={busy}
              onClick={() => onPriority(item)}
            >
              <Zap className="h-4 w-4" /> {item.priority ? "Remove priority" : "Priority"}
            </Button>
          )}
          {canCancel && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-10 border-red-400 bg-white/70 text-red-800 hover:bg-red-50 dark:bg-slate-950/50 dark:text-red-200 sm:h-8"
              disabled={busy}
              onClick={() => onCancel(item)}
            >
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
          {canReturn && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="col-span-2 h-10 border-red-400 bg-white/70 text-red-800 hover:bg-red-50 dark:bg-slate-950/50 dark:text-red-200 sm:h-8"
              disabled={busy}
              onClick={() => onReturn(item)}
            >
              <RotateCcw className="h-4 w-4" /> Return item
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
