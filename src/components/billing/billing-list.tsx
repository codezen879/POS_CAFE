"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ReceiptText, Eye, Ban, Loader2 } from "lucide-react";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Receipt } from "@/components/pos/receipt";
import toast from "react-hot-toast";

const STATUS_COLOR: Record<string, string> = {
  DRAFT: "bg-slate-500", ISSUED: "bg-amber-500", PARTIALLY_PAID: "bg-violet-500",
  PAID: "bg-emerald-600", VOID: "bg-red-500", REFUNDED: "bg-red-500",
};

const CANCELLABLE = ["DRAFT", "ISSUED", "PARTIALLY_PAID"];

export function BillingList({ bills, store }: any) {
  const router = useRouter();
  const [viewBill, setViewBill] = useState<any>(null);
  const [detail, setDetail] = useState<any>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const totalCollected = bills.filter((b: any) => b.status === "PAID").reduce((s: number, b: any) => s + Number(b.total), 0);

  async function openView(b: any) {
    setViewBill(b);
    setDetail(null);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/bills/${b.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load bill");
      setDetail(data.bill);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingDetail(false);
    }
  }

  async function cancelBill(id: string) {
    if (!window.confirm("Cancel this bill? This cannot be undone.")) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/bills/${id}`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to cancel bill");
      toast.success("Bill cancelled");
      setViewBill(null);
      setDetail(null);
      router.refresh();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setCancelling(false);
    }
  }

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
                <Button variant="outline" size="sm" onClick={() => openView(b)}>
                  <Eye className="h-3.5 w-3.5" /> View
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={!!viewBill} onOpenChange={(o) => { if (!o) { setViewBill(null); setDetail(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between">
              <span>Bill {viewBill?.billNumber}</span>
              {viewBill && (
                <Badge className={cn("", STATUS_COLOR[viewBill.status])}>
                  {viewBill.status.toLowerCase().replace(/_/g, " ")}
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>

          {loadingDetail && (
            <div className="flex items-center justify-center gap-2 p-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading bill…
            </div>
          )}

          {detail && !loadingDetail && (
            <>
              <Receipt bill={detail} store={store} onDone={() => { setViewBill(null); setDetail(null); }} />
              {CANCELLABLE.includes(viewBill?.status) && (
                <Button variant="destructive" className="mt-4" onClick={() => cancelBill(viewBill.id)} disabled={cancelling}>
                  {cancelling && <Loader2 className="h-4 w-4 animate-spin" />}
                  <Ban className="h-4 w-4" /> Cancel this bill
                </Button>
              )}
              {!CANCELLABLE.includes(viewBill?.status) && (
                <p className="mt-4 text-center text-xs text-muted-foreground">
                  {viewBill?.status === "PAID" ? "Paid bills cannot be cancelled." : "This bill is already cancelled."}
                </p>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}