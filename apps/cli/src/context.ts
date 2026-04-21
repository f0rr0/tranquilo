import { cartDeliveryAddress } from "./address";
import { TranquiloClient } from "./api";
import { loadConfig } from "./config";
import { loadCredentials } from "./storage";
import type {
  JsonObject,
  LocationInput,
  LocationSource,
  ResolvedLocation,
} from "./types";
import { TranquiloError } from "./types";

const LOCAL_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const ISO_DATE_TIME_PREFIX_RE = /^\d{4}-\d{2}-\d{2}T/;
const HUMAN_DATE_TIME_RE =
  /^(\d{4})-(\d{2})-(\d{2})[ T]+(.+)$|^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(.+)$/;
const RELATIVE_DATE_TIME_RE = /^(today|tomorrow)\s+(.+)$/i;
const MONTH_DATE_TIME_RE = /^(\d{1,2})\s+([a-z]{3,9})(?:\s+(\d{4}))?\s+(.+)$/i;
const MONTH_FIRST_DATE_TIME_RE =
  /^([a-z]{3,9})\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+(.+)$/i;
const WEEKDAY_DATE_TIME_RE =
  /^(mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\s+(.+)$/i;
const HUMAN_TIME_RE = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/i;
const MONTHS = new Map(
  [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
  ].flatMap((name, index) => [
    [name, index + 1],
    [name.slice(0, 3), index + 1],
  ])
);
const WEEKDAYS = new Map([
  ["mon", 1],
  ["monday", 1],
  ["tue", 2],
  ["tuesday", 2],
  ["wed", 3],
  ["wednesday", 3],
  ["thu", 4],
  ["thursday", 4],
  ["fri", 5],
  ["friday", 5],
  ["sat", 6],
  ["saturday", 6],
  ["sun", 7],
  ["sunday", 7],
]);

export async function createClient(
  requireAuth = true
): Promise<TranquiloClient> {
  const config = await loadConfig();
  const credentials = await loadCredentials();
  if (requireAuth && !credentials?.accessToken) {
    throw new TranquiloError("Not logged in. Run `tranquilo login` first.", {
      code: "NOT_AUTHENTICATED",
    });
  }
  return new TranquiloClient(config, credentials);
}

function unwrapData(payload: JsonObject): unknown {
  return payload.data;
}

export async function resolveLocation(
  client: TranquiloClient,
  input: LocationInput
): Promise<ResolvedLocation> {
  if (typeof input.lat === "number" && typeof input.lng === "number") {
    return { lat: input.lat, lng: input.lng, source: "flags" };
  }
  if (input.lat !== undefined || input.lng !== undefined) {
    throw new TranquiloError("Pass both --lat and --lng.", {
      code: "LOCATION_REQUIRED",
    });
  }

  let addresses: JsonObject[] | undefined;
  async function loadAddresses(): Promise<JsonObject[]> {
    if (addresses) {
      return addresses;
    }
    const addressesPayload = await client.addresses({
      nearestAddressRequired: false,
    });
    const data = unwrapData(addressesPayload) as JsonObject | undefined;
    addresses = Array.isArray(data?.data) ? (data.data as JsonObject[]) : [];
    return addresses;
  }

  if (input.addressId) {
    const address = (await loadAddresses()).find(
      (candidate) => String(candidate.id) === String(input.addressId)
    );
    if (!address) {
      throw new TranquiloError(`Address ${input.addressId} was not found.`, {
        code: "ADDRESS_NOT_FOUND",
      });
    }
    return locationFromAddress(address, "address");
  }

  const activeAddress = cartDeliveryAddress(await client.cart());
  if (activeAddress) {
    const activeLocation = tryLocationFromAddress(
      activeAddress,
      "active-cart-address"
    );
    if (activeLocation) {
      return activeLocation;
    }
    const activeAddressId = stringValue(activeAddress.id);
    if (activeAddressId) {
      const saved = (await loadAddresses()).find(
        (candidate) => String(candidate.id) === activeAddressId
      );
      if (saved) {
        return locationFromAddress(saved, "active-cart-address");
      }
    }
  }

  const savedAddresses = await loadAddresses();
  const profileDefault = savedAddresses.find(
    (candidate) => candidate.default === true
  );
  if (profileDefault) {
    return locationFromAddress(profileDefault, "profile-default-address");
  }
  const first = savedAddresses[0];
  if (first) {
    return locationFromAddress(first, "first-saved-address");
  }

  throw new TranquiloError(
    "No address available. Pass --lat and --lng, or add an address in the app.",
    {
      code: "LOCATION_REQUIRED",
    }
  );
}

function stringValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return;
  }
  const text = String(value).trim();
  return text || undefined;
}

function locationFromAddress(
  address: JsonObject,
  source: LocationSource
): ResolvedLocation {
  const location = tryLocationFromAddress(address, source);
  if (location) {
    return location;
  }
  throw new TranquiloError(
    `Address ${String(address.id)} does not have valid coordinates.`,
    {
      code: "INVALID_ADDRESS_COORDINATES",
      details: address,
    }
  );
}

function tryLocationFromAddress(
  address: JsonObject,
  source: LocationSource
): ResolvedLocation | undefined {
  const lat = Number(address.latitude);
  const lng = Number(address.longitude);
  if (!(Number.isFinite(lat) && Number.isFinite(lng))) {
    return;
  }

  return {
    addressId: stringValue(address.id),
    label: stringValue(address.name),
    lat,
    lng,
    source,
  };
}

export function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new TranquiloError(`Expected a number, got "${String(value)}".`, {
      code: "INVALID_NUMBER",
    });
  }
  return parsed;
}

function padDatePart(value: number): string {
  return String(value).padStart(2, "0");
}

function formatLocalDateTime(date: Date): string {
  return [
    date.getFullYear(),
    "-",
    padDatePart(date.getMonth() + 1),
    "-",
    padDatePart(date.getDate()),
    "T",
    padDatePart(date.getHours()),
    ":",
    padDatePart(date.getMinutes()),
    ":",
    padDatePart(date.getSeconds()),
  ].join("");
}

function formatDateTimeParts(parts: {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second?: number | undefined;
  year: number;
}): string {
  return [
    parts.year,
    "-",
    padDatePart(parts.month),
    "-",
    padDatePart(parts.day),
    "T",
    padDatePart(parts.hour),
    ":",
    padDatePart(parts.minute),
    ":",
    padDatePart(parts.second ?? 0),
  ].join("");
}

function parseHumanTime(value: string): {
  hour: number;
  minute: number;
  second: number;
} {
  const match = HUMAN_TIME_RE.exec(value.trim());
  if (!match) {
    throw new TranquiloError(
      `Could not parse slot time "${value}". Use examples like "today 6pm", "tomorrow 8:30am", or "2026-04-23 18:00".`,
      { code: "INVALID_TIME" }
    );
  }
  let hour = Number(match[1]);
  const minute = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.toLowerCase();
  if (meridiem) {
    if (hour < 1 || hour > 12) {
      throw new TranquiloError("12-hour times must use hours 1 through 12.", {
        code: "INVALID_TIME",
      });
    }
    if (meridiem === "am") {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour > 23) {
    throw new TranquiloError("24-hour times must use hours 0 through 23.", {
      code: "INVALID_TIME",
    });
  }
  return { hour, minute, second: 0 };
}

function todayDateParts(): { day: number; month: number; year: number } {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

function dateFromParts(parts: {
  day: number;
  month: number;
  year: number;
}): Date {
  const date = new Date(parts.year, parts.month - 1, parts.day);
  if (
    date.getFullYear() !== parts.year ||
    date.getMonth() !== parts.month - 1 ||
    date.getDate() !== parts.day
  ) {
    throw new TranquiloError("Slot date is not valid.", {
      code: "INVALID_DATE",
      details: parts,
    });
  }
  return date;
}

function formatHumanDateAndTime(
  date: { day: number; month: number; year: number },
  timeText: string
): string {
  dateFromParts(date);
  return formatDateTimeParts({ ...date, ...parseHumanTime(timeText) });
}

function parseExplicitHumanDateTime(normalized: string): string | undefined {
  const humanDateTime = HUMAN_DATE_TIME_RE.exec(normalized);
  if (humanDateTime) {
    const [
      ,
      yearFirst,
      monthFirst,
      dayFirst,
      timeFirst,
      daySecond,
      monthSecond,
      yearSecond,
      timeSecond,
    ] = humanDateTime;
    if (yearFirst && monthFirst && dayFirst && timeFirst) {
      return formatHumanDateAndTime(
        {
          day: Number(dayFirst),
          month: Number(monthFirst),
          year: Number(yearFirst),
        },
        timeFirst
      );
    }
    if (daySecond && monthSecond && yearSecond && timeSecond) {
      return formatHumanDateAndTime(
        {
          day: Number(daySecond),
          month: Number(monthSecond),
          year: Number(yearSecond),
        },
        timeSecond
      );
    }
  }
  return;
}

function parseRelativeHumanDateTime(normalized: string): string | undefined {
  const relative = RELATIVE_DATE_TIME_RE.exec(normalized);
  if (relative) {
    const [, label, timeText] = relative;
    if (!(label && timeText)) {
      return;
    }
    const date = new Date();
    if (label.toLowerCase() === "tomorrow") {
      date.setDate(date.getDate() + 1);
    }
    return formatHumanDateAndTime(
      {
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      },
      timeText
    );
  }
  return;
}

function parseMonthHumanDateTime(normalized: string): string | undefined {
  const monthDate = MONTH_DATE_TIME_RE.exec(normalized);
  if (monthDate) {
    const [, dayText, monthText, yearText, timeText] = monthDate;
    if (!(dayText && monthText && timeText)) {
      return;
    }
    const current = todayDateParts();
    const month = MONTHS.get(monthText.toLowerCase());
    if (!month) {
      return;
    }
    return formatHumanDateAndTime(
      {
        day: Number(dayText),
        month,
        year: yearText ? Number(yearText) : current.year,
      },
      timeText
    );
  }
  return;
}

function parseMonthFirstHumanDateTime(normalized: string): string | undefined {
  const monthFirst = MONTH_FIRST_DATE_TIME_RE.exec(normalized);
  if (monthFirst) {
    const [, monthText, dayText, yearText, timeText] = monthFirst;
    if (!(monthText && dayText && timeText)) {
      return;
    }
    const current = todayDateParts();
    const month = MONTHS.get(monthText.toLowerCase());
    if (!month) {
      return;
    }
    return formatHumanDateAndTime(
      {
        day: Number(dayText),
        month,
        year: yearText ? Number(yearText) : current.year,
      },
      timeText
    );
  }
  return;
}

function parseWeekdayHumanDateTime(normalized: string): string | undefined {
  const weekday = WEEKDAY_DATE_TIME_RE.exec(normalized);
  if (weekday) {
    const [, dayText, timeText] = weekday;
    if (!(dayText && timeText)) {
      return;
    }
    const target = WEEKDAYS.get(dayText.toLowerCase());
    if (!target) {
      return;
    }
    const date = new Date();
    const current = date.getDay() === 0 ? 7 : date.getDay();
    date.setDate(date.getDate() + ((target - current + 7) % 7));
    return formatHumanDateAndTime(
      {
        day: date.getDate(),
        month: date.getMonth() + 1,
        year: date.getFullYear(),
      },
      timeText
    );
  }
  return;
}

function parseHumanSlotTime(text: string): string | undefined {
  const normalized = text.trim().replace(/\s+/g, " ");
  return (
    parseExplicitHumanDateTime(normalized) ??
    parseRelativeHumanDateTime(normalized) ??
    parseMonthHumanDateTime(normalized) ??
    parseMonthFirstHumanDateTime(normalized) ??
    parseWeekdayHumanDateTime(normalized)
  );
}

export function formatSlotTime(value?: string | Date): string {
  if (value === undefined) {
    return formatLocalDateTime(new Date());
  }
  if (value instanceof Date) {
    return formatLocalDateTime(value);
  }

  const text = value.trim();
  if (LOCAL_DATE_TIME_RE.test(text)) {
    return text.length === 16 ? `${text}:00` : text;
  }

  if (ISO_DATE_TIME_PREFIX_RE.test(text)) {
    const parsed = new Date(text);
    if (!Number.isNaN(parsed.valueOf())) {
      return formatLocalDateTime(parsed);
    }
  }

  const human = parseHumanSlotTime(text);
  if (human) {
    return human;
  }

  const parsed = new Date(text);
  if (Number.isNaN(parsed.valueOf())) {
    throw new TranquiloError(
      '--time must be a slot date/time, for example "today 6pm", "tomorrow 8:30am", or "2026-04-20T12:17:24".',
      { code: "INVALID_TIME" }
    );
  }
  return formatLocalDateTime(parsed);
}

export function errorToJson(error: unknown): {
  ok: false;
  error: {
    code: string;
    details?: unknown;
    message: string;
    status?: number | undefined;
  };
} {
  if (error instanceof TranquiloError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        status: error.status,
        details: error.details,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "UNEXPECTED_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
  };
}
