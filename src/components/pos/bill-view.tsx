"use client";

import { useEffect, useState } from "react";
import { Loader2, Printer, CheckCircle2, Banknote, QrCode, CreditCard, Tag, Star, Gift } from "lucide-react";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Receipt } from "./receipt";
import toast from "react-hot-toast";
import { useRouter } from "next/navigation";

type BillType = {
  id: string;
  billNumber: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  taxLines: { taxCode: string; rate: number; baseAmount: number; taxAmount: number }[];
  payments: any[];
  session?: {
    sessionNumber: string;
    customerId?: string | null;
    table?: { tableName: string } | null;
    customer?: { name: string | null; phone: string | null; loyaltyPoints: number } | null;
    orders?: { orderNumber: string; items: { name: string; unitPrice: number; quantity: number; addons: { name: string; price: number; quantity: number }[] }[] }[];
  };
};

export function BillView({ sessionId, store, onChanged, onClose }: { sessionId: string; store: any; onChanged: () => void; onClose: () => void }) {
  const router = useRouter();
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

  useEffect(() => {
    setAmount(bill?.dueAmount ?? 0);
  }, [bill?.dueAmount]);

  async function loadBill() {
    const res = await fetch(`/api/pos/sessions/${sessionId}/bill-detailed`);
    const data = await res.json();
    if (data.bill) setBill(data.bill);
  }

  useEffect(() => {
    loadBill();
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
    if (!bill) return;
    setPaying(true);
    try {
      const res = await fetch(`/api/pos/bills/${bill.id}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, amount }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Payment failed");
      setBill((b) => (b ? { ...b, paidAmount: data.bill.paidAmount, dueAmount: data.bill.dueAmount, status: data.bill.status, payments: [...(b.payments || []), data.payment] } : b));
      onChanged();
      if (data.settled) {
        toast.success("Payment complete");
        setShowReceipt(true);
      } else {
        toast.success("Payment received");
        setAmount(data.bill.dueAmount);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setPaying(false);
    }
  }

  const settled = bill?.status === "PAID";

  if (!bill) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-10">
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
              placeholder="Value"
              value={discountValue || ""}
              onChange={(e) => setDiscountValue(Number(e.target.value))}
              disabled={!discountType}
            />
          </div>
        </div>

        <Button onClick={generateBill} disabled={generating}>
          {generating && <Loader2 className="h-4 w-4 animate-spin" />}
          Generate bill
        </Button>
      </div>
    );
  }

  if (showReceipt) {
    return (
      <div className="p-8">
        <Receipt bill={bill} store={store} onDone={() => { setShowReceipt(false); onChanged(); }} />
        <div className="mx-auto mt-4 max-w-sm">
          <Button variant="outline" className="w-full" onClick={() => setReviewOpen(true)}>
            <Star className="h-4 w-4" /> This table left a review?
          </Button>
        </div>
      </div>
    );
  }

  const methodButton = (m: string, label: string, Icon: any) => (
    <button
      key={m}
      onClick={() => setMethod(m)}
      className={`flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium transition-colors ${method === m ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );

  return (
    <div className="grid gap-6 p-6 md:grid-cols-2">
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Bill {bill.billNumber}</h3>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-xs capitalize">{bill.status.toLowerCase()}</span>
        </div>
        <div className="rounded-lg border">
          {[
            ["Subtotal", bill.subtotal],
            ["Discount", -bill.discountAmount],
            ["Service charge", bill.serviceCharge],
            ...(bill.taxLines.length ? bill.taxLines.map((t) => [`${t.taxCode} (${t.rate}%)`, t.taxAmount] as [string, number]) : []),
          ].map(([label, value]) => (
            <div key={label as string} className="flex items-center justify-between border-b px-4 py-2 last:border-0 text-sm">
              <span className="text-muted-foreground">{label}</span>
              <span className={Number(value) < 0 ? "text-destructive" : ""}>{formatCurrency(Number(value))}</span>
            </div>
          ))}
          <div className="flex items-center justify-between px-4 py-3 text-base font-bold">
            <span>Total</span>
            <span>{formatCurrency(bill.total)}</span>
          </div>
        </div>
        {settled && (
          <div className="flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-emerald-700">
            <CheckCircle2 className="h-5 w-5" /> Paid in full
          </div>
        )}
      </div>

      <div className="space-y-4">
        <div>
          <Label>Payment method</Label>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {methodButton("CASH", "Cash", Banknote)}
            {methodButton("UPI", "UPI", QrCode)}
            {methodButton("CARD", "Card", CreditCard)}
            {methodButton("SPLIT", "Split", Banknote)}
          </div>
        </div>

        {!settled && (
          <>
            <div className="space-y-2">
              <Label>Amount</Label>
              <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
            </div>
            <Button className="w-full" size="lg" onClick={pay} disabled={paying || amount <= 0 || amount > bill.dueAmount}>
              {paying && <Loader2 className="h-4 w-4 animate-spin" />}
              Receive {formatCurrency(amount)}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              Due: {formatCurrency(bill.dueAmount)} · Supports split payments
            </p>
          </>
        )}

        {settled && (
          <Button className="w-full" onClick={() => setShowReceipt(true)}>
            <Printer className="h-4 w-4" /> Print receipt
          </Button>
        )}

        {settled && (
          <Button variant="outline" className="w-full" onClick={() => { onChanged(); router.push("/"); }}>
            Close & finish
          </Button>
        )}
      </div>

      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        onApplied={(value) => {
          setDiscountType("FIXED");
          setDiscountValue(value);
          setRedeemOpen(false);
          toast.success(`₹${value} discount set`);
        }}
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
      const res = await fetch(`/api/customers/${phoneId(phone)}/redeem`, {
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
