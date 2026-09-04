"use client";

import { ReceiptText } from "lucide-react";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-slate-500", ISSUED: "bg-amber-500", PARTIALLY_PAID: "bg-violet-500",
  PAID: "bg-emerald-600", VOID: "bg-red-500", REFUNDED: "bg-red-500",
};

export function BillingList({ bills }: any) {
  const totalCollected = bills.filter((b: any) => b.status === "PAID").reduce((s: number, b: any) => s + Number(b.total), 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Billing</h1>
          <p className="text-sm text-muted-foreground">Recently collected: {formatCurrency(totalCollected)}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card">
        <div className="divide-y">
          {bills.length === 0 && <div className="p-6 text-center text-sm text-muted-foreground">No bills yet.</div>}
          {bills.map((b: any) => (
            <div key={b.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <ReceiptText className="h-4 w-4" />
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {b.billNumber}
                    <span className="text-sm font-normal text-muted-foreground">
                      {b.session?.table?.tableName ?? "—"}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDateTime(b.issuedAt || b.createdAt)} · {b.payments.length} payment{b.payments.length !== 1 ? "s" : ""}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="font-bold">{formatCurrency(b.total)}</span>
                <Badge className={cn("", STATUS_COLOR[b.status])}>{b.status.toLowerCase().replace(/_/g, " ")}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}