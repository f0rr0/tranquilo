import type { JsonObject } from "./types";

export interface NormalizedAddress {
  canDelete: boolean;
  city?: string | undefined;
  coordinates: { lat: number; lng: number } | null;
  homeDetails: {
    balcony: number | null;
    bathroom: number | null;
    bhk: number | null;
  };
  id: string;
  isActive: boolean;
  label: string;
  pincode?: string | undefined;
  profileDefault: boolean;
  summary: string;
  type: string;
}

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return;
  }
  const text = String(value).trim();
  return text || undefined;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|_|\s|-)([a-z])/g,
      (_match, prefix: string, letter: string) =>
        `${prefix === "_" ? " " : prefix}${letter.toUpperCase()}`
    )
    .trim();
}

function compactUnique(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    result.push(value);
  }
  return result;
}

function extractAddressItems(payload: JsonObject): JsonObject[] {
  const envelope = asObject(payload.data);
  const data = envelope?.data;
  if (Array.isArray(data)) {
    return data.filter((item): item is JsonObject => Boolean(asObject(item)));
  }
  const item = asObject(data);
  return item ? [item] : [];
}

function normalizeAddress(
  raw: JsonObject,
  activeAddressId?: string
): NormalizedAddress {
  const id = stringValue(raw.id) ?? "";
  const type = (stringValue(raw.type) ?? "ADDRESS").toUpperCase();
  const label = stringValue(raw.name) ?? titleCase(type);
  const summary = compactUnique([
    stringValue(raw.houseNo),
    stringValue(raw.buildingName),
    stringValue(raw.addressLine1),
    stringValue(raw.landmark),
  ]).join(", ");
  const lat = numberValue(raw.latitude);
  const lng = numberValue(raw.longitude);

  return {
    canDelete: raw.canDelete === true,
    city: stringValue(raw.city),
    coordinates: lat === undefined || lng === undefined ? null : { lat, lng },
    homeDetails: {
      balcony: numberValue(raw.balcony) ?? null,
      bathroom: numberValue(raw.bathroom) ?? null,
      bhk: numberValue(raw.bhk) ?? null,
    },
    id,
    isActive:
      activeAddressId !== undefined && String(activeAddressId) === String(id),
    label,
    pincode: stringValue(raw.pincode),
    profileDefault: raw.default === true,
    summary,
    type,
  };
}

export function normalizeAddresses(
  payload: JsonObject,
  activeAddressId?: string
): NormalizedAddress[] {
  return extractAddressItems(payload).map((item) =>
    normalizeAddress(item, activeAddressId)
  );
}

export function activeAddressIdFromCart(
  payload: JsonObject
): string | undefined {
  return stringValue(cartDeliveryAddress(payload)?.id);
}

export function cartDeliveryAddress(
  payload: JsonObject
): JsonObject | undefined {
  const envelope = asObject(payload.data);
  const cart = asObject(envelope?.cart) ?? envelope;
  return asObject(cart?.deliveryAddress);
}
