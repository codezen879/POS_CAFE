"use client";

import { useState } from "react";
import { Phone, Mail, Star } from "lucide-react";
import { formatCurrency, formatDateTime } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const TIER_STYLE: Record<string, string> = {
  BRONZE: "bg-amber-600", SILVER: "bg-slate-400", GOLD: "bg-yellow-500", PLATINUM: "bg-sky-600",
};

function tierFor(points: number) {
  if (points >= 5000) return "PLATINUM";
  if (points >= 2000) return "GOLD";
  if (points >= 500) return "SILVER";
  return "BRONZE";
}

export function CustomersList({ customers }: any) {
  const [selected, setSelected] = useState<any>(null);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Customers & Loyalty</h1>
      <p className="text-sm text-muted-foreground">{customers.length} registered customers.</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {customers.map((c: any) => {
          const tier = tierFor(c.loyaltyPoints);
          return (
            <button key={c.id} onClick={() => setSelected(c)} className="rounded-xl border bg-card p-4 text-left transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{c.name || "Anonymous"}</div>
                  <div className="text-xs text-muted-foreground">{c.phone}</div>
                </div>
                <Badge className={TIER_STYLE[tier]}>{tier}</Badge>
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">{c._count.sessions} visits</span>
                <span className="font-bold">{c.loyaltyPoints} pts</span>
              </div>
            </button>
          );
        })}
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center justify-between">
                  <span>{selected.name || "Anonymous"}</span>
                  <Badge className={TIER_STYLE[tierFor(selected.loyaltyPoints)]}>{tierFor(selected.loyaltyPoints)}</Badge>
                </DialogTitle>
              </DialogHeader>
              <div className="grid gap-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground"><Phone className="h-4 w-4" /> {selected.phone}</div>
                {selected.email && <div className="flex items-center gap-2 text-muted-foreground"><Mail className="h-4 w-4" /> {selected.email}</div>}
                <div className="mt-2 rounded-lg bg-muted p-3">
                  <span className="text-muted-foreground">Loyalty balance:</span> <span className="font-bold">{selected.loyaltyPoints} pts</span>
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">Loyalty history</h4>
                <div className="space-y-2">
                  {selected.loyaltyTxns.length === 0 && <div className="text-sm text-muted-foreground">No transactions.</div>}
                  {selected.loyaltyTxns.map((t: any) => (
                    <div key={t.id} className="flex items-center justify-between rounded-lg border px-3 py-2 text-sm">
                      <div>
                        <span className={t.type === "EARN" ? "text-emerald-600" : "text-red-600"}>
                          {t.type === "EARN" ? "+" : "-"}{t.points} pts
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{t.description}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{formatDateTime(t.createdAt)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-semibold">Reviews</h4>
                <div className="space-y-2">
                  {selected.reviews.length === 0 && <div className="text-sm text-muted-foreground">No reviews.</div>}
                  {selected.reviews.map((r: any) => (
                    <div key={r.id} className="rounded-lg border px-3 py-2">
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} className={`h-4 w-4 ${n <= r.rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`} />
                        ))}
                      </div>
                      {r.comment && <p className="mt-1 text-sm">{r.comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { formatCurrency };