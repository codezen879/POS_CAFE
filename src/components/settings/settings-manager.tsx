"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Store, Percent, Settings as SettingsIcon, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import toast from "react-hot-toast";
import { Loader2 } from "lucide-react";

export function SettingsManager({ store, taxRates, settings, isManager }: any) {
  const router = useRouter();
  const [storeForm, setStoreForm] = useState<any>(() => ({
    name: store?.name ?? "", legalName: store?.legalName ?? "", gstin: store?.gstin ?? "",
    phone: store?.phone ?? "", email: store?.email ?? "", address: store?.address ?? "",
    city: store?.city ?? "", state: store?.state ?? "", currency: store?.currency ?? "INR",
  }));
  const [values, setValues] = useState<any>(() => ({
    service_charge_percent: settings["service_charge_percent"] ?? "0",
    loyalty_points_per_rupee: settings["loyalty_points_per_rupee"] ?? "1",
  }));
  const [saving, setSaving] = useState(false);

  if (!isManager) {
    return <div className="text-sm text-muted-foreground">Only managers can edit settings.</div>;
  }

  async function saveStore() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: storeForm }),
      });
      if (!res.ok) throw new Error("Failed");
      toast.success("Store updated"); router.refresh();
    } catch (e: any) { toast.error(e.message); } finally { setSaving(false); }
  }

  async function saveSetting(key: string) {
    const res = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: `key:${key}`, fields: values[key] }),
    });
    if (res.ok) { toast.success("Saved"); router.refresh(); } else toast.error("Failed");
  }

  const styles = { label: "text-[11px] uppercase tracking-wide text-muted-foreground" };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      <p className="text-sm text-muted-foreground">Store details, tax configuration and business rules.</p>

      <Tabs defaultValue="store">
        <TabsList>
          <TabsTrigger value="store"><Store className="mr-1 h-3.5 w-3.5" /> Store</TabsTrigger>
          <TabsTrigger value="taxes"><Percent className="mr-1 h-3.5 w-3.5" /> Taxes</TabsTrigger>
          <TabsTrigger value="rules"><SettingsIcon className="mr-1 h-3.5 w-3.5" /> Business rules</TabsTrigger>
        </TabsList>

        <TabsContent value="store" className="mt-4">
          <Card>
            <CardContent className="p-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Store name" value={storeForm.name} onChange={(v: string) => setStoreForm({ ...storeForm, name: v })} />
                <Field label="Legal name" value={storeForm.legalName} onChange={(v: string) => setStoreForm({ ...storeForm, legalName: v })} />
                <Field label="GSTIN" value={storeForm.gstin} onChange={(v: string) => setStoreForm({ ...storeForm, gstin: v })} />
                <Field label="Currency" value={storeForm.currency} onChange={(v: string) => setStoreForm({ ...storeForm, currency: v })} />
                <Field label="Phone" value={storeForm.phone} onChange={(v: string) => setStoreForm({ ...storeForm, phone: v })} />
                <Field label="Email" value={storeForm.email} onChange={(v: string) => setStoreForm({ ...storeForm, email: v })} />
                <div className="sm:col-span-2"><Label className={styles.label}>Address</Label><Input value={storeForm.address} onChange={(e) => setStoreForm({ ...storeForm, address: e.target.value })} /></div>
                <Field label="City" value={storeForm.city} onChange={(v: string) => setStoreForm({ ...storeForm, city: v })} />
                <Field label="State" value={storeForm.state} onChange={(v: string) => setStoreForm({ ...storeForm, state: v })} />
              </div>
              <div className="mt-4"><Button onClick={saveStore} disabled={saving}>{saving && <Loader2 className="h-4 w-4 animate-spin" />} Save store</Button></div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="taxes" className="mt-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Tags className="h-4 w-4" /> GST rates</CardTitle></CardHeader>
            <CardContent>
              {taxRates.length === 0 && <p className="text-sm text-muted-foreground">No tax rates configured. Seed data adds TAX18, TAX5, TAX12.</p>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {taxRates.map((t: any) => (
                  <div key={t.id} className="rounded-lg border p-4">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">{t.name}</span>
                      <Badge variant={t.isActive ? "success" : "outline"}>{t.isActive ? "Active" : "Inactive"}</Badge>
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">{t.code} · {t.rate}%</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rules" className="mt-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-end gap-3">
                <div className="grow">
                  <Label className={styles.label}>Service charge (%)</Label>
                  <Input type="number" value={values.service_charge_percent} onChange={(e) => setValues({ ...values, service_charge_percent: e.target.value })} />
                </div>
                <Button variant="outline" onClick={() => saveSetting("service_charge_percent")}>Save</Button>
              </div>
              <div className="flex items-end gap-3">
                <div className="grow">
                  <Label className={styles.label}>Loyalty points per ₹1</Label>
                  <Input type="number" value={values.loyalty_points_per_rupee} onChange={(e) => setValues({ ...values, loyalty_points_per_rupee: e.target.value })} />
                </div>
                <Button variant="outline" onClick={() => saveSetting("loyalty_points_per_rupee")}>Save</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Field({ label, value, onChange }: any) {
  return (
    <div>
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}