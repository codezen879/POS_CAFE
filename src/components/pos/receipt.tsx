"use client";

import { Printer, CheckCheck } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type ReceiptBill = {
  billNumber: string;
  status: string;
  subtotal: number;
  discountAmount: number;
  taxTotal: number;
  serviceCharge: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  paidAt?: string | null;
  taxLines: { taxCode: string; rate: number; taxAmount: number }[];
  session?: {
    sessionNumber: string;
    table?: { tableName: string } | null;
    customer?: { name: string | null; phone: string | null; loyaltyPoints: number } | null;
    orders?: { orderNumber: string; items: { name: string; unitPrice: number; quantity: number; addons: { name: string; price: number; quantity: number }[] }[] }[];
  };
};

export function Receipt({ bill, store, onDone }: { bill: ReceiptBill; store: any; onDone: () => void }) {
  const lines = bill.session?.orders?.flatMap((o) => o.items) ?? [];

  return (
    <div className="mx-auto max-w-sm">
      <div id="receipt-print" className="rounded-xl border bg-white p-5 text-black shadow-sm">
        <div className="text-center">
          <div className="text-lg font-bold">{store?.name || "POS Cafe"}</div>
          <div className="text-xs text-neutral-600">{store?.address}</div>
          <div className="text-xs text-neutral-600">{store?.city} · GSTIN {store?.gstin}</div>
          <div className="mt-1 text-xs text-neutral-600">Phone {store?.phone}</div>
        </div>

        <div className="my-3 border-t border-dashed border-neutral-400" />

        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between"><span>Bill No.</span><span>{bill.billNumber}</span></div>
          <div className="flex justify-between"><span>Session</span><span>{bill.session?.sessionNumber}</span></div>
          {bill.session?.table && <div className="flex justify-between"><span>Table</span><span>{bill.session.table.tableName}</span></div>}
          <div className="flex justify-between"><span>Date</span><span>{formatDateTime(bill.paidAt || new Date())}</span></div>
          {bill.session?.customer?.name && (
            <div className="flex justify-between"><span>Customer</span><span>{bill.session.customer.name}</span></div>
          )}
        </div>

        <div className="my-3 border-t border-dashed border-neutral-400" />

        <div className="text-xs font-bold">ITEMS</div>
        {lines.map((l, i) => (
          <div key={i} className="mt-1">
            <div className="flex justify-between text-xs">
              <span className="font-medium">{l.name} ×{l.quantity}</span>
              <span>{formatCurrency(l.unitPrice * l.quantity)}</span>
            </div>
            {l.addons?.map((a, j) => (
              <div key={j} className="flex justify-between pl-3 text-[11px] text-neutral-600">
                <span>{a.name} ×{a.quantity}</span>
                <span>{formatCurrency(a.price * a.quantity)}</span>
              </div>
            ))}
          </div>
        ))}

        <div className="my-3 border-t border-dashed border-neutral-400" />

        <div className="space-y-0.5 text-xs">
          <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(bill.subtotal)}</span></div>
          {bill.discountAmount > 0 && (
            <div className="flex justify-between"><span>Discount</span><span>-{formatCurrency(bill.discountAmount)}</span></div>
          )}
          {bill.taxLines.map((t, i) => (
            <div key={i} className="flex justify-between"><span>{t.taxCode} ({t.rate}%)</span><span>{formatCurrency(t.taxAmount)}</span></div>
          ))}
          {bill.serviceCharge > 0 && <div className="flex justify-between"><span>Service Charge</span><span>{formatCurrency(bill.serviceCharge)}</span></div>}
        </div>

        <div className="mt-2 flex justify-between border-t border-dashed border-neutral-400 pt-2 text-sm font-bold">
          <span>TOTAL</span><span>{formatCurrency(bill.total)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-neutral-600">
          <span>Paid</span><span>{formatCurrency(bill.paidAmount)}</span>
        </div>

        <div className="my-3 border-t border-dashed border-neutral-400" />
        <div className="text-center text-sm font-medium">Thank you for visiting!</div>
        <div className="text-center text-[11px] text-neutral-500">Powered by POS Cafe</div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button variant="outline" className="flex-1" onClick={onDone}>
          <CheckCheck className="h-4 w-4" /> Done
        </Button>
      </div>

      <style>{`
        @media print {
          body * { visibility: hidden; }
          #receipt-print, #receipt-print * { visibility: visible; }
          #receipt-print { position: absolute; left: 0; top: 0; width: 80mm; border: none; box-shadow: none; }
        }
      `}</style>
    </div>
  );
}
