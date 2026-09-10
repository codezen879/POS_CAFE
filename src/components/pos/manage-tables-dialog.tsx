"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ListPlus } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const STATUSES = ["AVAILABLE", "OCCUPIED", "RESERVED", "CLEANING", "CLOSED"];

type T = { id: string; tableName: string; seatCount: number; status: string; floorId: string | null; floor?: { name: string } | null };
type F = { id: string; name: string };

export function ManageTablesDialog({ open, onOpenChange, onChanged }: { open: boolean; onOpenChange: (o: boolean) => void; onChanged: () => void }) {
  const [tables, setTables] = useState<T[]>([]);
  const [floors, setFloors] = useState<F[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [adding, setAdding] = useState(false);

  const [name, setName] = useState("");
  const [floorId, setFloorId] = useState("");
  const [seats, setSeats] = useState(2);
  const [status, setStatus] = useState("AVAILABLE");
  const [saving, setSaving] = useState(false);
  const [newFloor, setNewFloor] = useState("");
  const [savingFloor, setSavingFloor] = useState(false);
  const [editingFloor, setEditingFloor] = useState<F | null>(null);

  useEffect(() => {
    if (open) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function load() {
    setLoading(true);
    try {
      const [tRes, fRes] = await Promise.all([fetch("/api/tables"), fetch("/api/tables/floors")]);
      const t = await tRes.json();
      const f = await fRes.json();
      setTables(t.tables ?? []);
      setFloors(f.floors ?? []);
    } finally {
      setLoading(false);
    }
  }

  function resetForm() {
    setName(""); setFloorId(""); setSeats(2); setStatus("AVAILABLE"); setEditing(null); setAdding(false);
  }

  async function save() {
    if (!name.trim()) { toast.error("Table name required"); return; }
    setSaving(true);
    try {
      const body = JSON.stringify({ tableName: name.trim(), floorId: floorId || null, seatCount: seats, status });
      const url = editing ? `/api/tables/${editing.id}` : "/api/tables";
      const method = editing ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      toast.success(editing ? "Table updated" : "Table added");
      resetForm();
      await load();
      onChanged();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: T) {
    if (!confirm(`Delete table ${t.tableName}? This cannot be undone.`)) return;
    const res = await fetch(`/api/tables/${t.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to delete"); return; }
    toast.success(`${t.tableName} deleted`);
    await load();
    onChanged();
  }

  async function saveFloor() {
    if (!newFloor.trim()) { toast.error("Floor name required"); return; }
    setSavingFloor(true);
    try {
      const url = editingFloor ? `/api/floors/${editingFloor.id}` : "/api/floors";
      const method = editingFloor ? "PATCH" : "POST";
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newFloor.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setNewFloor("");
      setEditingFloor(null);
      await load();
      toast.success(editingFloor ? "Floor updated" : "Floor added");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingFloor(false);
    }
  }

  async function removeFloor(f: F) {
    if (!confirm(`Delete floor "${f.name}"?`)) return;
    const res = await fetch(`/api/floors/${f.id}`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) { toast.error(data.error || "Failed to delete floor"); return; }
    toast.success(`Floor ${f.name} deleted`);
    await load();
    onChanged();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manage tables</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">{tables.length} table(s) · {floors.length} floor(s)</div>
              <Button size="sm" variant="outline" onClick={() => setAdding(true)} disabled={adding}>
                <Plus className="h-4 w-4" /> Add table
              </Button>
            </div>

            {(adding || editing) && (
              <div className="rounded-xl border p-4">
                <div className="mb-3 text-sm font-semibold">{editing ? `Edit ${editing.tableName}` : "New table"}</div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Table name</Label>
                    <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. T5" />
                  </div>
                  <div className="space-y-1">
                    <Label>Floor</Label>
                    <Select value={floorId || "none"} onValueChange={(v) => setFloorId(v === "none" ? "" : v)}>
                      <SelectTrigger><SelectValue placeholder="No floor" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No floor</SelectItem>
                        {floors.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Seats</Label>
                    <Input type="number" min={1} value={seats} onChange={(e) => setSeats(Number(e.target.value))} />
                  </div>
                  <div className="space-y-1">
                    <Label>Status</Label>
                    <Select value={status} onValueChange={setStatus}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="mt-4 flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>
                  <Button size="sm" onClick={save} disabled={saving}>
                    {saving && <Loader2 className="h-4 w-4 animate-spin" />} Save
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              {tables.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-3">
                    <span className="font-semibold">{t.tableName}</span>
                    <span className="text-xs text-muted-foreground">{t.floor?.name ?? "No floor"}</span>
                    <span className="text-xs text-muted-foreground">{t.seatCount} seats</span>
                    <Badge variant="outline" className="text-[10px] capitalize">{t.status.toLowerCase()}</Badge>
                  </div>
                  <div className="flex gap-1">
                    <Button variant="ghost" size="icon" onClick={() => { setEditing(t); setName(t.tableName); setFloorId(t.floorId ?? ""); setSeats(t.seatCount); setStatus(t.status); setAdding(false); }}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="text-destructive" onClick={() => remove(t)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
              {tables.length === 0 && <div className="py-6 text-center text-sm text-muted-foreground">No tables yet.</div>}
            </div>

            <div className="border-t pt-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Floors</div>
              <div className="space-y-2">
                {floors.map((f) => (
                  <div key={f.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <span className="text-sm font-medium">{f.name}</span>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="icon" onClick={() => { setEditingFloor(f); setNewFloor(f.name); }}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive" onClick={() => removeFloor(f)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {floors.length === 0 && <div className="py-4 text-center text-sm text-muted-foreground">No floors yet.</div>}
              </div>
              <div className="mt-2 flex gap-2">
                <Input value={newFloor} onChange={(e) => setNewFloor(e.target.value)} placeholder={editingFloor ? "Rename floor" : "e.g. Ground floor"} />
                <Button variant="outline" onClick={saveFloor} disabled={savingFloor || !newFloor.trim()}>
                  {savingFloor ? <Loader2 className="h-4 w-4 animate-spin" /> : (editingFloor ? <Pencil className="h-4 w-4" /> : <ListPlus className="h-4 w-4" />)}
                  {editingFloor ? "Rename" : "Add"}
                </Button>
                {editingFloor && (
                  <Button variant="ghost" onClick={() => { setEditingFloor(null); setNewFloor(""); }}>Cancel</Button>
                )}
              </div>
            </div>
          </div>
        )}

        <DialogFooter className="!mt-4">
          <Button variant="outline" onClick={() => { onOpenChange(false); resetForm(); }}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}