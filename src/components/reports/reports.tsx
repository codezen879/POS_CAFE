"use client";

import { Crown, Percent, Star, BarChart3 } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export function Reports({ bills, taxLines, topProducts, topAddons, categoryRows, loyaltyEarned, days }: any) {
  const daily = buildDaily(bills, days);
  const totalRevenue = bills.reduce((s: number, b: any) => s + Number(b.total), 0);
  const totalBills = bills.length;
  const avgOrder = totalBills ? totalRevenue / totalBills : 0;

  const cgst = taxLines.filter((t: any) => t.taxCode === "CGST").reduce((s: number, t: any) => s + Number(t.taxAmount), 0);
  const sgst = taxLines.filter((t: any) => t.taxCode === "SGST").reduce((s: number, t: any) => s + Number(t.taxAmount), 0);
  const netTax = cgst + sgst;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Reports</h1>
      <p className="text-sm text-muted-foreground">Last {days} days of sales activity.</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Revenue" value={formatCurrency(totalRevenue)} />
        <Kpi label="Bills" value={totalBills} />
        <Kpi label="Avg order value" value={formatCurrency(avgOrder)} />
        <Kpi label="Loyalty points earned" value={loyaltyEarned} />
      </div>

      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><BarChart3 className="h-4 w-4" /> Daily revenue</CardTitle></CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={daily} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
              <YAxis tickLine={false} axisLine={false} fontSize={11} />
              <Tooltip formatter={(v) => formatCurrency(Number(v))} />
              <Bar dataKey="revenue" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Crown className="h-4 w-4" /> Top selling items</CardTitle></CardHeader>
          <CardContent>
            <ol className="space-y-2">
              {topProducts.map((p: any, i: number) => (
                <li key={p.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2"><span className="text-muted-foreground">{i + 1}.</span>{p.name}</span>
                  <span className="font-semibold">{p._sum.quantity} sold</span>
                </li>
              ))}
              {topProducts.length === 0 && <li className="text-sm text-muted-foreground">No sales yet.</li>}
            </ol>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Percent className="h-4 w-4" /> GST summary</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <Row label="CGST collected" value={formatCurrency(cgst)} />
            <Row label="SGST collected" value={formatCurrency(sgst)} />
            <Row label="Net tax collected" value={formatCurrency(netTax)} bold />
            <div className="mt-3 border-t pt-3">
              <div className="text-sm font-semibold">Popular add-ons</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {topAddons.map((a: any) => (
                  <span key={a.name} className="rounded-full bg-muted px-3 py-1 text-xs">{a.name} · {a._sum.quantity}</span>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-sm"><Star className="h-4 w-4" /> Sales by category</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {categoryRows.map((c: any) => {
                const total = categoryRows.reduce((s: number, x: any) => s + x.qty, 0) || 1;
                const pct = Math.round((c.qty / total) * 100);
                return (
                  <div key={c.category}>
                    <div className="flex justify-between text-sm"><span>{c.category}</span><span className="text-muted-foreground">{pct}%</span></div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
              {categoryRows.length === 0 && <div className="text-sm text-muted-foreground">No data.</div>}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function buildDaily(bills: any[], days: number) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toDateString();
    const revenue = bills.filter((b) => new Date(b.paidAt).toDateString() === key).reduce((s, b) => s + Number(b.total), 0);
    out.push({ label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), revenue: Math.round(revenue) });
  }
  return out;
}

function Kpi({ label, value }: any) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-2xl font-bold">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, bold }: any) {
  return (
    <div className={`flex items-center justify-between text-sm ${bold ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </div>
  );
}