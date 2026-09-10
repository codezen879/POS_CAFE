"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

type TableType = {
  id: string;
  tableName: string;
  seatCount: number;
};

type CustomerType = { id: string; name: string | null; phone: string | null };

export function OpenTableDialog({
  open,
  table,
  customers,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  table: TableType | null;
  customers: CustomerType[];
  onOpenChange: (o: boolean) => void;
  onSuccess: () => void;
}) {
  const [guestCount, setGuestCount] = useState(table?.seatCount ?? 2);
  const [customerMode, setCustomerMode] = useState<"walkin" | "existing" | "new">("walkin");
  const [customerId, setCustomerId] = useState("");
  const [newName, setNewName] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleOpen() {
    if (!table) return;
    setLoading(true);
    try {
      let finalCustomerId: string | null = null;
      if (customerMode === "existing" && customerId) finalCustomerId = customerId;
      if (customerMode === "new") {
        if (!newPhone) {
          toast.error("Phone is required for a new customer");
          setLoading(false);
          return;
        }
        const res = await fetch("/api/customers", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: newName, phone: newPhone }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to create customer");
        finalCustomerId = data.customer.id;
      }
      const res = await fetch(`/api/pos/tables/${table.id}/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guestCount, customerId: finalCustomerId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to open table");
      onSuccess();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Open {table?.tableName}</DialogTitle>
          <DialogDescription>Start a new dining session at this table.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Guest count</Label>
            <Input
              type="number"
              min={1}
              max={table?.seatCount ?? 20}
              value={guestCount}
              onChange={(e) => setGuestCount(Number(e.target.value))}
            />
          </div>

          <div className="space-y-2">
            <Label>Customer (optional)</Label>
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1 text-center text-xs font-medium">
              {(["walkin", "existing", "new"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setCustomerMode(m)}
                  className={`rounded-md py-1.5 ${customerMode === m ? "bg-card shadow text-foreground" : "text-muted-foreground"}`}
                >
                  {m === "walkin" ? "Walk-in" : m === "existing" ? "Existing" : "New"}
                </button>
              ))}
            </div>

            {customerMode === "existing" && (
              <Select value={customerId} onValueChange={setCustomerId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select customer" />
                </SelectTrigger>
                <SelectContent>
                  {customers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || "Unnamed"} {c.phone ? `· ${c.phone}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {customerMode === "new" && (
              <div className="grid gap-2">
                <Input placeholder="Name" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <Input placeholder="Phone" value={newPhone} onChange={(e) => setNewPhone(e.target.value)} />
              </div>
            )}
          </div>

          <Button className="w-full" onClick={handleOpen} disabled={loading}>
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Open table
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
