import type { JsonObject } from "./types";

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return;
  }
  const text = String(value).trim();
  return text || undefined;
}

function positiveQuantity(item: JsonObject): boolean {
  const raw = item.quantity ?? item.qty;
  if (raw === undefined || raw === null || raw === "") {
    return true;
  }
  const quantity = Number(raw);
  return Number.isFinite(quantity) ? quantity > 0 : true;
}

function nestedCatalog(item: JsonObject): JsonObject | undefined {
  return (
    asObject(item.catalog) ??
    asObject(item.listingItem) ??
    asObject(item.item) ??
    asObject(item.service)
  );
}

function extractCart(value: unknown): JsonObject | undefined {
  const root = asObject(value);
  const data = asObject(root?.data);
  return asObject(root?.cart) ?? asObject(data?.cart) ?? data ?? root;
}

export function cartSlotListingIds(cartPayload: unknown): string[] {
  const cart = extractCart(cartPayload);
  const ids = asArray(cart?.items)
    .map((item) => asObject(item))
    .filter((item): item is JsonObject => Boolean(item))
    .filter(positiveQuantity)
    .map((item) => {
      const catalog = nestedCatalog(item);
      return (
        stringValue(item.listingId) ??
        stringValue(catalog?.listingId) ??
        stringValue(catalog?.id) ??
        stringValue(item.listingItemId) ??
        stringValue(catalog?.listingItemId)
      );
    })
    .filter((item): item is string => Boolean(item));
  return [...new Set(ids)];
}
