import { Temporal } from "@js-temporal/polyfill";
import type { TranquiloClient } from "./api";
import {
  createCheckout,
  getCheckoutOrder,
  publicCheckoutOrder,
} from "./checkout";
import { createClient, formatSlotTime, resolveLocation } from "./context";
import { assertScheduledServiceable } from "./serviceability";
import { extractActionableSlots, type SlotRow } from "./slots";
import { nowPlainDateTime, systemTimezone, todayPlainDate } from "./time";
import type { JsonObject, ResolvedLocation } from "./types";
import { TranquiloError } from "./types";

const DEFAULT_PRESET = "next-4-days";
const DEFAULT_WINDOW = "smart";
const BOOKABLE_DAYS = 4;
const HH_MM_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const HOUR_DURATION_PATTERN = /^(\d+(?:\.\d+)?)h$/;
const MINUTE_DURATION_PATTERN = /^(\d+)m?$/;

export type HousehelpWindow =
  | "after-work"
  | "any"
  | "before-work"
  | "custom"
  | "smart"
  | "weekend";

export type HousehelpDatePreset =
  | "next-4-days"
  | "today"
  | "tomorrow"
  | "weekend";

interface HousehelpOption {
  durationMinutes: number;
  effectivePrice?: number | undefined;
  formattedSaving?: string | undefined;
  listingId: string;
  listingItemId: string;
  name: string;
  price?: number | undefined;
  saving?: number | undefined;
}

export interface HousehelpFindInput {
  addressId?: string | undefined;
  around?: string | undefined;
  date?: string | undefined;
  duration?: string | number | undefined;
  durationOrder?: string[] | string | undefined;
  exactDate?: string | undefined;
  exactDuration?: boolean | undefined;
  exactSlot?: string | undefined;
  exactTime?: string | undefined;
  flexDays?: number | undefined;
  fromDate?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  preset?: HousehelpDatePreset | undefined;
  timeWindow?: string[] | string | undefined;
  toDate?: string | undefined;
  window?: HousehelpWindow | undefined;
}

export interface HousehelpSlotMatch {
  durationMinutes: number;
  endTime?: string | undefined;
  formattedSaving?: string | undefined;
  listingId: string;
  listingItemId: string;
  price?: number | undefined;
  rank: number;
  rankReason: string;
  savings?: number | undefined;
  slot: SlotRow;
  startTime: string;
}

interface HousehelpFindResult {
  bookingType: "SCHEDULED";
  dateRange: { from: string; to: string };
  durationOrder: number[];
  location: ResolvedLocation;
  options: HousehelpOption[];
  queryListingIds: string[];
  serviceableBookingTypes: string[];
  slots: HousehelpSlotMatch[];
  windows: TimeWindow[];
}

export interface HousehelpPrepareInput extends HousehelpFindInput {
  noInteractive?: boolean | undefined;
  slot: string;
  yes?: boolean | undefined;
}

interface HousehelpPrepareResult {
  amount: number;
  durationMinutes: number;
  listingId: string;
  listingItemId: string;
  location: ResolvedLocation;
  order: ReturnType<typeof publicCheckoutOrder>;
  payCommand: string;
  selectedSlot: string;
  userInstruction: string;
}

interface TimeWindow {
  from: string;
  label: string;
  to: string;
}

interface SlotWatchWindowInput {
  from?: string | undefined;
  timeWindow?: HousehelpWindow | undefined;
  to?: string | undefined;
}

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

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function dataOf(payload: JsonObject): unknown {
  return payload.data ?? payload;
}

function listingArray(payload: unknown): JsonObject[] {
  const root = asObject(payload);
  const data = asObject(dataOf(root ?? {}));
  const nested = asObject(data?.data);
  return [root?.listings, data?.listings, nested?.listings, data?.data]
    .flatMap((candidate) => asArray(candidate))
    .map((item) => asObject(item))
    .filter((item): item is JsonObject => Boolean(item));
}

function hasHousehelpSkill(listing: JsonObject): boolean {
  return asArray(listing.requiredSkills).some(
    (skill) => String(skill).toUpperCase() === "HOUSE_HELP"
  );
}

function isHourlyBundle(listing: JsonObject): boolean {
  const metadata = asObject(listing.metadata);
  return (
    stringValue(metadata?.type) === "HOURLY_BUNDLE" ||
    stringValue(metadata?.handlingType) === "BUNDLE" ||
    stringValue(listing.name)?.toLowerCase().includes("hourly") === true
  );
}

function optionDuration(item: JsonObject): number | undefined {
  const raw =
    numberValue(item.timeTaken) ??
    (String(item.unit ?? "").toUpperCase() === "MINUTE"
      ? numberValue(item.qty)
      : undefined);
  return raw && raw > 0 ? Math.round(raw) : undefined;
}

function resolveHousehelpOptionsFromListings(
  payload: unknown
): HousehelpOption[] {
  const options = listingArray(payload).flatMap((listing) => {
    if (!(hasHousehelpSkill(listing) && isHourlyBundle(listing))) {
      return [];
    }
    const listingId = stringValue(listing.id);
    if (!listingId) {
      return [];
    }
    return asArray(listing.items).flatMap((rawItem) => {
      const item = asObject(rawItem);
      const listingItemId = item ? stringValue(item.id) : undefined;
      const durationMinutes = item ? optionDuration(item) : undefined;
      if (!(item && listingItemId && durationMinutes)) {
        return [];
      }
      return [
        {
          durationMinutes,
          effectivePrice:
            numberValue(item.effectivePrice) ??
            numberValue(listing.effectivePrice),
          formattedSaving:
            stringValue(listing.formattedSaving) ??
            stringValue(item.formattedSaving),
          listingId,
          listingItemId,
          name:
            stringValue(listing.name) ?? stringValue(item.name) ?? "House Help",
          price: numberValue(item.price) ?? numberValue(listing.price),
          saving: numberValue(listing.saving) ?? numberValue(item.saving),
        },
      ];
    });
  });

  const byDuration = new Map<number, HousehelpOption>();
  for (const option of options.sort(
    (a, b) => a.durationMinutes - b.durationMinutes
  )) {
    byDuration.set(option.durationMinutes, option);
  }
  return [...byDuration.values()];
}

export async function resolveHousehelpOptions(
  client: TranquiloClient,
  location: Pick<ResolvedLocation, "lat" | "lng">
): Promise<HousehelpOption[]> {
  const options = resolveHousehelpOptionsFromListings(
    dataOf(await client.listings(location))
  );
  if (!options.length) {
    throw new TranquiloError(
      "Could not resolve House Help hourly options from the live catalog.",
      { code: "HOUSEHELP_OPTIONS_NOT_FOUND" }
    );
  }
  return options;
}

function parseDurationMinutes(value: string | number): number {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value > 0) {
      return Math.round(value);
    }
    throw new TranquiloError("Duration must be positive.", {
      code: "INVALID_DURATION",
    });
  }
  const text = value.trim().toLowerCase();
  const hourMatch = HOUR_DURATION_PATTERN.exec(text);
  if (hourMatch) {
    return Math.round(Number(hourMatch[1]) * 60);
  }
  const minuteMatch = MINUTE_DURATION_PATTERN.exec(text);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }
  throw new TranquiloError("Duration must look like 60, 60m, 1h, or 1.5h.", {
    code: "INVALID_DURATION",
  });
}

function parseDurationList(value: string[] | string | undefined): number[] {
  const values = Array.isArray(value)
    ? value.flatMap((item) => item.split(","))
    : (value?.split(",") ?? []);
  return values
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseDurationMinutes);
}

function durationPreferenceOrder(
  options: HousehelpOption[],
  input: Pick<
    HousehelpFindInput,
    "duration" | "durationOrder" | "exactDuration"
  >
): HousehelpOption[] {
  const explicitOrder = parseDurationList(input.durationOrder);
  if (explicitOrder.length) {
    const ranked = explicitOrder
      .map((duration) =>
        options.find((option) => option.durationMinutes === duration)
      )
      .filter((option): option is HousehelpOption => Boolean(option));
    return input.exactDuration ? ranked.slice(0, 1) : ranked;
  }
  if (input.duration === undefined) {
    return options;
  }
  const preferred = parseDurationMinutes(input.duration);
  const exact = options.filter(
    (option) => option.durationMinutes === preferred
  );
  if (input.exactDuration) {
    return exact;
  }
  const longer = options
    .filter((option) => option.durationMinutes > preferred)
    .sort((a, b) => a.durationMinutes - b.durationMinutes);
  const shorter = options
    .filter((option) => option.durationMinutes < preferred)
    .sort((a, b) => b.durationMinutes - a.durationMinutes);
  return [...exact, ...longer, ...shorter];
}

function today(): Temporal.PlainDate {
  return todayPlainDate(systemTimezone());
}

function currentDateTime(): Temporal.PlainDateTime {
  return nowPlainDateTime(systemTimezone());
}

function plainDate(value: string, flag: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw new TranquiloError(`${flag} must be an ISO date like 2026-04-20.`, {
      code: "INVALID_DATE",
    });
  }
}

function nextSaturday(date: Temporal.PlainDate): Temporal.PlainDate {
  const daysUntilSaturday = (6 - date.dayOfWeek + 7) % 7;
  return date.add({ days: daysUntilSaturday });
}

function bookableEnd(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.add({ days: BOOKABLE_DAYS - 1 });
}

function resolveDateRange(input: HousehelpFindInput): {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
} {
  const current = today();
  if (input.exactSlot) {
    const date = Temporal.PlainDateTime.from(
      formatSlotTime(input.exactSlot)
    ).toPlainDate();
    return { from: date, to: date };
  }
  if (input.exactDate) {
    const date = plainDate(input.exactDate, "--exact-date");
    return { from: date, to: date };
  }
  if (input.date) {
    const date = plainDate(input.date, "--date");
    return { from: date, to: date };
  }
  if (input.around) {
    const center = plainDate(input.around, "--around");
    const flexDays = Math.max(
      0,
      Math.min(BOOKABLE_DAYS - 1, input.flexDays ?? 0)
    );
    return {
      from: center.subtract({ days: flexDays }),
      to: center.add({ days: flexDays }),
    };
  }
  if (input.fromDate || input.toDate) {
    if (!(input.fromDate && input.toDate)) {
      throw new TranquiloError("Pass both --from-date and --to-date.", {
        code: "DATE_RANGE_REQUIRED",
      });
    }
    return {
      from: plainDate(input.fromDate, "--from-date"),
      to: plainDate(input.toDate, "--to-date"),
    };
  }
  const preset = input.preset ?? DEFAULT_PRESET;
  if (preset === "today") {
    return { from: current, to: current };
  }
  if (preset === "tomorrow") {
    const tomorrow = current.add({ days: 1 });
    return { from: tomorrow, to: tomorrow };
  }
  if (preset === "weekend") {
    const start = nextSaturday(current);
    return { from: start, to: start.add({ days: 1 }) };
  }
  return { from: current, to: bookableEnd(current) };
}

function parseTime(value: string, flag: string): string {
  if (!HH_MM_PATTERN.test(value)) {
    throw new TranquiloError(`${flag} must use HH:mm format.`, {
      code: "INVALID_TIME",
    });
  }
  return Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" });
}

function parseTimeWindow(value: string, index: number): TimeWindow {
  const [from, to, extra] = value.split("-");
  if (!(from && to) || extra !== undefined) {
    throw new TranquiloError("--time-window must look like HH:mm-HH:mm.", {
      code: "INVALID_TIME_WINDOW",
    });
  }
  return {
    from: parseTime(from, "--time-window"),
    label: `custom-${index + 1}`,
    to: parseTime(to, "--time-window"),
  };
}

function resolveWindows(input: HousehelpFindInput): TimeWindow[] {
  let explicit: string[] = [];
  if (Array.isArray(input.timeWindow)) {
    explicit = input.timeWindow;
  } else if (input.timeWindow) {
    explicit = [input.timeWindow];
  }
  if (explicit.length) {
    return explicit.map(parseTimeWindow);
  }
  if (input.exactSlot) {
    const time = Temporal.PlainDateTime.from(formatSlotTime(input.exactSlot))
      .toPlainTime()
      .toString({ smallestUnit: "minute" });
    return [{ from: time, label: "exact-slot", to: time }];
  }
  if (input.exactTime) {
    const time = parseTime(input.exactTime, "--exact-time");
    return [{ from: time, label: "exact-time", to: time }];
  }
  const window = input.window ?? DEFAULT_WINDOW;
  if (window === "before-work") {
    return [{ from: "06:00", label: "before-work", to: "09:00" }];
  }
  if (window === "after-work") {
    return [{ from: "18:00", label: "after-work", to: "22:00" }];
  }
  if (window === "weekend") {
    return [{ from: "09:00", label: "weekend", to: "20:00" }];
  }
  if (window === "any") {
    return [{ from: "06:00", label: "any", to: "22:00" }];
  }
  if (window === "custom") {
    throw new TranquiloError(
      "Custom window requires at least one --time-window HH:mm-HH:mm.",
      { code: "TIME_RANGE_REQUIRED" }
    );
  }
  return [
    { from: "18:00", label: "after-work", to: "22:00" },
    { from: "06:00", label: "before-work", to: "09:00" },
    { from: "09:00", label: "weekend", to: "20:00" },
  ];
}

export function slotWatchWindowFromHousehelpInput(
  input: Pick<HousehelpFindInput, "timeWindow" | "window">
): SlotWatchWindowInput {
  let explicit: string[] = [];
  if (Array.isArray(input.timeWindow)) {
    explicit = input.timeWindow;
  } else if (input.timeWindow) {
    explicit = [input.timeWindow];
  }
  if (explicit.length > 1) {
    throw new TranquiloError(
      "House Help watches support one custom time window. Create separate watches for multiple windows.",
      { code: "WATCH_TIME_WINDOW_UNSUPPORTED" }
    );
  }
  if (explicit.length === 1) {
    const window = parseTimeWindow(explicit[0] ?? "", 0);
    return { from: window.from, to: window.to };
  }
  return { timeWindow: input.window };
}

function slotDateTime(slot: SlotRow): Temporal.PlainDateTime | undefined {
  try {
    return Temporal.PlainDateTime.from(formatSlotTime(slot.startTime));
  } catch {
    return;
  }
}

function plainDateTimeFromSlot(slot: string): Temporal.PlainDateTime {
  try {
    return Temporal.PlainDateTime.from(formatSlotTime(slot));
  } catch {
    throw new TranquiloError("Slot is not a valid local date/time.", {
      code: "INVALID_TIME",
      details: { slot },
    });
  }
}

function windowRank(
  slot: SlotRow,
  windows: TimeWindow[]
): { label: string; rank: number } | undefined {
  const dateTime = slotDateTime(slot);
  if (!dateTime) {
    return;
  }
  const slotTime = dateTime.toPlainTime();
  for (const [index, window] of windows.entries()) {
    if (window.label === "exact-slot" || window.label === "exact-time") {
      const exact = Temporal.PlainTime.compare(
        slotTime,
        Temporal.PlainTime.from(window.from)
      );
      if (exact === 0) {
        return { label: window.label, rank: index };
      }
      continue;
    }
    const isWeekend = dateTime.toPlainDate().dayOfWeek >= 6;
    if (window.label === "weekend" && !isWeekend) {
      continue;
    }
    if (
      Temporal.PlainTime.compare(
        slotTime,
        Temporal.PlainTime.from(window.from)
      ) >= 0 &&
      Temporal.PlainTime.compare(slotTime, Temporal.PlainTime.from(window.to)) <
        0
    ) {
      return { label: window.label, rank: index };
    }
  }
  return;
}

function daysToQuery(range: {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}): number {
  const current = today();
  const start =
    Temporal.PlainDate.compare(range.from, current) < 0 ? current : range.from;
  return Math.min(Math.max(start.until(range.to).days + 1, 1), BOOKABLE_DAYS);
}

function slotQueryTime(
  input: Pick<HousehelpFindInput, "exactSlot">,
  range: { from: Temporal.PlainDate },
  now: Temporal.PlainDateTime
): string {
  if (input.exactSlot) {
    return formatSlotTime(input.exactSlot);
  }
  if (Temporal.PlainDate.compare(range.from, now.toPlainDate()) <= 0) {
    return now.toString({ smallestUnit: "second" });
  }
  return `${range.from.toString()}T00:00:00`;
}

function assertBookableDateRange(range: {
  from: Temporal.PlainDate;
  to: Temporal.PlainDate;
}): void {
  const current = today();
  const last = bookableEnd(current);
  if (
    Temporal.PlainDate.compare(range.from, current) < 0 ||
    Temporal.PlainDate.compare(range.to, last) > 0
  ) {
    throw new TranquiloError(
      `Tranquilo House Help can only be booked from ${current.toString()} through ${last.toString()}.`,
      {
        code: "BOOKING_DATE_OUT_OF_RANGE",
        details: {
          bookableFrom: current.toString(),
          bookableTo: last.toString(),
          requestedFrom: range.from.toString(),
          requestedTo: range.to.toString(),
        },
      }
    );
  }
}

function inDateRange(
  slot: SlotRow,
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate }
): boolean {
  const dateTime = slotDateTime(slot);
  if (!dateTime) {
    return false;
  }
  const date = dateTime.toPlainDate();
  return (
    Temporal.PlainDate.compare(date, range.from) >= 0 &&
    Temporal.PlainDate.compare(date, range.to) <= 0
  );
}

function isFutureSlot(slot: SlotRow, now: Temporal.PlainDateTime): boolean {
  const dateTime = slotDateTime(slot);
  return Boolean(
    dateTime && Temporal.PlainDateTime.compare(dateTime, now) >= 0
  );
}

function assertSlotNotPast(slot: string, now: Temporal.PlainDateTime): void {
  const requested = plainDateTimeFromSlot(slot);
  if (Temporal.PlainDateTime.compare(requested, now) >= 0) {
    return;
  }
  throw new TranquiloError(
    `House Help slot ${requested.toString({ smallestUnit: "minute" })} is in the past. Pick a future slot.`,
    {
      code: "BOOKING_SLOT_IN_PAST",
      details: {
        currentTime: now.toString({ smallestUnit: "minute" }),
        requestedSlot: requested.toString({ smallestUnit: "minute" }),
      },
    }
  );
}

function exactSlotMatches(slot: SlotRow, exactSlot?: string): boolean {
  return (
    !exactSlot || formatSlotTime(slot.startTime) === formatSlotTime(exactSlot)
  );
}

function optionMatchesSlotGroup(
  slot: SlotRow,
  option: HousehelpOption
): boolean {
  const listingIds = slot.group?.listingIds?.map((item) => String(item));
  return !listingIds?.length || listingIds.includes(option.listingId);
}

export async function findHousehelpSlots(
  input: HousehelpFindInput
): Promise<HousehelpFindResult> {
  const now = currentDateTime();
  const dateRange = resolveDateRange(input);
  if (Temporal.PlainDate.compare(dateRange.from, dateRange.to) > 0) {
    throw new TranquiloError("Date range start must be before end.", {
      code: "INVALID_DATE_RANGE",
    });
  }
  assertBookableDateRange(dateRange);
  if (input.exactSlot) {
    assertSlotNotPast(input.exactSlot, now);
  }
  const windows = resolveWindows(input);
  const client = await createClient();
  const location = await resolveLocation(client, input);
  const serviceability = await assertScheduledServiceable(client, location);
  const options = await resolveHousehelpOptions(client, location);
  const candidates = durationPreferenceOrder(options, input);
  if (!candidates.length) {
    throw new TranquiloError(
      "No backend-supported House Help duration matched the request.",
      { code: "HOUSEHELP_DURATION_NOT_FOUND" }
    );
  }
  const result = await client.slotsBySkill({
    ...location,
    bookingType: serviceability.bookingType,
    days: daysToQuery(dateRange),
    listingIds: candidates.map((option) => option.listingId),
    time: slotQueryTime(input, dateRange, now),
  });
  const slots = extractActionableSlots(dataOf(result));
  const durationRank = new Map(
    candidates.map((option, index) => [option.durationMinutes, index])
  );
  const matches = slots
    .filter((slot) => inDateRange(slot, dateRange))
    .filter((slot) => isFutureSlot(slot, now))
    .filter((slot) => exactSlotMatches(slot, input.exactSlot))
    .flatMap((slot) => {
      const matchedWindow = windowRank(slot, windows);
      if (!matchedWindow) {
        return [];
      }
      return candidates
        .filter((option) => optionMatchesSlotGroup(slot, option))
        .map((option) => {
          const dateTime = slotDateTime(slot);
          const datePenalty = dateTime
            ? Math.abs(dateRange.from.until(dateTime.toPlainDate()).days)
            : 0;
          const rank =
            matchedWindow.rank * 1_000_000 +
            datePenalty * 10_000 +
            (durationRank.get(option.durationMinutes) ?? 0) * 100 +
            (dateTime?.hour ?? 0) * 2 +
            (dateTime?.minute ?? 0) / 30;
          return {
            durationMinutes: option.durationMinutes,
            endTime: slot.endTime,
            formattedSaving: option.formattedSaving,
            listingId: option.listingId,
            listingItemId: option.listingItemId,
            price: option.effectivePrice,
            rank,
            rankReason: `${matchedWindow.label}, ${option.durationMinutes} min`,
            savings: option.saving,
            slot,
            startTime: slot.startTime,
          };
        });
    })
    .sort((a, b) => a.rank - b.rank)
    .map((match, index) => ({ ...match, rank: index + 1 }));

  return {
    bookingType: serviceability.bookingType,
    dateRange: {
      from: dateRange.from.toString(),
      to: dateRange.to.toString(),
    },
    durationOrder: candidates.map((option) => option.durationMinutes),
    location,
    options,
    queryListingIds: candidates.map((option) => option.listingId),
    serviceableBookingTypes: serviceability.serviceableBookingTypes,
    slots: matches,
    windows,
  };
}

function selectedListingIdPair(selectedListingId: string): string[] {
  return [`${selectedListingId}=1`];
}

export async function prepareHousehelpBooking(
  input: HousehelpPrepareInput
): Promise<HousehelpPrepareResult> {
  const findResult = await findHousehelpSlots({
    ...input,
    exactDuration: true,
    exactSlot: input.slot,
  });
  const selected = findResult.slots[0];
  if (!selected) {
    throw new TranquiloError(
      "The selected House Help slot is no longer actionable.",
      { code: "HOUSEHELP_SLOT_UNAVAILABLE" }
    );
  }
  const checkoutAddressId = input.addressId ?? findResult.location.addressId;
  if (!checkoutAddressId) {
    throw new TranquiloError(
      "House Help checkout requires a saved address. Pass --address-id or set an active delivery address.",
      {
        code: "CHECKOUT_ADDRESS_REQUIRED",
        details: { location: findResult.location },
      }
    );
  }
  const pairs = selectedListingIdPair(selected.listingId);
  const order = await createCheckout({
    addressId: checkoutAddressId,
    expectedDurationMinutes: selected.durationMinutes,
    expectedListingId: selected.listingId,
    expectedListingItemId: selected.listingItemId,
    item: pairs,
    slot: selected.startTime,
  });
  return {
    amount: order.amount,
    durationMinutes: selected.durationMinutes,
    listingId: selected.listingId,
    listingItemId: selected.listingItemId,
    location: findResult.location,
    order,
    payCommand: order.payCommand,
    selectedSlot: selected.startTime,
    userInstruction: `Run \`${order.payCommand}\` in a local terminal to scan the QR.`,
  };
}

export async function househelpPaymentHandoff(orderId: string): Promise<{
  order: ReturnType<typeof publicCheckoutOrder>;
  payCommand: string;
  userInstruction: string;
}> {
  const order = publicCheckoutOrder(await getCheckoutOrder(orderId));
  return {
    order,
    payCommand: order.payCommand,
    userInstruction: `Run \`${order.payCommand}\` in a local terminal to scan the QR.`,
  };
}
