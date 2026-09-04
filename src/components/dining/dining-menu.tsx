"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils";

export function DiningMenu({ store, categories }: any) {
  const [activeCat, setActiveCat] = useState(categories[0]?.id ?? "");
  const activeProducts = categories.find((c: any) => c.id === activeCat)?.products ?? [];

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-primary px-5 py-6 text-primary-foreground">
        <div className="text-xl font-bold">{store?.name || "Menu"}</div>
        <div className="mt-0.5 text-xs opacity-80">{store?.address ? `${store.address}${store.city ? `, ${store.city}` : ""}` : ""}</div>
        <div className="mt-4 text-sm opacity-90">Scan to order — see our full menu below.</div>
      </div>

      <div className="sticky top-0 z-10 flex gap-2 overflow-x-auto border-b bg-background px-3 py-2 shadow-sm scrollbar-thin">
        {categories.map((c: any) => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            className={cn(
              "whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium",
              activeCat === c.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
            )}
          >
            {c.icon} {c.name}
          </button>
        ))}
      </div>

      <div className="mx-auto max-w-lg space-y-3 px-4 py-4">
        {activeProducts.map((p: any) => (
          <div key={p.id} className="rounded-xl border bg-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <span className={cn("mt-1 h-3.5 w-3.5 rounded-sm border-2", p.isVeg ? "border-green-600" : "border-red-600")} />
                <div>
                  <div className="font-semibold leading-tight">{p.name}</div>
                  {p.description && <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>}
                  {p.addons?.[0] && (
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Add-ons: {p.addons.map((a: any) => a.addon.name).join(", ")}
                    </div>
                  )}
                </div>
              </div>
              <div className="whitespace-nowrap font-bold">{formatCurrency(p.basePrice)}</div>
            </div>
          </div>
        ))}
        {activeProducts.length === 0 && (
          <div className="py-10 text-center text-sm text-muted-foreground">No items in this category.</div>
        )}
      </div>
    </div>
  );
}