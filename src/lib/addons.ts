export type AddonLink = {
  addon: { id: string } & Record<string, any>;
  inherited?: boolean;
};

/**
 * A product's order-time add-ons = its own product add-ons PLUS its category's
 * add-ons (category is the parent: each add-on belongs to exactly one category,
 * and every product in that category inherits it). A product-level link to an
 * add-on owned by a DIFFERENT category is never effective — it can't show up
 * here, so an add-on can't leak into other categories. De-duplicates by addonId
 * — a product link wins over the inherited category link. Product-level links
 * keep their order, then inherited/category add-ons follow.
 */
export function mergeProductAddons(product: {
  addons?: AddonLink[];
  category?: { addons?: any[] };
  categoryId?: string | null;
}): AddonLink[] {
  const out: AddonLink[] = [];
  const seen = new Set<string>();
  for (const link of product.addons ?? []) {
    if (!link?.addon?.id) continue;
    if (link.addon.categoryId && link.addon.categoryId !== product.categoryId) continue;
    seen.add(link.addon.id);
    out.push(link);
  }
  for (const addon of product.category?.addons ?? []) {
    if (!addon?.id || seen.has(addon.id)) continue;
    seen.add(addon.id);
    out.push({ addon, inherited: true });
  }
  return out;
}