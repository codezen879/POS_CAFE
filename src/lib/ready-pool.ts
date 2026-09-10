export const REUSE_OFFER_PENDING = "REUSE_OFFER_PENDING";

export type ReadyPoolComparable = {
  productId: string | null;
  quantity: number;
  note: string | null;
  addons: { addonId?: string | null; id?: string | null; quantity?: number }[];
};

export function normalizedReadyPoolNote(value?: string | null) {
  return String(value || "").trim().toLowerCase();
}

export function readyPoolAddonSignature(
  addons: { addonId?: string | null; id?: string | null; quantity?: number }[]
) {
  return addons
    .map((addon) => `${addon.addonId ?? addon.id ?? ""}:${Math.max(1, Math.floor(addon.quantity ?? 1))}`)
    .sort()
    .join("|");
}

export function isExactReadyPoolMatch(left: ReadyPoolComparable, right: ReadyPoolComparable) {
  return (
    Boolean(left.productId) &&
    left.productId === right.productId &&
    left.quantity === right.quantity &&
    normalizedReadyPoolNote(left.note) === normalizedReadyPoolNote(right.note) &&
    readyPoolAddonSignature(left.addons) === readyPoolAddonSignature(right.addons)
  );
}

export function findExactReadyPoolMatches<TPool extends ReadyPoolComparable & { id: string }>(
  lines: ReadyPoolComparable[],
  poolItems: TPool[]
) {
  const usedPoolIds = new Set<string>();
  return lines.map((line) => {
    const match = poolItems.find(
      (poolItem) => !usedPoolIds.has(poolItem.id) && isExactReadyPoolMatch(line, poolItem)
    );
    if (match) usedPoolIds.add(match.id);
    return match ?? null;
  });
}
