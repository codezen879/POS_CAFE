"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import toast from "react-hot-toast";
import { QRCodeSVG } from "qrcode.react";
import { Smartphone, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { OpenTableDialog } from "./open-table-dialog";
import { TableTerminal } from "./table-terminal";
import { ManageTablesDialog } from "./manage-tables-dialog";

type TableType = {
  id: string;
  tableName: string;
  seatCount: number;
  status: string;
  floor: { name: string } | null;
  sessions: { id: string; sessionNumber: string; guestCount: number; customer: { name: string | null; phone: string | null; loyaltyPoints: number } | null; orders: { id: string; orderNumber: string; status: string; items: any[]; placedAt: string }[] }[];
};

const statusStyle: Record<string, string> = {
  AVAILABLE: "border-emerald-300 bg-emerald-50 text-emerald-700",
  OCCUPIED: "border-sky-300 bg-sky-50 text-sky-700",
  RESERVED: "border-amber-300 bg-amber-50 text-amber-700",
  CLEANING: "border-slate-300 bg-slate-100 text-slate-600",
  CLOSED: "border-slate-300 bg-slate-100 text-slate-600",
};

export function TableGrid({ tables, menu, store, customers, isManager }: { tables: TableType[]; menu: any[]; store: any; customers: any[]; isManager?: boolean }) {
  const router = useRouter();
  const [openDialog, setOpenDialog] = useState<TableType | null>(null);
  const [terminalTable, setTerminalTable] = useState<TableType | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrSel, setQrSel] = useState<string>("menu");
  const [manageOpen, setManageOpen] = useState(false);

  const occupiedCount = tables.filter((t) => t.status === "OCCUPIED").length;
  const openTables = tables.filter((t) => t.status === "OCCUPIED" && t.sessions[0]);
  const menuUrl = typeof window !== "undefined" ? `${window.location.origin}/m` : "/m";
  const qrValue = qrSel === "menu" ? menuUrl : `${menuUrl}?table=${qrSel}`;
  const qrLabel = qrSel === "menu" ? "Restaurant menu" : `Table ${openTables.find((t) => t.id === qrSel)?.tableName ?? ""}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-6 text-sm">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-emerald-400" /> Available
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-sky-400" /> Occupied ({occupiedCount})
          </span>
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-full bg-amber-400" /> Reserved
          </span>
        </div>
        <div className="flex gap-2">
          {isManager && (
            <Button variant="outline" size="sm" onClick={() => setManageOpen(true)}>
              <Settings2 className="h-4 w-4" /> Manage
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setQrOpen(true)}>
            <Smartphone className="h-4 w-4" /> Menu QR
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {tables.map((table) => {
          const occupied = table.status === "OCCUPIED";
          const openSession = table.sessions[0];
          return (
            <button
              key={table.id}
              onClick={() => {
                if (occupied && openSession) setTerminalTable(table);
                else setOpenDialog(table);
              }}
              className={cn(
                "group rounded-xl border-2 p-4 text-left transition-all hover:shadow-md",
                statusStyle[table.status] ?? "border-slate-300 bg-slate-50"
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold">{table.tableName}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-medium">
                  {table.seatCount} seats
                </span>
              </div>
              <div className="mt-3">
                {occupied && openSession ? (
                  <div className="space-y-1">
                    <div className="text-xs font-medium">{openSession.sessionNumber}</div>
                    <div className="text-xs opacity-80">{openSession.guestCount} guest{openSession.guestCount > 1 ? "s" : ""}</div>
                    <div className="text-xs opacity-80">{openSession.orders.length} order{openSession.orders.length > 1 ? "s" : ""}</div>
                    {openSession.customer?.name && <div className="text-xs font-medium">{openSession.customer.name}</div>}
                  </div>
                ) : (
                  <div className="text-xs opacity-80 capitalize">{table.status.toLowerCase()}</div>
                )}
              </div>
            </button>
          );
        })}
      </div>

      <OpenTableDialog
        open={!!openDialog}
        table={openDialog}
        customers={customers}
        onOpenChange={(o) => {
          if (!o) setOpenDialog(null);
        }}
        onSuccess={() => {
          setOpenDialog(null);
          router.refresh();
          toast.success("Table opened");
        }}
      />

      <TableTerminal table={terminalTable} menu={menu} store={store} onClose={() => setTerminalTable(null)} onChanged={() => router.refresh()} />

      <Dialog open={qrOpen} onOpenChange={setQrOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-center">Digital Menu</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4">
            <div className="flex flex-wrap justify-center gap-2">
              <button
                onClick={() => setQrSel("menu")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium",
                  qrSel === "menu" ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                Menu
              </button>
              {openTables.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setQrSel(t.id)}
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-medium",
                    qrSel === t.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {t.tableName}
                </button>
              ))}
              {openTables.length === 0 && <span className="text-xs text-muted-foreground">No open tables yet</span>}
            </div>
            <div className="rounded-xl border-4 border-neutral-100 bg-white p-4">
              <QRCodeSVG value={qrValue} size={220} />
            </div>
            <div className="text-center">
              <div className="text-sm font-medium">{qrLabel}</div>
              <div className="mt-0.5 break-all text-xs text-muted-foreground">{qrValue}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {qrSel === "menu"
                  ? "Generic menu link for guests to browse."
                  : "Guests scan this to order directly to this table."}
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ManageTablesDialog
        open={manageOpen}
        onOpenChange={setManageOpen}
        onChanged={() => router.refresh()}
      />
    </div>
  );
}
