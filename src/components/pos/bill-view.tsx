"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Printer, CheckCircle2, Banknote, QrCode, CreditCard, Star, Gift } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { printReceipt, Receipt } from "./receipt";
import toast from "react-hot-toast";

type BillType = {
  id: string;
  billNumber: string;
  status: string;
  subtotal: number;
  discountType?: string | null;
  discountValue?: number | null;
  discountAmount: number;
  taxTotal: number;
  serviceCharge: number;
  roundOff?: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  taxLines: { taxCode: string; rate: number; baseAmount: number; taxAmount: number }[];
  payments: any[];
  session?: {
    sessionNumber: string;
    guestCount?: number;
    customerId?: string | null;
    table?: { tableName: string } | null;
    customer?: { name: string | null; phone: string | null; loyaltyPoints: number } | null;
    orders?: { orderNumber: string; placedAt?: string | null; items: { name: string; unitPrice: number; quantity: number; note?: string | null; addons: { name: string; price: number; quantity: number }[] }[] }[];
  };
};

export function BillView({ sessionId, store, onChanged, onClose }: { sessionId: string; store: any; onChanged: () => void; onClose: () => void }) {
  const [bill, setBill] = useState<BillType | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [paying, setPaying] = useState(false);
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState<number>(0);
  const [showReceipt, setShowReceipt] = useState(false);
  const [discountType, setDiscountType] = useState<string | null>(null);
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const paymentAttemptRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const paymentInFlightRef = useRef(false);

  useEffect(() => {
    setAmount(Number(bill?.dueAmount ?? 0));
  }, [bill?.dueAmount]);

  useEffect(() => {
    if (!bill) return;
    setDiscountType(bill.discountType ?? null);
    setDiscountValue(Number(bill.discountValue ?? 0));
  }, [bill?.id, bill?.discountType, bill?.discountValue]);

  async function loadBill(): Promise<BillType | null> {
    const res = await fetch(`/api/pos/sessions/${sessionId}/bill-detailed`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to refresh bill");
    const refreshedBill = (data.bill ?? null) as BillType | null;
    if (refreshedBill) setBill(refreshedBill);
    return refreshedBill;
  }

  useEffect(() => {
    void loadBill().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Failed to refresh bill");
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  async function generateBill() {
    setGenerating(true);
    try {
      const res = await fetch(`/api/pos/sessions/${sessionId}/bill`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          discountType,
          discountValue: discountType ? discountValue : 0,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to generate bill");
      setBill(data.bill);
      onChanged();
      toast.success("Bill generated");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(false);
    }
  }

  async function pay() {
    if (!bill || amount <= 0 || paymentInFlightRef.current) return;
    const fingerprint = `${bill.id}:${method}:${amount.toFixed(2)}`;
    if (paymentAttemptRef.current?.fingerprint !== fingerprint) {
      paymentAttemptRef.current = { fingerprint, key: crypto.randomUUID() };
    }
    const idempotencyKey = paymentAttemptRef.current.key;
    paymentInFlightRef.current = true;
    setPaying(true);
    try {
      const res = await fetch(`/api/pos/bills/${bill.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, amount, idempotencyKey }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setBill((b) =>
        b
          ? {
              ...b,
              paidAmount: data.bill.paidAmount,
              dueAmount: data.bill.dueAmount,
              status: data.bill.status,
              payments: (b.payments || []).some((payment) => payment.id === data.payment.id)
                ? b.payments
                : [...(b.payments || []), data.payment],
            }
          : b
      );
      if (paymentAttemptRef.current?.key === idempotencyKey) paymentAttemptRef.current = null;
      onChanged();
      if (data.settled) {
        toast.success("Payment complete");
        setShowReceipt(true);
      } else {
        toast.success("Payment received");
        setAmount(Number(data.bill.dueAmount));
      }
    } catch (e: any) {
      // The response may have been lost after a successful commit. Reconcile
      // against the persisted idempotency key before deciding whether this
      // attempt must be retried. Once committed, clear the key so a later
      // equal-sized split payment receives a fresh identity.
      const refreshedBill = await loadBill().catch(() => null);
      const committed = refreshedBill?.payments?.some(
        (payment) =>
          payment.idempotencyKey === idempotencyKey &&
          payment.method === method &&
          Number(payment.amount) === amount
      );
      if (committed && refreshedBill) {
        if (paymentAttemptRef.current?.key === idempotencyKey) paymentAttemptRef.current = null;
        onChanged();
        if (refreshedBill.status === "PAID") {
          toast.success("Payment complete");
          setShowReceipt(true);
        } else {
          toast.success("Payment received");
          setAmount(Number(refreshedBill.dueAmount));
        }
      } else {
        toast.error(e.message);
      }
    } finally {
      paymentInFlightRef.current = false;
      setPaying(false);
    }
  }

  const settled = bill?.status === "PAID";
  const currency = store?.currency || "INR";
  const money = (value: number) => formatCurrency(value, currency);
  const applyRedemption = (value: number) => {
    setDiscountType("FIXED");
    setDiscountValue(value);
    setRedeemOpen(false);
    toast.success(`₹${value} discount set`);
  };

  if (!bill) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 sm:p-10">
        <div className="text-center">
          <div className="text-lg font-semibold">Generate Bill</div>
          <p className="text-sm text-muted-foreground">Compute the final bill for this session including GST.</p>
        </div>

        <div className="w-full max-w-sm space-y-3 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Discount</Label>
            <Button size="sm" variant="outline" onClick={() => setRedeemOpen(true)}>
              <Gift className="h-3.5 w-3.5" /> Redeem points
            </Button>
          </div>
          <div className="flex gap-2">
            <select
              value={discountType ?? ""}
              onChange={(e) => {
                const v = e.target.value;
                setDiscountType(v || null);
                setDiscountValue(0);
              }}
              className="rounded-md border bg-transparent px-3 py-2 text-sm"
            >
              <option value="">None</option>
              <option value="FIXED">₹ Flat</option>
              <option value="PERCENTAGE">% Off</option>
            </select>
            <Input
              type="number"
              min={0}
              max={discountType === "PERCENTAGE" ? 100 : undefined}
              step="0.01"
              inputMode="decimal"
              placeholder="Value"
              value={discountValue || ""}
              onChange={(e) => setDiscountValue(Number(e.target.value))}
              disabled={!discountType}
            />
          </div>
        </div>

        <Button className="min-h-11 w-full max-w-sm" onClick={generateBill} disabled={generating}>
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          Generate bill
        </Button>
        <RedeemDialog open={redeemOpen} onOpenChange={setRedeemOpen} onApplied={applyRedemption} />
      </div>
    );
  }

  if (showReceipt) {
    return (
      <div className="p-3 sm:p-8">
        <Receipt bill={bill} store={store} onDone={() => { setShowReceipt(false); onChanged(); }} />
        <div className="mx-auto mt-4 max-w-sm">
          <Button variant="outline" className="w-full" onClick={() => setReviewOpen(true)}>
            <Star className="h-4 w-4" /> This table left a review?
          </Button>
        </div>
        <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} customerId={bill.session?.customerId} />
      </div>
    );
  }

  if (bill.status === "DRAFT") {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-6 sm:p-10">
        <div className="max-w-md rounded-xl border border-amber-300 bg-amber-50 p-4 text-center text-amber-950">
          <div className="font-semibold">Bill needs recalculation</div>
          <p className="mt-1 text-sm">
            A served or returned item changed after this bill was prepared. Recalculate it before taking payment.
          </p>
        </div>
        <Button className="h-11 w-full max-w-sm" onClick={generateBill} disabled={generating}>
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          Recalculate bill
        </Button>
      </div>
    );
  }

  const methodButton = (m: string, label: string, Icon: any) => (
    <button
      type="button"
      key={m}
      onClick={() => setMethod(m)}
      aria-pressed={method === m}
      className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors ${method === m ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/15" : "text-muted-foreground hover:bg-accent"}`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );

  return (
    <div className="grid items-start gap-5 p-3 sm:p-6 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
      <div className="min-w-0">
        <Receipt bill={bill} store={store} showActions={false} />
      </div>

      <aside className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm sm:p-5 lg:sticky lg:top-0" aria-label="Payment controls">
        <div className="flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <h3 className="font-bold">Payment</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Bill {bill.billNumber}</p>
          </div>
          <span className="rounded-full bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide">
            {bill.status.replaceAll("_", " ")}
          </span>
        </div>

        {settled ? (
          <div className="flex items-center gap-3 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-800">
            <CheckCircle2 className="h-6 w-6 shrink-0" />
            <div>
              <div className="font-bold">Paid in full</div>
              <div className="text-xs">Received {money(Number(bill.paidAmount))}</div>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl bg-primary/5 p-4 text-center">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Balance due</div>
              <div className="mt-1 text-3xl font-black tracking-tight text-primary">{money(Number(bill.dueAmount))}</div>
            </div>

            <div>
              <Label>Payment method</Label>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                {methodButton("CASH", "Cash", Banknote)}
                {methodButton("UPI", "UPI", QrCode)}
                {methodButton("CARD", "Card", CreditCard)}
                {methodButton("SPLIT", "Split", Banknote)}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Amount to receive</Label>
              <Input
                type="number"
                min={0.01}
                max={Number(bill.dueAmount)}
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value))}
              />
            </div>
            <Button className="min-h-12 w-full text-base" size="lg" onClick={pay} disabled={paying || amount <= 0 || amount > Number(bill.dueAmount)}>
              {paying && <Loader2 className="h-4 w-4 animate-spin" />}
              Receive {money(amount)}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Split payments are supported. The bill updates after every payment.
            </p>
          </>
        )}

        <Button variant="outline" className="min-h-11 w-full" onClick={() => printReceipt(bill, store)}>
          <Printer className="h-4 w-4" /> {settled ? "Print receipt" : "Print bill"}
        </Button>

        {settled && (
          <Button className="min-h-11 w-full" onClick={() => { onChanged(); onClose(); }}>
            Close & finish
          </Button>
        )}
      </aside>

      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        onApplied={applyRedemption}
      />
      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} customerId={bill.session?.customerId} />
    </div>
  );
}

function RedeemDialog({ open, onOpenChange, onApplied }: { open: boolean; onOpenChange: (o: boolean) => void; onApplied: (cashValue: number) => void }) {
  const [phone, setPhone] = useState("");
  const [points, setPoints] = useState<number>(0);
  const [info, setInfo] = useState<string>("");
  const [loading, setLoading] = useState(false);

  async function lookup(phoneNumber: string) {
    const res = await fetch(`/api/customers/find?phone=${encodeURIComponent(phoneNumber)}`);
    const data = await res.json();
    if (data.customer) setInfo(`Balance: ${data.customer.loyaltyPoints} pts`);
    else { setInfo("No customer found"); setPoints(0); }
  }

  async function redeem() {
    setLoading(true);
    try {
      const customerId = await phoneId(phone);
      const res = await fetch(`/api/customers/${customerId}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ points }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Redemption failed");
      setInfo(data.message);
      onApplied(data.cashValue);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function phoneId(phoneNumber: string) {
    const res = await fetch(`/api/customers/find?phone=${encodeURIComponent(phoneNumber)}`);
    const data = await res.json();
    if (!data.customer) throw new Error("Customer not found");
    return data.customer.id;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Gift className="h-4 w-4" /> Redeem loyalty points</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">100 points = ₹1. Redeemed points become a flat discount on this bill.</p>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label>Customer phone</Label>
            <Input value={phone} onChange={(e) => { setPhone(e.target.value); }} onBlur={(e) => lookup(e.target.value)} placeholder="+91..." />
          </div>
          {info && <div className="text-xs text-muted-foreground">{info}</div>}
          <div className="space-y-1">
            <Label>Points to redeem</Label>
            <Input type="number" value={points || ""} onChange={(e) => setPoints(Number(e.target.value))} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={redeem} disabled={loading || !points}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />} Redeem
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewDialog({ open, onOpenChange, customerId }: { open: boolean; onOpenChange: (o: boolean) => void; customerId?: string | null }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit() {
    if (!rating) { toast.error("Pick a rating"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, rating, comment }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Thanks for the review!");
      setRating(0); setComment("");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Star className="h-4 w-4" /> Rate your experience</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex justify-center gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setRating(n)}>
                <Star className={`h-8 w-8 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
              </button>
            ))}
          </div>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Add a comment (optional)"
            className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
            rows={3}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Skip</Button>
          <Button onClick={submit} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Submit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
