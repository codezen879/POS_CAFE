export type AddonLink = { addon: { id: string } & Record<string, any> };

/**
 * A product's order-time add-ons = its own product add-ons PLUS its category's
 * add-ons (category acts as the base; per-product add-ons add extras).
 * De-duplicates by addonId — a product link wins over the inherited category link.
 * Product-level links keep their order, then category links follow.
 */
export function mergeProductAddons(product: { addons?: AddonLink[]; category?: { addons?: AddonLink[] } }): AddonLink[] {
  const out: AddonLink[] = [];
  const seen = new Set<string>();
  for (const link of product.addons ?? []) {
    if (!link?.addon?.id) continue;
    seen.add(link.addon.id);
    out.push(link);
  }
  for (const link of product.category?.addons ?? []) {
    if (!link?.addon?.id || seen.has(link.addon.id)) continue;
    seen.add(link.addon.id);
    out.push(link);
  }
  return out;
}