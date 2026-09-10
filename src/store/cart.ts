"use client";

import { create } from "zustand";

export type CartAddon = {
  id: string;
  name: string;
  price: number;
  quantity: number;
};

export type CartLine = {
  key: string;
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  note?: string;
  addons: CartAddon[];
};

export type CartSummary = {
  subtotal: number;
  tax: number;
  total: number;
};

function lineTotals(line: CartLine) {
  const addonTotal = line.addons.reduce((s, a) => s + a.price * a.quantity, 0);
  return (line.unitPrice + addonTotal) * line.quantity;
}

export function computeSummary(lines: CartLine[]): CartSummary {
  const subtotal = lines.reduce((s, l) => s + lineTotals(l), 0);
  return { subtotal, tax: 0, total: subtotal };
}

type CartState = {
  lines: CartLine[];
  orderId: string | null;
  addItem: (item: Omit<CartLine, "key">) => void;
  removeItem: (key: string) => void;
  updateQty: (key: string, qty: number) => void;
  updateNote: (key: string, note: string) => void;
  setOrderId: (id: string | null) => void;
  clearCart: () => void;
};

export const useCart = create<CartState>((set) => ({
  lines: [],
  orderId: null,
  addItem: (item) =>
    set((state) => {
      const existing = state.lines.find(
        (l) => l.productId === item.productId && l.note === item.note
      );
      if (existing && existing.addons.length === 0 && item.addons.length === 0) {
        return {
          lines: state.lines.map((l) =>
            l.key === existing.key ? { ...l, quantity: l.quantity + item.quantity } : l
          ),
        };
      }
      const key = `${item.productId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      return { lines: [...state.lines, { ...item, key }] };
    }),
  removeItem: (key) => set((s) => ({ lines: s.lines.filter((l) => l.key !== key) })),
  updateQty: (key, qty) =>
    set((s) => ({
      lines: qty <= 0 ? s.lines.filter((l) => l.key !== key) : s.lines.map((l) => (l.key === key ? { ...l, quantity: qty } : l)),
    })),
  updateNote: (key, note) =>
    set((s) => ({ lines: s.lines.map((l) => (l.key === key ? { ...l, note } : l)) })),
  setOrderId: (orderId) => set({ orderId }),
  clearCart: () => set({ lines: [], orderId: null }),
}));
