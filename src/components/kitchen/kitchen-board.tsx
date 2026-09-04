"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { cn, formatTime, timeAgo } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type KdsItem = {
  id: string;
  orderNumber: string;
  status: string;
  sentToKitchenAt: string | null;
  prepStartedAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  session: { table: { tableName: string } | null } | null;
  items: { name: string; quantity: number; note: string | null; addons: { name: string; quantity: number }[] }[];
  orderedBy: { name: string | null } | null;
};

const COLUMNS: { status: string; label: string; color: string; next: string }[] = [
  { status: "SENT_TO_KITCHEN", label: "New", color: "border-sky-300 bg-sky-50", next: "PREPARING" },
  { status: "PREPARING", label: "Preparing", color: "border-amber-300 bg-amber-50", next: "READY" },
  { status: "READY", label: "Ready", color: "border-emerald-300 bg-emerald-50", next: "SERVED" },
  { status: "PARTIALLY_SERVED", label: "Serving", color: "border-violet-300 bg-violet-50", next: "SERVED" },
];

const NEXT_LABEL: Record<string, string> = {
  PREPARING: "Start prepping",
  READY: "Mark ready",
  SERVED: "Mark served",
};

export function KitchenBoard() {
  const [orders, setOrders] = useState<KdsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pos/kitchen/orders");
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 8000);
    return () => clearInterval(timer);
  }, [load]);

  async function advance(orderId: string, status: string) {
    setUpdating(orderId);
    try {
      const res = await fetch(`/api/pos/orders/${orderId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success(`Order ${status === "SERVED" ? "served" : "updated"}`);
      load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUpdating(null);
    }
  }

  if (loading) {
    return <div className="text-sm text-muted-foreground">Loading kitchen…</div>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kitchen Display</h1>
          <p className="text-sm text-muted-foreground">Live order queue · auto-refreshes</p>
        </div>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {COLUMNS.map((col) => {
          const list = orders.filter((o) => o.status === col.status);
          return (
            <div key={col.status} className="rounded-xl border p-3">
              <div className="mb-3 flex items-center justify-between">
                <span className="font-semibold">{col.label}</span>
                <Badge variant="secondary">{list.length}</Badge>
              </div>
              <div className="space-y-3">
                {list.length === 0 && (
                  <div className="py-8 text-center text-sm text-muted-foreground">No orders</div>
                )}
                {list.map((o) => (
                  <div key={o.id} className={cn("rounded-lg border-2 p-3", col.color)}>
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{o.orderNumber}</span>
                      <span className="text-xs">{o.session?.table?.tableName ?? "Takeaway"}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      {o.sentToKitchenAt && <>Placed {timeAgo(o.sentToKitchenAt)}</>}
                      {o.readyAt && <> · Ready {formatTime(o.readyAt)}</>}
                    </div>
                    <div className="mt-2 space-y-1">
                      {o.items.map((it, i) => (
                        <div key={i} className="text-sm">
                          <span className="font-medium">{it.quantity}× {it.name}</span>
                          {it.addons.length > 0 && (
                            <div className="pl-3 text-[11px] opacity-70">
                              {it.addons.map((a) => `+ ${a.name}×${a.quantity}`).join(", ")}
                            </div>
                          )}
                          {it.note && <div className="pl-3 text-[11px] italic text-destructive">“{it.note}”</div>}
                        </div>
                      ))}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      size="sm"
                      disabled={updating === o.id}
                      onClick={() => advance(o.id, col.next)}
                    >
                      {NEXT_LABEL[col.next] ?? col.next}
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}