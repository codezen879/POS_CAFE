"use client";

import { useRouter } from "next/navigation";
import { cn, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const STATUSES = ["ALL", "DRAFT", "SENT_TO_KITCHEN", "PREPARING", "READY", "PARTIALLY_SERVED", "SERVED", "CANCELLED"];

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-slate-500", SENT_TO_KITCHEN: "bg-sky-500", PREPARING: "bg-amber-500",
  READY: "bg-emerald-500", PARTIALLY_SERVED: "bg-violet-500", SERVED: "bg-emerald-600", CANCELLED: "bg-red-500",
};

export function OrdersList({ orders, currentStatus }: any) {
  const router = useRouter();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Orders</h1>
      <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-thin">
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => router.push(`/orders?status=${s}`)}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-sm",
              currentStatus === s ? "bg-primary text-primary-foreground" : "bg-muted hover:bg-accent"
            )}
          >
            {s.replace(/_/g, " ").toLowerCase()}
          </button>
        ))}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="divide-y">
          {orders.length === 0 && (
            <div className="p-6 text-center text-sm text-muted-foreground">No orders found.</div>
          )}
          {orders.map((o: any) => (
            <div key={o.id} className="flex items-center justify-between gap-4 p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-semibold">{o.orderNumber}</span>
                  <Badge variant="outline" className="capitalize">{o.type.toLowerCase()}</Badge>
                  <span className="text-sm text-muted-foreground">
                    {o.session?.table?.tableName ?? "—"} · {o.orderedBy?.name ?? "—"} · {formatDateTime(o.placedAt)}
                  </span>
                </div>
                <div className="mt-1 line-clamp-1 text-sm text-muted-foreground">
                  {o.items.map((it: any) => `${it.quantity}× ${it.name}`).join(", ")}
                </div>
              </div>
              <Badge className={cn("shrink-0", STATUS_COLOR[o.status])}>
                {o.status.toLowerCase().replace(/_/g, " ")}
              </Badge>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}