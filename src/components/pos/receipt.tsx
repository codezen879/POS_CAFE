"use client";

import { CheckCheck, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDateTime } from "@/lib/utils";

type MoneyValue = number | string;

type ReceiptAddon = {
  name: string;
  price: MoneyValue;
  quantity: number;
};

type ReceiptItem = {
  name: string;
  unitPrice: MoneyValue;
  quantity: number;
  note?: string | null;
  addons?: ReceiptAddon[];
};

type ReceiptOrder = {
  orderNumber: string;
  placedAt?: string | null;
  items?: ReceiptItem[];
};

type ReceiptPayment = {
  method: string;
  amount: MoneyValue;
  status?: string | null;
  transactionId?: string | null;
  paidAt?: string | null;
};

export type ReceiptBill = {
  billNumber: string;
  status: string;
  subtotal: MoneyValue;
  discountType?: string | null;
  discountValue?: MoneyValue | null;
  discountAmount: MoneyValue;
  taxTotal: MoneyValue;
  serviceCharge: MoneyValue;
  roundOff?: MoneyValue;
  total: MoneyValue;
  paidAmount: MoneyValue;
  dueAmount: MoneyValue;
  issuedAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
  taxLines?: {
    taxCode: string;
    rate: MoneyValue;
    baseAmount?: MoneyValue;
    taxAmount: MoneyValue;
  }[];
  payments?: ReceiptPayment[];
  session?: {
    sessionNumber: string;
    guestCount?: number;
    openedAt?: string | null;
    table?: { tableName: string } | null;
    customer?: {
      name: string | null;
      phone: string | null;
      loyaltyPoints?: number;
    } | null;
    orders?: ReceiptOrder[];
  };
};

type ReceiptStore = {
  name?: string | null;
  legalName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  currency?: string | null;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
} | null;

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "RECALCULATE",
  ISSUED: "AMOUNT DUE",
  PARTIALLY_PAID: "PART PAID",
  PAID: "PAID",
  VOID: "VOID",
  REFUNDED: "REFUNDED",
};

const STATUS_TONE: Record<string, string> = {
  DRAFT: "warning",
  ISSUED: "warning",
  PARTIALLY_PAID: "warning",
  PAID: "success",
  VOID: "danger",
  REFUNDED: "danger",
};

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function numeric(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value: unknown): string {
  return String(value ?? "").trim();
}

function labelize(value: unknown): string {
  return cleanText(value)
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactNumber(value: unknown): string {
  return numeric(value).toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

function storeMonogram(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  return initials || "PC";
}

function discountLabel(bill: ReceiptBill): string {
  if (bill.discountType === "PERCENTAGE" && numeric(bill.discountValue) > 0) {
    return `Discount (${compactNumber(bill.discountValue)}%)`;
  }
  return "Discount";
}

export function buildReceiptHtml(bill: ReceiptBill, store: ReceiptStore): string {
  const storeName = cleanText(store?.name) || "POS Cafe";
  const legalName = cleanText(store?.legalName);
  const address = [cleanText(store?.address), cleanText(store?.city), cleanText(store?.state)]
    .filter(Boolean)
    .join(", ");
  const currency = cleanText(store?.currency) || "INR";
  const money = (value: unknown) => formatCurrency(numeric(value), currency);
  const status = cleanText(bill.status).toUpperCase() || "ISSUED";
  const statusLabel = STATUS_LABEL[status] ?? labelize(status).toUpperCase();
  const statusTone = STATUS_TONE[status] ?? "neutral";
  const issuedAt = bill.issuedAt || bill.createdAt || null;
  const orders = bill.session?.orders ?? [];
  const allItems = orders.flatMap((order) => order.items ?? []);
  const totalQuantity = allItems.reduce((sum, item) => sum + numeric(item.quantity), 0);
  const customerName = cleanText(bill.session?.customer?.name);
  const customerPhone = cleanText(bill.session?.customer?.phone);
  const completedPayments = (bill.payments ?? []).filter(
    (payment) => !payment.status || payment.status === "COMPLETED"
  );

  const contactParts = [
    cleanText(store?.phone) ? `Phone: ${esc(store?.phone)}` : "",
    cleanText(store?.email) ? esc(store?.email) : "",
  ].filter(Boolean);

  const itemRows: string[] = [];
  let lineNumber = 0;
  for (const order of orders) {
    const orderItems = order.items ?? [];
    if (orders.length > 1 && orderItems.length > 0) {
      itemRows.push(
        `<tr class="pos-receipt__ticket-row"><td colspan="5">Ticket ${esc(order.orderNumber)}</td></tr>`
      );
    }

    for (const item of orderItems) {
      lineNumber += 1;
      const quantity = numeric(item.quantity);
      const rate = numeric(item.unitPrice);
      itemRows.push(`<tr class="pos-receipt__item-row">
        <td class="pos-receipt__serial">${lineNumber}</td>
        <td class="pos-receipt__item-name">
          <strong>${esc(item.name)}</strong>
          ${item.note ? `<small>Note: ${esc(item.note)}</small>` : ""}
        </td>
        <td class="pos-receipt__number">${esc(compactNumber(quantity))}</td>
        <td class="pos-receipt__number">${esc(money(rate))}</td>
        <td class="pos-receipt__number pos-receipt__line-total">${esc(money(rate * quantity))}</td>
      </tr>`);

      for (const addon of item.addons ?? []) {
        const addonQuantity = numeric(addon.quantity) * quantity;
        const addonRate = numeric(addon.price);
        itemRows.push(`<tr class="pos-receipt__addon-row">
          <td></td>
          <td class="pos-receipt__item-name">+ ${esc(addon.name)}</td>
          <td class="pos-receipt__number">${esc(compactNumber(addonQuantity))}</td>
          <td class="pos-receipt__number">${esc(money(addonRate))}</td>
          <td class="pos-receipt__number">${esc(money(addonRate * addonQuantity))}</td>
        </tr>`);
      }
    }
  }

  if (itemRows.length === 0) {
    itemRows.push(
      '<tr><td colspan="5" class="pos-receipt__empty">No billable items</td></tr>'
    );
  }

  const summaryRows: string[] = [
    `<div class="pos-receipt__summary-row"><span>Subtotal</span><strong>${esc(money(bill.subtotal))}</strong></div>`,
  ];
  if (numeric(bill.discountAmount) > 0) {
    summaryRows.push(
      `<div class="pos-receipt__summary-row pos-receipt__discount"><span>${esc(discountLabel(bill))}</span><strong>− ${esc(money(bill.discountAmount))}</strong></div>`
    );
  }
  for (const tax of bill.taxLines ?? []) {
    summaryRows.push(
      `<div class="pos-receipt__summary-row"><span>${esc(tax.taxCode)} (${esc(compactNumber(tax.rate))}%)</span><strong>${esc(money(tax.taxAmount))}</strong></div>`
    );
  }
  if ((bill.taxLines ?? []).length === 0 && numeric(bill.taxTotal) > 0) {
    summaryRows.push(
      `<div class="pos-receipt__summary-row"><span>Tax</span><strong>${esc(money(bill.taxTotal))}</strong></div>`
    );
  }
  if (numeric(bill.serviceCharge) !== 0) {
    summaryRows.push(
      `<div class="pos-receipt__summary-row"><span>Service charge</span><strong>${esc(money(bill.serviceCharge))}</strong></div>`
    );
  }
  if (numeric(bill.roundOff) !== 0) {
    summaryRows.push(
      `<div class="pos-receipt__summary-row"><span>Round off</span><strong>${esc(money(bill.roundOff))}</strong></div>`
    );
  }

  const paymentRows = completedPayments.map((payment) => {
    const reference = cleanText(payment.transactionId);
    return `<div class="pos-receipt__payment-row">
      <span>
        <strong>${esc(labelize(payment.method))}</strong>
        ${reference ? `<small>Ref: ${esc(reference)}</small>` : ""}
      </span>
      <strong>${esc(money(payment.amount))}</strong>
    </div>`;
  });

  const guestCount = numeric(bill.session?.guestCount);
  const metaCells: [string, unknown][] = [
    ["Bill number", bill.billNumber],
    ["Issued", formatDateTime(issuedAt)],
    ["Table", bill.session?.table?.tableName || "Takeaway"],
    ["Session", bill.session?.sessionNumber || "—"],
    ...(guestCount > 0 ? [["Guests", compactNumber(guestCount)] as [string, unknown]] : []),
  ];

  return `<article class="pos-receipt" aria-label="Bill ${esc(bill.billNumber)}">
    <header class="pos-receipt__header">
      <div class="pos-receipt__monogram" aria-hidden="true">${esc(storeMonogram(storeName))}</div>
      <h1>${esc(storeName)}</h1>
      ${legalName && legalName !== storeName ? `<p class="pos-receipt__legal">${esc(legalName)}</p>` : ""}
      ${address ? `<p class="pos-receipt__address">${esc(address)}</p>` : ""}
      ${contactParts.length ? `<p class="pos-receipt__contact">${contactParts.join("<span aria-hidden=\"true\"> · </span>")}</p>` : ""}
      ${cleanText(store?.gstin) ? `<p class="pos-receipt__gst">GSTIN: ${esc(store?.gstin)}</p>` : ""}
    </header>

    <div class="pos-receipt__document-row">
      <span class="pos-receipt__document-title">BILL / RECEIPT</span>
      <span class="pos-receipt__status pos-receipt__status--${statusTone}">${esc(statusLabel)}</span>
    </div>

    <section class="pos-receipt__meta" aria-label="Bill details">
      ${metaCells.map(([label, value]) => `<div class="pos-receipt__meta-cell">
        <span>${esc(label)}</span><strong>${esc(value)}</strong>
      </div>`).join("")}
    </section>

    ${customerName || customerPhone ? `<section class="pos-receipt__customer">
      <span>Customer</span>
      <strong>${esc(customerName || "Walk-in customer")}</strong>
      ${customerPhone ? `<small>${esc(customerPhone)}</small>` : ""}
    </section>` : ""}

    <section class="pos-receipt__items" aria-label="Bill items">
      <div class="pos-receipt__section-heading">
        <strong>Order details</strong>
        <span>${allItems.length} line${allItems.length === 1 ? "" : "s"} · ${esc(compactNumber(totalQuantity))} item${totalQuantity === 1 ? "" : "s"}</span>
      </div>
      <table>
        <colgroup>
          <col class="pos-receipt__col-serial" /><col class="pos-receipt__col-item" />
          <col class="pos-receipt__col-qty" /><col class="pos-receipt__col-rate" />
          <col class="pos-receipt__col-amount" />
        </colgroup>
        <thead><tr><th>#</th><th>Item</th><th class="pos-receipt__number">Qty</th><th class="pos-receipt__number">Rate</th><th class="pos-receipt__number">Amount</th></tr></thead>
        <tbody>${itemRows.join("")}</tbody>
      </table>
    </section>

    <section class="pos-receipt__totals" aria-label="Bill totals">
      ${summaryRows.join("")}
      <div class="pos-receipt__grand-total"><span>Grand total</span><strong>${esc(money(bill.total))}</strong></div>
      <div class="pos-receipt__settlement">
        <div><span>Paid</span><strong>${esc(money(bill.paidAmount))}</strong></div>
        <div><span>Balance due</span><strong>${esc(money(bill.dueAmount))}</strong></div>
      </div>
    </section>

    ${paymentRows.length ? `<section class="pos-receipt__payments" aria-label="Payments">
      <div class="pos-receipt__section-heading"><strong>Payment details</strong></div>${paymentRows.join("")}
    </section>` : ""}

    <footer class="pos-receipt__footer">
      <strong>Thank you for dining with us!</strong>
      <span>This is a computer-generated bill.</span>
      <span>Powered by POS Cafe</span>
    </footer>
  </article>`;
}

const RECEIPT_CSS = `
  .pos-receipt, .pos-receipt * { box-sizing: border-box; }
  .pos-receipt { width: 100%; overflow: hidden; border: 1px solid #d8dde7; border-radius: 18px; background: linear-gradient(180deg, #fff 0%, #fcfcfa 100%); box-shadow: 0 20px 50px rgba(15,23,42,.12); color: #172033; font-family: Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; font-size: 12px; line-height: 1.45; padding: 24px; }
  .pos-receipt__header { text-align: center; }
  .pos-receipt__monogram { align-items: center; border: 2px solid #172033; border-radius: 12px; display: inline-flex; font-size: 12px; font-weight: 900; height: 38px; justify-content: center; letter-spacing: .08em; margin-bottom: 8px; width: 38px; }
  .pos-receipt__header h1 { font-size: 21px; font-weight: 900; letter-spacing: -.025em; line-height: 1.1; margin: 0; }
  .pos-receipt__legal,.pos-receipt__address,.pos-receipt__contact,.pos-receipt__gst { margin: 3px 0 0; }
  .pos-receipt__legal { color: #465268; font-size: 10px; font-weight: 700; }
  .pos-receipt__address,.pos-receipt__contact { color: #667085; font-size: 10px; overflow-wrap: anywhere; }
  .pos-receipt__gst { font-size: 10px; font-weight: 800; letter-spacing: .035em; }
  .pos-receipt__document-row { align-items: center; border-bottom: 1px dashed #aeb6c4; border-top: 1px dashed #aeb6c4; display: flex; gap: 10px; justify-content: space-between; margin-top: 16px; padding: 9px 0; }
  .pos-receipt__document-title { font-size: 11px; font-weight: 900; letter-spacing: .16em; }
  .pos-receipt__status { border: 1px solid #98a2b3; border-radius: 999px; font-size: 9px; font-weight: 900; letter-spacing: .07em; padding: 3px 8px; white-space: nowrap; }
  .pos-receipt__status--success { background: #e8f7ee; border-color: #83d4a2; color: #116332; }
  .pos-receipt__status--warning { background: #fff5d9; border-color: #e8bf5f; color: #7a4b00; }
  .pos-receipt__status--danger { background: #feecec; border-color: #eda0a0; color: #9a2222; }
  .pos-receipt__status--neutral { background: #eef1f5; color: #344054; }
  .pos-receipt__meta { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); margin-top: 10px; }
  .pos-receipt__meta-cell { border-bottom: 1px solid #edf0f4; min-width: 0; padding: 7px 8px 7px 0; }
  .pos-receipt__meta-cell:nth-child(even) { padding-left: 8px; padding-right: 0; text-align: right; }
  .pos-receipt__meta-cell span,.pos-receipt__customer>span { color: #7a8495; display: block; font-size: 8px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
  .pos-receipt__meta-cell strong { display: block; font-size: 10.5px; margin-top: 1px; overflow-wrap: anywhere; }
  .pos-receipt__customer { background: #f5f7fa; border-radius: 9px; margin-top: 9px; padding: 8px 10px; }
  .pos-receipt__customer strong { display: block; font-size: 11px; margin-top: 2px; }
  .pos-receipt__customer small { color: #667085; display: block; font-size: 9px; }
  .pos-receipt__items { margin-top: 15px; }
  .pos-receipt__section-heading { align-items: center; display: flex; gap: 8px; justify-content: space-between; margin-bottom: 6px; }
  .pos-receipt__section-heading>strong { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
  .pos-receipt__section-heading>span { color: #7a8495; font-size: 9px; }
  .pos-receipt table { border-collapse: collapse; table-layout: fixed; width: 100%; }
  .pos-receipt__col-serial { width: 6%; }.pos-receipt__col-item { width: 39%; }.pos-receipt__col-qty { width: 10%; }.pos-receipt__col-rate { width: 21%; }.pos-receipt__col-amount { width: 24%; }
  .pos-receipt th { border-bottom: 1.5px solid #172033; border-top: 1px solid #aeb6c4; color: #667085; font-size: 8px; letter-spacing: .05em; padding: 6px 2px; text-align: left; text-transform: uppercase; }
  .pos-receipt td { border-bottom: 1px dotted #cbd1db; padding: 7px 2px; vertical-align: top; }
  .pos-receipt__serial { color: #7a8495; }
  .pos-receipt__item-name { min-width: 0; overflow-wrap: anywhere; padding-right: 5px!important; }
  .pos-receipt__item-name strong { display: block; font-size: 10.5px; line-height: 1.3; }
  .pos-receipt__item-name small { color: #7a8495; display: block; font-size: 8px; font-style: italic; margin-top: 2px; }
  .pos-receipt__number { font-variant-numeric: tabular-nums; text-align: right!important; white-space: nowrap; }
  .pos-receipt__line-total { font-weight: 800; }
  .pos-receipt__ticket-row td { background: #f5f7fa; border-bottom-style: solid; color: #5c6678; font-size: 8px; font-weight: 900; letter-spacing: .06em; padding: 5px 6px; text-transform: uppercase; }
  .pos-receipt__addon-row td { color: #667085; font-size: 8.5px; padding-bottom: 5px; padding-top: 3px; }
  .pos-receipt__empty { color: #7a8495; padding: 20px!important; text-align: center; }
  .pos-receipt__totals { margin-left: auto; margin-top: 13px; width: 74%; }
  .pos-receipt__summary-row { align-items: baseline; display: flex; gap: 12px; justify-content: space-between; padding: 2px 0; }
  .pos-receipt__summary-row span { color: #667085; }.pos-receipt__summary-row strong { font-variant-numeric: tabular-nums; white-space: nowrap; }.pos-receipt__discount strong { color: #aa2e2e; }
  .pos-receipt__grand-total { align-items: center; background: #172033; border-radius: 9px; color: #fff; display: flex; gap: 12px; justify-content: space-between; margin-top: 7px; padding: 9px 10px; }
  .pos-receipt__grand-total span { font-size: 10px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }.pos-receipt__grand-total strong { font-size: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos-receipt__settlement { border-bottom: 1px dashed #aeb6c4; padding: 6px 2px 8px; }.pos-receipt__settlement>div { display: flex; justify-content: space-between; padding-top: 2px; }.pos-receipt__settlement span { color: #667085; }.pos-receipt__settlement strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos-receipt__payments { margin-top: 13px; }.pos-receipt__payment-row { align-items: flex-start; border-top: 1px dotted #cbd1db; display: flex; gap: 10px; justify-content: space-between; padding: 6px 0; }.pos-receipt__payment-row span>strong { display: block; font-size: 10px; }.pos-receipt__payment-row small { color: #7a8495; display: block; font-size: 8px; overflow-wrap: anywhere; }.pos-receipt__payment-row>strong { font-variant-numeric: tabular-nums; white-space: nowrap; }
  .pos-receipt__footer { align-items: center; border-top: 1px dashed #aeb6c4; display: flex; flex-direction: column; margin-top: 15px; padding-top: 12px; text-align: center; }.pos-receipt__footer strong { font-size: 11px; }.pos-receipt__footer span { color: #7a8495; font-size: 8px; margin-top: 2px; }
  @media (max-width:390px) { .pos-receipt { border-radius: 14px; padding: 17px 12px; }.pos-receipt__header h1 { font-size: 19px; }.pos-receipt__totals { width: 82%; }.pos-receipt__col-item { width: 37%; }.pos-receipt__col-rate { width: 22%; }.pos-receipt__col-amount { width: 25%; }.pos-receipt td { padding-left: 1px; padding-right: 1px; } }
  @media print { .pos-receipt { background:#fff; border:0; border-radius:0; box-shadow:none; color:#000; font-family:Arial,Helvetica,sans-serif; font-size:9.5px; padding:0; width:100%; }.pos-receipt__status,.pos-receipt__customer,.pos-receipt__ticket-row td { background:transparent!important; color:#000!important; }.pos-receipt__grand-total { background:transparent; border-bottom:2px solid #000; border-radius:0; border-top:2px solid #000; color:#000; padding-left:0; padding-right:0; }.pos-receipt__meta-cell span,.pos-receipt__customer>span,.pos-receipt__section-heading>span,.pos-receipt th,.pos-receipt__summary-row span,.pos-receipt__settlement span,.pos-receipt__footer span { color:#333; }.pos-receipt tr,.pos-receipt__payment-row,.pos-receipt__grand-total { break-inside:avoid; page-break-inside:avoid; } }
`;

const PRINT_DOCUMENT_CSS = `
  html,body { background:#fff; box-sizing:border-box; margin:0; padding:0; width:100%; }
  body { margin:0 auto; padding:3mm; }
  @page { margin:0; size:80mm auto; }
  ${RECEIPT_CSS}
`;

let activePrintFrame: HTMLIFrameElement | null = null;

export function printReceipt(bill: ReceiptBill, store: ReceiptStore) {
  if (activePrintFrame) return;

  const documentHtml = `<!DOCTYPE html><html lang="en-IN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Bill ${esc(bill.billNumber)}</title><style>${PRINT_DOCUMENT_CSS}</style></head><body>${buildReceiptHtml(bill, store)}</body></html>`;
  const iframe = document.createElement("iframe");
  const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  iframe.setAttribute("aria-hidden", "true");
  iframe.tabIndex = -1;
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.bottom = "0";
  iframe.style.width = "80mm";
  iframe.style.height = "1px";
  iframe.style.border = "0";
  iframe.style.opacity = "0";
  activePrintFrame = iframe;

  let printStarted = false;
  let fallbackTimer: number | undefined;
  let cleanupTimer: number | undefined;
  const cleanup = () => {
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    if (cleanupTimer !== undefined) window.clearTimeout(cleanupTimer);
    iframe.remove();
    if (activePrintFrame === iframe) activePrintFrame = null;
    previousFocus?.focus({ preventScroll: true });
  };
  const startPrint = async () => {
    if (printStarted || !iframe.contentWindow || !iframe.contentDocument) return;
    printStarted = true;
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    await iframe.contentDocument.fonts?.ready.catch(() => undefined);
    iframe.contentWindow.addEventListener("afterprint", cleanup, { once: true });
    iframe.contentWindow.requestAnimationFrame(() => {
      iframe.contentWindow?.requestAnimationFrame(() => {
        iframe.contentWindow?.focus();
        cleanupTimer = window.setTimeout(cleanup, 10_000);
        iframe.contentWindow?.print();
      });
    });
  };

  iframe.onload = () => void startPrint();
  iframe.srcdoc = documentHtml;
  fallbackTimer = window.setTimeout(() => void startPrint(), 1_500);
  document.body.appendChild(iframe);
}

export function Receipt({ bill, store, onDone, showActions = true }: {
  bill: ReceiptBill;
  store: ReceiptStore;
  onDone?: () => void;
  showActions?: boolean;
}) {
  return (
    <div className="mx-auto w-full min-w-0 max-w-[430px]">
      <style>{RECEIPT_CSS}</style>
      <div dangerouslySetInnerHTML={{ __html: buildReceiptHtml(bill, store) }} />
      {showActions && (
        <div className="mt-4 grid grid-cols-2 gap-2">
          <Button className="min-h-11" onClick={() => printReceipt(bill, store)}>
            <Printer className="h-4 w-4" /> Print bill
          </Button>
          {onDone && <Button variant="outline" className="min-h-11" onClick={onDone}>
            <CheckCheck className="h-4 w-4" /> Done
          </Button>}
        </div>
      )}
    </div>
  );
}
