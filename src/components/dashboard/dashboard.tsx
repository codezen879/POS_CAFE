"use client";

import Link from "next/link";
import { IndianRupee, ShoppingBag, Users, CookingPot, AlertTriangle, TrendingUp } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, timeAgo } from "@/lib/utils";

export function Dashboard(props: any) {
  const stats = [
    { label: "Today's revenue", value: formatCurrency(props.todayRevenue), Icon: IndianRupee, trend: "+" },
    { label: "Bills today", value: props.todayOrders, Icon: ShoppingBag, trend: "" },
    { label: "Open tables", value: props.openSessions, Icon: Users, trend: "" },
    { label: "Active in kitchen", value: props.activeOrders, Icon: CookingPot, trend: "" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Today's performance at a glance.</p>
        </div>
        <Link href="/tables" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
          Open POS
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="flex items-center gap-4 p-5">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <s.Icon className="h-5 w-5" />
              </div>
              <div>
                <div className="text-2xl font-bold">{s.value}</div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <TrendingUp className="h-4 w-4" /> Revenue (last 7 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={props.weekSeries} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.5} />
                    <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} />
                <Tooltip formatter={(v) => formatCurrency(Number(v))} />
                <Area type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" fill="url(#rev)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
            <div className="mt-2 text-sm text-muted-foreground">
              Week total: <span className="font-semibold">{formatCurrency(props.weekRevenue)}</span>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-sm">Table overview</CardTitle></CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {props.tables.map((t: any) => (
                  <div key={t.id} className="rounded-lg border px-3 py-2 text-center">
                    <div className="text-sm font-bold">{t.tableName}</div>
                    <Badge
                      variant={t.status === "AVAILABLE" ? "success" : t.status === "OCCUPIED" ? "info" : "warning"}
                      className="mt-1 text-[10px]"
                    >
                      {t.status.toLowerCase()}
                    </Badge>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-sm"><span className="font-semibold">{props.customerCount}</span> customers registered</div>
            </CardContent>
          </Card>

          {props.lowStock.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-sm text-amber-600"><AlertTriangle className="h-4 w-4" /> Low stock</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {props.lowStock.map((i: any) => (
                  <div key={i.id} className="flex items-center justify-between text-sm">
                    <span>{i.name}</span>
                    <span className="text-muted-foreground">{Number(i.stockQty)} {i.unit}</span>
                  </div>
                ))}
                {props.lowStock.length === 0 && <div className="text-sm text-muted-foreground">All stocked up</div>}
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-sm">Recent orders</CardTitle></CardHeader>
        <CardContent>
          <div className="divide-y">
            {props.recentOrders.map((o: any) => (
              <div key={o.id} className="flex items-center justify-between py-2 text-sm">
                <div>
                  <span className="font-medium">{o.orderNumber}</span>
                  <span className="ml-2 text-muted-foreground">
                    {o.session?.table?.tableName ?? "Takeaway"} · {o.items.length} item{o.items.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{o.status.toLowerCase().replace(/_/g, " ")}</Badge>
                  <span className="text-xs text-muted-foreground">{timeAgo(o.placedAt)}</span>
                </div>
              </div>
            ))}
            {props.recentOrders.length === 0 && <div className="py-4 text-sm text-muted-foreground">No orders yet today.</div>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}