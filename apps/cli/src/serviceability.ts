import type { TranquiloClient } from "./api";
import type { JsonObject, ResolvedLocation } from "./types";
import { TranquiloError } from "./types";

const SUPPORTED_BOOKING_TYPE = "SCHEDULED";

function asObject(value: unknown): JsonObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function dataOf(value: unknown): unknown {
  const root = asObject(value);
  return root?.data ?? value;
}

export function normalizeSupportedBookingType(value?: string): "SCHEDULED" {
  const bookingType = (value ?? SUPPORTED_BOOKING_TYPE).toUpperCase();
  if (bookingType !== SUPPORTED_BOOKING_TYPE) {
    throw new TranquiloError(
      "Only SCHEDULED bookings are supported in this CLI version.",
      {
        code: "BOOKING_TYPE_UNSUPPORTED",
        details: { bookingType },
      }
    );
  }
  return SUPPORTED_BOOKING_TYPE;
}

function serviceableBookingTypes(value: unknown): string[] {
  const root = asObject(value);
  const data = asObject(dataOf(value));
  const nestedData = asObject(data?.data);
  const candidates = [
    root?.serviceableBookingTypes,
    data?.serviceableBookingTypes,
    nestedData?.serviceableBookingTypes,
    root?.bookingTypes,
    data?.bookingTypes,
    nestedData?.bookingTypes,
  ];
  for (const candidate of candidates) {
    const bookingTypes = asArray(candidate)
      .map((item) => String(item).toUpperCase())
      .filter(Boolean);
    if (bookingTypes.length) {
      return [...new Set(bookingTypes)];
    }
  }
  return [];
}

export async function assertScheduledServiceable(
  client: TranquiloClient,
  location: Pick<ResolvedLocation, "lat" | "lng">,
  bookingType?: string
): Promise<{
  bookingType: "SCHEDULED";
  serviceability: unknown;
  serviceableBookingTypes: string[];
}> {
  const normalized = normalizeSupportedBookingType(bookingType);
  const serviceability = await client.serviceability(location);
  const bookingTypes = serviceableBookingTypes(serviceability);
  if (!bookingTypes.includes(normalized)) {
    throw new TranquiloError(
      "SCHEDULED bookings are not serviceable for this address.",
      {
        code: "BOOKING_TYPE_NOT_SERVICEABLE",
        details: {
          bookingType: normalized,
          serviceableBookingTypes: bookingTypes,
        },
      }
    );
  }
  return {
    bookingType: normalized,
    serviceability: dataOf(serviceability),
    serviceableBookingTypes: bookingTypes,
  };
}
