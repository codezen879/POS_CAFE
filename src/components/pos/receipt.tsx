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

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildReceiptHtml(bill: ReceiptBill, store: any): string {
  const lines = bill.session?.orders?.flatMap((o) => o.items) ?? [];
  const rows: string[] = [];

  rows.push(`<div class="text-center">
    <div class="store">${esc(store?.name || "POS Cafe")}</div>
    <div class="sub">${esc(store?.address || "")}</div>
    <div class="sub">${esc(store?.city || "")} · GSTIN ${esc(store?.gstin || "")}</div>
    <div class="sub mt1">Phone ${esc(store?.phone || "")}</div>
  </div>`);

  rows.push(`<div class="sep"></div>`);

  rows.push(`<div class="meta">
    <div class="row"><span>Bill No.</span><span>${esc(bill.billNumber)}</span></div>
    <div class="row"><span>Session</span><span>${esc(bill.session?.sessionNumber || "")}</span></div>
    ${bill.session?.table ? `<div class="row"><span>Table</span><span>${esc(bill.session.table.tableName)}</span></div>` : ""}
    <div class="row"><span>Date</span><span>${esc(formatDateTime(bill.paidAt || new Date()))}</span></div>
    ${bill.session?.customer?.name ? `<div class="row"><span>Customer</span><span>${esc(bill.session.customer.name)}</span></div>` : ""}
  </div>`);

  rows.push(`<div class="sep"></div>`);

  rows.push(`<div class="items-title">ITEMS</div>`);
  for (const l of lines) {
    rows.push(`<div class="mt1">
      <div class="row"><span class="med">${esc(l.name)} ×${esc(l.quantity)}</span><span>${esc(formatCurrency(Number(l.unitPrice) * l.quantity))}</span></div>
      ${(l.addons || []).map((a) => `<div class="row addon"><span>${esc(a.name)} ×${esc(a.quantity)}</span><span>${esc(formatCurrency(Number(a.price) * a.quantity))}</span></div>`).join("")}
    </div>`);
  }

  rows.push(`<div class="sep"></div>`);

  const totals = [`<div class="row"><span>Subtotal</span><span>${esc(formatCurrency(bill.subtotal))}</span></div>`];
  if (Number(bill.discountAmount) > 0) totals.push(`<div class="row"><span>Discount</span><span>-${esc(formatCurrency(bill.discountAmount))}</span></div>`);
  for (const t of bill.taxLines || []) totals.push(`<div class="row"><span>${esc(t.taxCode)} (${esc(t.rate)}%)</span><span>${esc(formatCurrency(t.taxAmount))}</span></div>`);
  if (Number(bill.serviceCharge) > 0) totals.push(`<div class="row"><span>Service Charge</span><span>${esc(formatCurrency(bill.serviceCharge))}</span></div>`);
  totals.push(`<div class="row total"><span>TOTAL</span><span>${esc(formatCurrency(bill.total))}</span></div>`);
  totals.push(`<div class="row sub"><span>Paid</span><span>${esc(formatCurrency(bill.paidAmount))}</span></div>`);
  rows.push(`<div>${totals.join("")}</div>`);

  rows.push(`<div class="sep"></div>`);
  rows.push(`<div class="center med">Thank you for visiting!</div>`);
  rows.push(`<div class="center sub2">Powered by POS Cafe</div>`);

  return rows.join("\n");
}

const PRINT_CSS = `
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; font-size: 11px; line-height: 1.45; color: #000; width: 80mm; margin: 0 auto; padding: 2mm; }
  .store { font-size: 15px; font-weight: 700; }
  .sub { color: #444; font-size: 10px; }
  .sub2 { color: #666; font-size: 9px; }
  .mt1 { margin-top: 2px; }
  .sep { border-top: 1px dashed #444; margin: 6px 0; }
  .meta { font-size: 11px; }
  .row { display: flex; justify-content: space-between; font-size: 11px; }
  .row.total { border-top: 1px dashed #444; margin-top: 2px; padding-top: 3px; font-size: 13px; font-weight: 700; }
  .row.sub { color: #444; font-size: 10px; }
  .row.addon { padding-left: 10px; color: #444; font-size: 10px; }
  .med { font-weight: 600; }
  .items-title { font-weight: 700; }
  .center { text-align: center; }
  @page { size: 80mm auto; margin: 4mm; }
`;

export function printReceipt(bill: ReceiptBill, store: any) {
  const doc = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Receipt ${esc(bill.billNumber)}</title><style>${PRINT_CSS}</style></head><body>${buildReceiptHtml(bill, store)}</body></html>`;
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const content = iframe.contentDocument;
  if (content) {
    content.open();
    content.write(doc);
    content.close();
  }
  const cleanup = () => {
    setTimeout(() => iframe.remove(), 500);
  };
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      cleanup();
    }, 250);
  };
  setTimeout(() => {
    if (iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      cleanup();
    }
  }, 500);
}

export function Receipt({ bill, store, onDone }: { bill: ReceiptBill; store: any; onDone: () => void }) {
  return (
    <div className="mx-auto max-w-sm">
      <div id="receipt-print" className="rounded-xl border bg-white p-5 text-black shadow-sm" dangerouslySetInnerHTML={{ __html: buildReceiptHtml(bill, store) }} />

      <div className="mt-4 flex gap-2">
        <Button className="flex-1" onClick={() => printReceipt(bill, store)}>
          <Printer className="h-4 w-4" /> Print
        </Button>
        <Button variant="outline" className="flex-1" onClick={onDone}>
          <CheckCheck className="h-4 w-4" /> Done
        </Button>
      </div>
    </div>
  );
}