"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Key } from "lucide-react";
import { cn, formatDateTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

const ROLES = ["SUPER_ADMIN", "ADMIN", "MANAGER", "CASHIER", "KITCHEN", "WAITER"];

const ROLE_COLOR: Record<string, string> = {
  SUPER_ADMIN: "bg-red-600", ADMIN: "bg-purple-600", MANAGER: "bg-blue-600",
  CASHIER: "bg-emerald-600", KITCHEN: "bg-amber-600", WAITER: "bg-slate-500",
};

export function StaffManager({ users, isManager }: any) {
  const router = useRouter();
  const [addOpen, setAddOpen] = useState(false);
  const [createdPin, setCreatedPin] = useState<string | null>(null);
  const refresh = () => router.refresh();

  async function toggleActive(u: any) {
    const res = await fetch(`/api/staff/${u.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !u.isActive }),
    });
    if (res.ok) { toast.success("Updated"); refresh(); } else toast.error("Failed");
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Staff</h1>
          <p className="text-sm text-muted-foreground">Manage users, roles and access.</p>
        </div>
        {isManager && <Button onClick={() => setAddOpen(true)}><Plus className="h-4 w-4" /> Add staff</Button>}
      </div>

      <div className="rounded-xl border bg-card">
        <div className="divide-y">
          {users.map((u: any) => (
            <div key={u.id} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-sm font-bold uppercase">
                  {u.name.slice(0, 2)}
                </div>
                <div>
                  <div className="flex items-center gap-2 font-semibold">
                    {u.name}
                    {!u.isActive && <Badge variant="destructive">Inactive</Badge>}
                  </div>
<div className="text-xs text-muted-foreground">{u.email} · joined {formatDateTime(u.createdAt)}</div>
              </div>
            </div>
              <div className="flex items-center gap-2">
                <Badge className={cn("", ROLE_COLOR[u.role])}>{u.role.toLowerCase()}</Badge>
                {isManager && (
                  <Button size="sm" variant={u.isActive ? "outline" : "default"} onClick={() => toggleActive(u)}>
                    {u.isActive ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <AddStaffDialog open={addOpen} onOpenChange={setAddOpen} onPin={(pin: string) => { setAddOpen(false); setCreatedPin(pin); }} onSaved={refresh} />
      <CreatedPinDialog pin={createdPin} onClose={() => setCreatedPin(null)} />
    </div>
  );
}

function AddStaffDialog({ open, onOpenChange, onPin, onSaved }: any) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("CASHIER");
  const [loading, setLoading] = useState(false);

  async function save() {
    if (!name || !email || !password) { toast.error("Name, email and password required"); return; }
    setLoading(true);
    try {
      const res = await fetch("/api/staff", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      toast.success("Staff added");
      setName(""); setEmail(""); setPassword(""); setRole("CASHIER");
      onPin(data.user.pin);
      onSaved();
    } catch (e: any) { toast.error(e.message); } finally { setLoading(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Add staff</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <div className="space-y-1"><Label>Full name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div className="space-y-1"><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div className="space-y-1"><Label>Temporary password</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div className="space-y-1"><Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ROLES.map((r) => <SelectItem key={r} value={r}>{r.toLowerCase()}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={loading}>{loading && <Loader2 className="h-4 w-4 animate-spin" />} Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreatedPinDialog({ pin, onClose }: any) {
  return (
    <Dialog open={!!pin} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Key className="h-4 w-4" /> Staff PIN created</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Share this PIN with the staff member. It's used to clock in on the POS.</p>
        <div className="rounded-lg bg-muted p-4 text-center text-4xl font-bold tracking-widest">{pin}</div>
        <DialogFooter><Button onClick={onClose}>Done</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}