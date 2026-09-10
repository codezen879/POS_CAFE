"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Clock3, Loader2, RefreshCw } from "lucide-react";
import { toast } from "react-hot-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatTime } from "@/lib/utils";
import { REUSE_OFFER_PENDING } from "@/lib/ready-pool";

type QueueItem = {
  id: string;
  name: string;
  quantity: number;
  note: string | null;
  status: string;
  priority: boolean;
  requiresKitchen: boolean;
  billable: boolean;
  disposition: string | null;
  createdAt: string;
  readyAt: string | null;
  servedAt: string | null;
  defectiveAt: string | null;
  defectiveReason: string | null;
  orderId: string;
  orderNumber: string;
  sessionId: string;
  tableName: string | null;
  orderedBy: string | null;
  addons: { name: string; quantity: number }[];
};

const AUTO_REFRESH_MS = 8_000;

function createdAtTimestamp(item: QueueItem) {
  const timestamp = new Date(item.createdAt).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function queueOrder(a: QueueItem, b: QueueItem) {
  return (
    Number(b.priority) - Number(a.priority) ||
    createdAtTimestamp(a) - createdAtTimestamp(b) ||
    a.id.localeCompare(b.id)
  );
}

function elapsedWait(createdAt: string, now: number) {
  const startedAt = new Date(createdAt).getTime();
  if (Number.isNaN(startedAt)) return "Wait time unavailable";

  const totalMinutes = Math.max(0, Math.floor((now - startedAt) / 60_000));
  if (totalMinutes < 1) return "Waiting <1 min";
  if (totalMinutes < 60) return `Waiting ${totalMinutes} min`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `Waiting ${hours}h ${String(minutes).padStart(2, "0")}m`;

  const days = Math.floor(hours / 24);
  return `Waiting ${days}d ${hours % 24}h`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong";
}

export function KitchenBoard() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [updating, setUpdating] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await fetch("/api/pos/items?view=kitchen", { cache: "no-store" });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Could not load the kitchen queue");
      }

      setItems(Array.isArray(data?.items) ? data.items : []);
      setLoadError(null);
      setLastUpdatedAt(new Date());
      setNow(Date.now());
    } catch (error: unknown) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    const clockTimer = window.setInterval(() => setNow(Date.now()), 30_000);

    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
    };
  }, [load]);

  const foodToMake = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.disposition !== REUSE_OFFER_PENDING &&
            ["ORDERED", "IN_PROCESS"].includes(item.status) &&
            item.requiresKitchen !== false
        )
        .sort(queueOrder),
    [items]
  );

  const readyFood = useMemo(
    () =>
      items
        .filter(
          (item) =>
            item.disposition !== REUSE_OFFER_PENDING &&
            item.requiresKitchen !== false &&
            (item.status === "READY" || item.status === "READY_POOL")
        )
        .sort(queueOrder),
    [items]
  );

  const priorityCount = foodToMake.filter((item) => item.priority).length;

  async function markReady(itemId: string) {
    setUpdating(itemId);
    try {
      const response = await fetch(`/api/pos/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "READY" }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not mark this item ready");

      toast.success("Moved to Ready food");
      await load();
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" aria-live="polite">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading kitchen queue…
        </div>
      </div>
    );
  }

  if (loadError && !lastUpdatedAt) {
    return (
      <div className="mx-auto flex min-h-[40vh] max-w-md items-center justify-center px-4">
        <div className="w-full rounded-xl border border-red-300 bg-red-50 p-5 text-center text-red-950" role="alert">
          <AlertTriangle className="mx-auto mb-2 h-7 w-7 text-red-600" />
          <h1 className="font-semibold">Kitchen queue could not load</h1>
          <p className="mt-1 text-sm text-red-800">{loadError}</p>
          <Button className="mt-4 min-h-11 w-full sm:w-auto" onClick={() => void load()} disabled={refreshing}>
            {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4" aria-busy={refreshing}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Kitchen Display</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {foodToMake.length} to make · {readyFood.length} ready
            {priorityCount > 0 ? ` · ${priorityCount} priority` : ""}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 sm:justify-end">
          <div className="text-right text-[11px] leading-tight text-muted-foreground">
            <div>Auto-refresh every 8 sec</div>
            <div>{lastUpdatedAt ? `Updated ${formatTime(lastUpdatedAt)}` : "Not updated yet"}</div>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 shrink-0 px-3 sm:px-4"
            onClick={() => void load()}
            disabled={refreshing}
            aria-label="Refresh kitchen queue"
          >
            <RefreshCw className={cn(refreshing && "animate-spin")} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
      </header>

      {loadError && (
        <div
          className="flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>
            Refresh failed: {loadError}. Showing the last loaded queue.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border bg-card px-3 py-2 text-xs font-medium">
        <span className="text-muted-foreground">Status:</span>
        <LegendSwatch className="bg-yellow-300" label="Ordered" />
        <LegendSwatch className="bg-blue-500" label="Priority" />
        <LegendSwatch className="bg-orange-400" label="Ready" />
      </div>

      <main className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <QueueColumn title="Food to make" count={foodToMake.length} priorityCount={priorityCount}>
          {foodToMake.length === 0 ? (
            <EmptyQueue message="No food waiting to be made" />
          ) : (
            foodToMake.map((item) => (
              <KitchenItemCard key={item.id} item={item} tone={item.priority ? "priority" : "ordered"} now={now}>
                <Button
                  type="button"
                  className="min-h-11 w-full text-sm sm:text-base"
                  disabled={updating === item.id}
                  onClick={() => void markReady(item.id)}
                >
                  {updating === item.id && <Loader2 className="animate-spin" />}
                  Mark ready
                </Button>
              </KitchenItemCard>
            ))
          )}
        </QueueColumn>

        <QueueColumn title="Ready food" count={readyFood.length}>
          {readyFood.length === 0 ? (
            <EmptyQueue message="No food waiting to be served" />
          ) : (
            readyFood.map((item) => (
              <KitchenItemCard key={item.id} item={item} tone="ready" now={now}>
                <div className="flex min-h-11 items-center justify-center rounded-md border border-orange-300 bg-white/60 px-3 text-center text-sm font-semibold text-orange-950">
                  {item.status === "READY_POOL" ? "Available / Unassigned" : `Ready since ${formatTime(item.readyAt)}`}
                </div>
              </KitchenItemCard>
            ))
          )}
        </QueueColumn>
      </main>
    </div>
  );
}

function LegendSwatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded-sm border border-black/10", className)} aria-hidden="true" />
      {label}
    </span>
  );
}

function QueueColumn({
  title,
  count,
  priorityCount,
  children,
}: {
  title: string;
  count: number;
  priorityCount?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-xl border bg-card p-3 shadow-sm sm:p-4" aria-label={title}>
      <div className="mb-3 flex min-h-9 items-center justify-between gap-3">
        <h2 className="text-lg font-bold sm:text-xl">{title}</h2>
        <div className="flex items-center gap-2">
          {!!priorityCount && <Badge className="border-transparent bg-blue-600 text-white">{priorityCount} priority</Badge>}
          <Badge variant="secondary" className="min-w-8 justify-center text-sm">
            {count}
          </Badge>
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function EmptyQueue({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-12 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

const ITEM_TONE = {
  ordered: "border-yellow-400 bg-yellow-100 text-yellow-950",
  priority: "border-blue-500 bg-blue-100 text-blue-950",
  ready: "border-orange-400 bg-orange-100 text-orange-950",
} as const;

function KitchenItemCard({
  item,
  tone,
  now,
  children,
}: {
  item: QueueItem;
  tone: keyof typeof ITEM_TONE;
  now: number;
  children: React.ReactNode;
}) {
  const isUnassigned = item.status === "READY_POOL";

  return (
    <article className={cn("relative rounded-xl border-2 p-3 shadow-sm sm:p-4", ITEM_TONE[tone])}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-slate-900 text-white">
            {isUnassigned ? "UNASSIGNED" : item.tableName ?? "TAKEAWAY"}
          </Badge>
          {item.priority && tone === "priority" && (
            <Badge className="border-transparent bg-blue-600 text-white">PRIORITY</Badge>
          )}
          {isUnassigned && <Badge className="border-orange-400 bg-white/70 text-orange-950">AVAILABLE</Badge>}
        </div>
        <span className="text-xs font-semibold opacity-75">{item.orderNumber}</span>
      </div>

      <h3 className="mt-3 text-lg font-extrabold leading-tight sm:text-xl">
        {item.quantity}× {item.name}
      </h3>

      {item.addons?.length > 0 && (
        <p className="mt-2 text-sm font-medium">
          {item.addons.map((addon) => `+ ${addon.quantity}× ${addon.name}`).join(" · ")}
        </p>
      )}

      {item.note && (
        <p className="mt-2 rounded-md border border-current/20 bg-white/60 px-2.5 py-2 text-sm font-semibold">
          Note: {item.note}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs font-medium opacity-80">
        <span className="inline-flex items-center gap-1">
          <Clock3 className="h-3.5 w-3.5" />
          {elapsedWait(item.createdAt, now)}
        </span>
        <span>Ordered {formatTime(item.createdAt)}</span>
      </div>

      <div className="mt-3">{children}</div>
    </article>
  );
}
