import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { execa } from "execa";
import { cartSlotListingIds } from "./cart";
import { createClient, resolveLocation } from "./context";
import { stateDir } from "./paths";
import { normalizeSupportedBookingType } from "./serviceability";
import { extractSlots, isActionableSlot, type SlotRow } from "./slots";
import { nowInstant, systemTimezone } from "./time";
import type { LocationInput } from "./types";
import { TranquiloError } from "./types";

const STORE_VERSION = 1;
const DEFAULT_PRESET = "next-4-days";
const DEFAULT_WINDOW = "smart";
const STORE_FILE = "slot-watches.json";
const EVENTS_FILE = "slot-watch-events.jsonl";
const LOCK_FILE = "slot-watch.lock";
const BOOKABLE_DAYS = 4;
const MAX_EVENT_LINES = 500;
const HH_MM_PATTERN = /^\d{2}:\d{2}$/;
const SLOT_TIME_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;
const SHELL_SAFE_PATTERN = /^[A-Za-z0-9_./:=@-]+$/;

export type WatchStatus = "enabled" | "expired" | "found" | "paused";
type DatePreset = "next-4-days" | "today" | "tomorrow" | "weekend";
type WindowPreset =
  | "after-work"
  | "any"
  | "before-work"
  | "custom"
  | "smart"
  | "weekend";

/** @internal White-box tested watch state shape. */
export interface SlotWatchLocation extends LocationInput {
  source: "address" | "coordinates";
}

/** @internal White-box tested watch state shape. */
export interface SlotWatchNotifications {
  desktop: boolean;
  slackWebhookUrl?: string | undefined;
}

/** @internal White-box tested watch state shape. */
export interface SlotWatchWindow {
  from?: string | undefined;
  preset: WindowPreset;
  to?: string | undefined;
}

/** @internal White-box tested watch state shape. */
export interface SlotWatchSpec {
  bookingType: string;
  dateRange: {
    from: string;
    to: string;
  };
  itemIds: string[];
  location: SlotWatchLocation;
  notifications?: SlotWatchNotifications | undefined;
  preset?: DatePreset | undefined;
  timezone: string;
  window: SlotWatchWindow;
}

/** @internal White-box tested watch state shape. */
export interface SlotWatchMatch {
  actionCommand?: string | undefined;
  actionHint?: string | undefined;
  endTime?: string | undefined;
  isExperiencingSurge: boolean;
  slotsLeft?: number | undefined;
  startTime: string;
  surgePrice?: number | undefined;
}

/** @internal White-box tested watch state shape. */
export interface SlotWatch {
  createdAt: string;
  foundMatch?: SlotWatchMatch | undefined;
  id: string;
  lastError?: string | undefined;
  lastRunAt?: string | undefined;
  name?: string | undefined;
  nextRunAt?: string | undefined;
  runCount: number;
  spec: SlotWatchSpec;
  status: WatchStatus;
  updatedAt: string;
}

interface SlotWatchStore {
  version: 1;
  watches: SlotWatch[];
}

interface CreateSlotWatchInput {
  addressId?: string | undefined;
  bookingType?: string | undefined;
  date?: string | undefined;
  desktopNotify?: boolean | undefined;
  from?: string | undefined;
  fromDate?: string | undefined;
  item?: string[] | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  name?: string | undefined;
  preset?: DatePreset | undefined;
  slackWebhookUrl?: string | undefined;
  timeWindow?: WindowPreset | undefined;
  timezone?: string | undefined;
  to?: string | undefined;
  toDate?: string | undefined;
}

interface RunOptions {
  force?: boolean | undefined;
  notify?: boolean | undefined;
  now?: Temporal.Instant | undefined;
  watchId?: string | undefined;
}

interface RunDueResult {
  checked: number;
  errors: number;
  found: Array<{ id: string; match: SlotWatchMatch }>;
  locked: boolean;
  skipped: number;
}

interface SchedulerCommand {
  args: string[];
  command: string;
}

interface SchedulerFiles {
  launchdPlist: string;
  linuxService: string;
  linuxTimer: string;
  runnerScript: string;
  windowsCommand: string;
}

function slotWatchPath(): string {
  return path.join(stateDir(), STORE_FILE);
}

function eventsPath(): string {
  return path.join(stateDir(), EVENTS_FILE);
}

function lockPath(): string {
  return path.join(stateDir(), LOCK_FILE);
}

async function ensureStateDir(): Promise<void> {
  await fs.mkdir(stateDir(), { recursive: true });
}

function emptyStore(): SlotWatchStore {
  return { version: STORE_VERSION, watches: [] };
}

async function loadSlotWatchStore(): Promise<SlotWatchStore> {
  try {
    const text = await fs.readFile(slotWatchPath(), "utf8");
    const parsed = JSON.parse(text) as SlotWatchStore;
    return {
      version: STORE_VERSION,
      watches: Array.isArray(parsed.watches) ? parsed.watches : [],
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyStore();
    }
    throw error;
  }
}

async function saveSlotWatchStore(store: SlotWatchStore): Promise<void> {
  await ensureStateDir();
  await fs.writeFile(slotWatchPath(), `${JSON.stringify(store, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function appendEvent(event: Record<string, unknown>): Promise<void> {
  await ensureStateDir();
  const line = `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`;
  const file = eventsPath();
  await fs.appendFile(file, line, { mode: 0o600 });
  try {
    const text = await fs.readFile(file, "utf8");
    const lines = text.trimEnd().split("\n");
    if (lines.length > MAX_EVENT_LINES) {
      await fs.writeFile(
        file,
        `${lines.slice(-MAX_EVENT_LINES).join("\n")}\n`,
        {
          mode: 0o600,
        }
      );
    }
  } catch {
    // Event history is best effort.
  }
}

function parseDate(value: string, field: string): Temporal.PlainDate {
  try {
    return Temporal.PlainDate.from(value);
  } catch {
    throw new TranquiloError(`${field} must be an ISO date like 2026-04-20.`, {
      code: "INVALID_DATE",
    });
  }
}

function parseTime(value: string, field: string): string {
  if (!HH_MM_PATTERN.test(value)) {
    throw new TranquiloError(`${field} must use HH:mm format.`, {
      code: "INVALID_TIME",
    });
  }
  try {
    return Temporal.PlainTime.from(value).toString({ smallestUnit: "minute" });
  } catch {
    throw new TranquiloError(`${field} must use HH:mm format.`, {
      code: "INVALID_TIME",
    });
  }
}

function plainToday(
  timezone: string,
  now: Temporal.Instant = nowInstant()
): Temporal.PlainDate {
  return now.toZonedDateTimeISO(timezone).toPlainDate();
}

function nextSaturday(today: Temporal.PlainDate): Temporal.PlainDate {
  const daysUntilSaturday = (6 - today.dayOfWeek + 7) % 7;
  return today.add({ days: daysUntilSaturday });
}

function bookableEnd(today: Temporal.PlainDate): Temporal.PlainDate {
  return today.add({ days: BOOKABLE_DAYS - 1 });
}

function assertBookableDateRange(
  range: { from: Temporal.PlainDate; to: Temporal.PlainDate },
  today: Temporal.PlainDate
): void {
  const last = bookableEnd(today);
  if (
    Temporal.PlainDate.compare(range.from, today) < 0 ||
    Temporal.PlainDate.compare(range.to, last) > 0
  ) {
    throw new TranquiloError(
      `Tranquilo slots can only be watched from ${today.toString()} through ${last.toString()}.`,
      {
        code: "BOOKING_DATE_OUT_OF_RANGE",
        details: {
          bookableFrom: today.toString(),
          bookableTo: last.toString(),
          requestedFrom: range.from.toString(),
          requestedTo: range.to.toString(),
        },
      }
    );
  }
}

/** @internal White-box tested date range resolver. */
export function resolveDateRange(
  input: Pick<CreateSlotWatchInput, "date" | "fromDate" | "preset" | "toDate">,
  timezone: string,
  now: Temporal.Instant = nowInstant()
): { from: string; preset?: DatePreset; to: string } {
  const today = plainToday(timezone, now);
  if (input.date) {
    const date = parseDate(input.date, "--date");
    assertBookableDateRange({ from: date, to: date }, today);
    return { from: date.toString(), to: date.toString() };
  }
  if (input.fromDate || input.toDate) {
    if (!(input.fromDate && input.toDate)) {
      throw new TranquiloError("Pass both --from-date and --to-date.", {
        code: "DATE_RANGE_REQUIRED",
      });
    }
    const from = parseDate(input.fromDate, "--from-date");
    const to = parseDate(input.toDate, "--to-date");
    if (Temporal.PlainDate.compare(from, to) > 0) {
      throw new TranquiloError("--from-date must be before --to-date.", {
        code: "INVALID_DATE_RANGE",
      });
    }
    assertBookableDateRange({ from, to }, today);
    return { from: from.toString(), to: to.toString() };
  }

  const preset = input.preset ?? DEFAULT_PRESET;
  if (!["next-4-days", "today", "tomorrow", "weekend"].includes(preset)) {
    throw new TranquiloError(`Unsupported date preset "${preset}".`, {
      code: "INVALID_DATE_PRESET",
    });
  }

  if (preset === "today") {
    return { from: today.toString(), preset, to: today.toString() };
  }
  if (preset === "tomorrow") {
    const tomorrow = today.add({ days: 1 });
    return { from: tomorrow.toString(), preset, to: tomorrow.toString() };
  }
  if (preset === "weekend") {
    const saturday = nextSaturday(today);
    assertBookableDateRange(
      { from: saturday, to: saturday.add({ days: 1 }) },
      today
    );
    return {
      from: saturday.toString(),
      preset,
      to: saturday.add({ days: 1 }).toString(),
    };
  }
  return {
    from: today.toString(),
    preset,
    to: bookableEnd(today).toString(),
  };
}

/** @internal White-box tested window resolver. */
export function resolveWindow(
  input: Pick<CreateSlotWatchInput, "from" | "timeWindow" | "to">
): SlotWatchWindow {
  if (input.from || input.to) {
    if (!(input.from && input.to)) {
      throw new TranquiloError(
        "Pass both --from and --to for custom windows.",
        {
          code: "TIME_RANGE_REQUIRED",
        }
      );
    }
    return {
      preset: "custom",
      from: parseTime(input.from, "--from"),
      to: parseTime(input.to, "--to"),
    };
  }

  const preset = input.timeWindow ?? DEFAULT_WINDOW;
  if (
    ![
      "after-work",
      "any",
      "before-work",
      "custom",
      "smart",
      "weekend",
    ].includes(preset)
  ) {
    throw new TranquiloError(`Unsupported window "${preset}".`, {
      code: "INVALID_WINDOW",
    });
  }
  if (preset === "custom") {
    throw new TranquiloError("Custom windows require --from and --to.", {
      code: "TIME_RANGE_REQUIRED",
    });
  }
  return { preset };
}

function windowBounds(
  window: SlotWatchWindow,
  date: Temporal.PlainDate
): { from: string; to: string } {
  if (window.preset === "custom") {
    return { from: window.from ?? "06:00", to: window.to ?? "22:00" };
  }
  if (window.preset === "before-work") {
    return { from: "06:00", to: "09:00" };
  }
  if (window.preset === "after-work") {
    return { from: "18:00", to: "22:00" };
  }
  if (window.preset === "weekend") {
    return { from: "09:00", to: "20:00" };
  }
  if (window.preset === "any") {
    return { from: "06:00", to: "22:00" };
  }
  return date.dayOfWeek >= 6
    ? { from: "09:00", to: "20:00" }
    : { from: "18:00", to: "22:00" };
}

function resolveLocationSpec(input: CreateSlotWatchInput): SlotWatchLocation {
  if (input.addressId) {
    return { addressId: input.addressId, source: "address" };
  }
  if (input.lat === undefined || input.lng === undefined) {
    throw new TranquiloError("Pass --address-id or both --lat and --lng.", {
      code: "LOCATION_REQUIRED",
    });
  }
  return { lat: input.lat, lng: input.lng, source: "coordinates" };
}

async function resolveCreateInputLocation(
  input: CreateSlotWatchInput
): Promise<CreateSlotWatchInput> {
  const needsLocation = !(
    input.addressId ||
    (input.lat !== undefined && input.lng !== undefined)
  );
  const needsItems = !input.item?.length;
  if (!(needsLocation || needsItems)) {
    return input;
  }
  const client = await createClient();
  let resolved = input;
  if (needsLocation) {
    const location = await resolveLocation(client, {});
    resolved = location.addressId
      ? { ...resolved, addressId: location.addressId }
      : { ...resolved, lat: location.lat, lng: location.lng };
  }
  if (needsItems) {
    const itemIds = cartSlotListingIds((await client.cart()).data);
    if (!itemIds.length) {
      throw new TranquiloError(
        "No service listing found. Add a service to the cart or pass --listing-id <listingId>.",
        { code: "SLOT_ITEM_REQUIRED" }
      );
    }
    resolved = { ...resolved, item: itemIds };
  }
  return resolved;
}

function makeWatchId(): string {
  return `sw_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function createSlotWatchSpec(
  input: CreateSlotWatchInput,
  now: Temporal.Instant = nowInstant()
): SlotWatchSpec {
  const timezone = input.timezone ?? systemTimezone();
  const dateRange = resolveDateRange(input, timezone, now);
  return {
    bookingType: normalizeSupportedBookingType(input.bookingType),
    dateRange: { from: dateRange.from, to: dateRange.to },
    itemIds: input.item ?? [],
    location: resolveLocationSpec(input),
    notifications: {
      desktop: input.desktopNotify !== false,
      slackWebhookUrl: input.slackWebhookUrl,
    },
    preset: dateRange.preset,
    timezone,
    window: resolveWindow(input),
  };
}

/** @internal White-box tested scheduler timing. */
export function nextRunAtForWatch(
  watch: SlotWatch,
  now: Temporal.Instant = nowInstant()
): string | undefined {
  if (watch.status !== "enabled") {
    return;
  }
  const timezone = watch.spec.timezone;
  const today = plainToday(timezone, now);
  const to = Temporal.PlainDate.from(watch.spec.dateRange.to);
  if (Temporal.PlainDate.compare(today, to) > 0) {
    return;
  }

  return now.add({ minutes: 1 }).toString({ smallestUnit: "second" });
}

export async function createSlotWatch(
  input: CreateSlotWatchInput,
  now: Temporal.Instant = nowInstant()
): Promise<SlotWatch> {
  const resolvedInput = await resolveCreateInputLocation(input);
  const spec = createSlotWatchSpec(resolvedInput, now);
  const createdAt = now.toString({ smallestUnit: "second" });
  const watch: SlotWatch = {
    createdAt,
    id: makeWatchId(),
    name: resolvedInput.name,
    runCount: 0,
    spec,
    status: "enabled",
    updatedAt: createdAt,
  };
  watch.nextRunAt = nextRunAtForWatch(watch, now);
  const store = await loadSlotWatchStore();
  store.watches.push(watch);
  await saveSlotWatchStore(store);
  await appendEvent({ id: watch.id, kind: "created" });
  return watch;
}

export async function listSlotWatches(): Promise<SlotWatch[]> {
  return (await loadSlotWatchStore()).watches;
}

function findWatch(store: SlotWatchStore, id: string): SlotWatch {
  const watch = store.watches.find((candidate) => candidate.id === id);
  if (!watch) {
    throw new TranquiloError(`Slot watch ${id} was not found.`, {
      code: "SLOT_WATCH_NOT_FOUND",
    });
  }
  return watch;
}

export async function getSlotWatch(id: string): Promise<SlotWatch> {
  return findWatch(await loadSlotWatchStore(), id);
}

async function updateWatch(
  id: string,
  fn: (watch: SlotWatch, now: Temporal.Instant) => void,
  kind: string
): Promise<SlotWatch> {
  const now = nowInstant();
  const store = await loadSlotWatchStore();
  const watch = findWatch(store, id);
  fn(watch, now);
  watch.updatedAt = now.toString({ smallestUnit: "second" });
  await saveSlotWatchStore(store);
  await appendEvent({ id, kind });
  return watch;
}

export function pauseSlotWatch(id: string): Promise<SlotWatch> {
  return updateWatch(
    id,
    (watch) => {
      watch.status = "paused";
      watch.nextRunAt = undefined;
    },
    "paused"
  );
}

export function resumeSlotWatch(id: string): Promise<SlotWatch> {
  return updateWatch(
    id,
    (watch, now) => {
      watch.status = "enabled";
      watch.foundMatch = undefined;
      watch.lastError = undefined;
      watch.nextRunAt = nextRunAtForWatch(watch, now);
    },
    "resumed"
  );
}

export async function deleteSlotWatch(
  id: string
): Promise<{ deleted: boolean; id: string }> {
  const store = await loadSlotWatchStore();
  const before = store.watches.length;
  store.watches = store.watches.filter((watch) => watch.id !== id);
  if (store.watches.length === before) {
    throw new TranquiloError(`Slot watch ${id} was not found.`, {
      code: "SLOT_WATCH_NOT_FOUND",
    });
  }
  await saveSlotWatchStore(store);
  await appendEvent({ id, kind: "deleted" });
  return { deleted: true, id };
}

function parseSlotDateTime(value: string): Temporal.PlainDateTime | undefined {
  const match = SLOT_TIME_PATTERN.exec(value);
  if (!match) {
    return;
  }
  return Temporal.PlainDateTime.from(
    `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}`
  );
}

/** @internal White-box tested slot matcher. */
export function slotMatchesWatch(
  slot: SlotRow,
  watch: SlotWatch,
  now: Temporal.Instant = nowInstant()
): boolean {
  if (!isActionableSlot(slot)) {
    return false;
  }
  const start = parseSlotDateTime(slot.startTime);
  if (!start) {
    return false;
  }
  const current = now.toZonedDateTimeISO(watch.spec.timezone).toPlainDateTime();
  if (Temporal.PlainDateTime.compare(start, current) < 0) {
    return false;
  }
  const date = start.toPlainDate();
  const from = Temporal.PlainDate.from(watch.spec.dateRange.from);
  const to = Temporal.PlainDate.from(watch.spec.dateRange.to);
  if (
    Temporal.PlainDate.compare(date, from) < 0 ||
    Temporal.PlainDate.compare(date, to) > 0
  ) {
    return false;
  }
  const bounds = windowBounds(watch.spec.window, date);
  const slotTime = start.toPlainTime();
  return (
    Temporal.PlainTime.compare(
      slotTime,
      Temporal.PlainTime.from(bounds.from)
    ) >= 0 &&
    Temporal.PlainTime.compare(slotTime, Temporal.PlainTime.from(bounds.to)) < 0
  );
}

function daysToQuery(watch: SlotWatch, now: Temporal.Instant): number {
  const today = plainToday(watch.spec.timezone, now);
  const to = Temporal.PlainDate.from(watch.spec.dateRange.to);
  return Math.min(Math.max(today.until(to).days + 1, 1), BOOKABLE_DAYS);
}

function apiTime(now: Temporal.Instant): string {
  const date = new Date(now.epochMilliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds()
  )}`;
}

function formatNotificationSlot(startTime: string): string {
  const match = SLOT_TIME_PATTERN.exec(startTime);
  if (!match) {
    return startTime;
  }
  return `${match[1]}-${match[2]}-${match[3]} ${match[4]}:${match[5]}`;
}

function actionCommandForWatch(watch: SlotWatch): string {
  return `tranquilo househelp watch book ${watch.id}`;
}

function actionHintForWatch(watch: SlotWatch): string {
  return `Ask your agent to book watch ${watch.id}, or run ${actionCommandForWatch(
    watch
  )}.`;
}

async function sendDesktopNotification(
  title: string,
  subtitle: string,
  body: string
): Promise<void> {
  try {
    if (process.platform === "darwin") {
      await execa("osascript", [
        "-e",
        `display notification ${JSON.stringify(body)} with title ${JSON.stringify(title)} subtitle ${JSON.stringify(subtitle)}`,
      ]);
      return;
    }
    if (process.platform === "linux") {
      await execa("notify-send", [title, body]);
    }
  } catch {
    // Desktop notifications are best effort.
  }
}

async function sendSlackNotification(
  webhookUrl: string,
  watch: SlotWatch,
  match: SlotWatchMatch
): Promise<void> {
  try {
    const label = watch.name ?? watch.id;
    const slot = formatNotificationSlot(match.startTime);
    const response = await fetch(webhookUrl, {
      body: JSON.stringify({
        blocks: [
          {
            text: {
              text: `*House Help slot found*\n${label}\nSlot: ${slot}\nWatch: \`${watch.id}\``,
              type: "mrkdwn",
            },
            type: "section",
          },
          {
            elements: [
              {
                text: match.actionHint ?? actionHintForWatch(watch),
                type: "mrkdwn",
              },
            ],
            type: "context",
          },
        ],
        text: `Tranquilo slot found: ${label} at ${slot}`,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(`Slack webhook failed with HTTP ${response.status}`);
    }
  } catch {
    // Slack notifications are best effort.
  }
}

async function notifyMatch(
  watch: SlotWatch,
  match: SlotWatchMatch
): Promise<void> {
  const title = "Tranquilo";
  const subtitle = "House Help slot found";
  const label = watch.name ?? watch.id;
  const slot = formatNotificationSlot(match.startTime);
  const body = `${label}: ${slot}. ${match.actionHint ?? actionHintForWatch(watch)}`;
  const notifications = watch.spec.notifications ?? { desktop: true };
  if (notifications.desktop !== false) {
    await sendDesktopNotification(title, subtitle, body);
  }
  const slackWebhookUrl =
    notifications.slackWebhookUrl ?? process.env.TRANQUILO_SLACK_WEBHOOK_URL;
  if (slackWebhookUrl) {
    await sendSlackNotification(slackWebhookUrl, watch, match);
  }
}

async function runWatchOnce(
  watch: SlotWatch,
  now: Temporal.Instant,
  notify: boolean
): Promise<{ error?: string; match?: SlotWatchMatch }> {
  const client = await createClient();
  const location = await resolveLocation(client, watch.spec.location);
  if (!watch.spec.itemIds.length) {
    return { error: "Slot watch has no service item ids." };
  }
  const result = await client.slotsBySkill({
    ...location,
    bookingType: watch.spec.bookingType,
    days: daysToQuery(watch, now),
    listingIds: watch.spec.itemIds,
    time: apiTime(now),
  });
  const match = extractSlots(result.data ?? result).find((slot) =>
    slotMatchesWatch(slot, watch, now)
  );
  if (!match) {
    return {};
  }
  const normalized: SlotWatchMatch = {
    actionCommand: actionCommandForWatch(watch),
    actionHint: actionHintForWatch(watch),
    endTime: match.endTime,
    isExperiencingSurge: match.isExperiencingSurge,
    slotsLeft: match.slotsLeft,
    startTime: match.startTime,
    surgePrice: match.surgePrice,
  };
  if (notify) {
    await notifyMatch(watch, normalized);
  }
  return { match: normalized };
}

async function acquireLock(): Promise<fs.FileHandle | null> {
  await ensureStateDir();
  try {
    return await fs.open(lockPath(), "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return null;
    }
    throw error;
  }
}

async function releaseLock(handle: fs.FileHandle): Promise<void> {
  await handle.close();
  await fs.rm(lockPath(), { force: true });
}

function isDue(watch: SlotWatch, now: Temporal.Instant): boolean {
  return (
    watch.status === "enabled" &&
    (!watch.nextRunAt ||
      Temporal.Instant.compare(Temporal.Instant.from(watch.nextRunAt), now) <=
        0)
  );
}

export async function runDueSlotWatches(
  options: RunOptions = {}
): Promise<RunDueResult> {
  const lock = await acquireLock();
  if (!lock) {
    return { checked: 0, errors: 0, found: [], locked: true, skipped: 0 };
  }

  try {
    const now = options.now ?? nowInstant();
    const store = await loadSlotWatchStore();
    const watches = options.watchId
      ? [findWatch(store, options.watchId)]
      : store.watches;
    const result: RunDueResult = {
      checked: 0,
      errors: 0,
      found: [],
      locked: false,
      skipped: 0,
    };

    for (const watch of watches) {
      if (!(options.force || isDue(watch, now))) {
        result.skipped += 1;
        continue;
      }
      if (watch.status !== "enabled") {
        result.skipped += 1;
        continue;
      }

      const today = plainToday(watch.spec.timezone, now);
      if (
        Temporal.PlainDate.compare(
          today,
          Temporal.PlainDate.from(watch.spec.dateRange.to)
        ) > 0
      ) {
        watch.status = "expired";
        watch.nextRunAt = undefined;
        watch.updatedAt = now.toString({ smallestUnit: "second" });
        await appendEvent({ id: watch.id, kind: "expired" });
        continue;
      }

      result.checked += 1;
      watch.lastRunAt = now.toString({ smallestUnit: "second" });
      watch.runCount += 1;
      try {
        const { match } = await runWatchOnce(
          watch,
          now,
          options.notify !== false
        );
        watch.lastError = undefined;
        if (match) {
          watch.status = "found";
          watch.foundMatch = match;
          watch.nextRunAt = undefined;
          result.found.push({ id: watch.id, match });
          await appendEvent({ id: watch.id, kind: "found", match });
        } else {
          watch.nextRunAt = nextRunAtForWatch(watch, now);
          await appendEvent({ id: watch.id, kind: "checked" });
        }
      } catch (error) {
        result.errors += 1;
        watch.lastError =
          error instanceof Error ? error.message : String(error);
        watch.nextRunAt = now
          .add({ minutes: 30 })
          .toString({ smallestUnit: "second" });
        await appendEvent({
          error: watch.lastError,
          id: watch.id,
          kind: "error",
        });
      }
      watch.updatedAt = now.toString({ smallestUnit: "second" });
    }

    await saveSlotWatchStore(store);
    return result;
  } finally {
    await releaseLock(lock);
  }
}

/** @internal White-box tested OS scheduler file generator. */
export function schedulerFiles(
  command: SchedulerCommand = currentCommand(),
  options: { appendRunDue?: boolean } = {}
): SchedulerFiles {
  const args =
    options.appendRunDue === false
      ? command.args
      : [...command.args, "househelp", "watch", "run-due"];
  const programArgs = [command.command, ...args];
  const plistArgs = programArgs
    .map((arg) => `    <string>${escapeXml(arg)}</string>`)
    .join("\n");
  const serviceExec = programArgs.map(systemdQuote).join(" ");
  const windowsTaskCommand = [command.command, ...args]
    .map(windowsTaskQuote)
    .join(" ");
  return {
    launchdPlist: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
      '<plist version="1.0">',
      "<dict>",
      "  <key>Label</key>",
      "  <string>app.tranquilo.slot-watch</string>",
      "  <key>ProgramArguments</key>",
      "  <array>",
      plistArgs,
      "  </array>",
      "  <key>StartInterval</key>",
      "  <integer>60</integer>",
      "  <key>StandardOutPath</key>",
      `  <string>${escapeXml(path.join(stateDir(), "slot-watch.out.log"))}</string>`,
      "  <key>StandardErrorPath</key>",
      `  <string>${escapeXml(path.join(stateDir(), "slot-watch.err.log"))}</string>`,
      "</dict>",
      "</plist>",
      "",
    ].join("\n"),
    linuxService: [
      "[Unit]",
      "Description=Tranquilo slot watch runner",
      "",
      "[Service]",
      "Type=oneshot",
      `ExecStart=${serviceExec}`,
      "",
    ].join("\n"),
    linuxTimer: [
      "[Unit]",
      "Description=Run Tranquilo slot watches",
      "",
      "[Timer]",
      "OnBootSec=1min",
      "OnUnitActiveSec=1min",
      "AccuracySec=15s",
      "Unit=tranquilo-slot-watch.service",
      "",
      "[Install]",
      "WantedBy=timers.target",
      "",
    ].join("\n"),
    runnerScript: schedulerRunnerScript(command),
    windowsCommand: windowsTaskCommand,
  };
}

function shellQuote(value: string): string {
  if (SHELL_SAFE_PATTERN.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function schedulerRunnerScript(
  command: SchedulerCommand = currentCommand()
): string {
  const args = [...command.args, "househelp", "watch", "run-due"];
  const programArgs = [command.command, ...args].map(shellQuote).join(" ");
  return ["#!/bin/sh", "set -eu", `exec ${programArgs}`, ""].join("\n");
}

function currentCommand(): SchedulerCommand {
  const argv1 = process.argv[1];
  if (argv1) {
    return { args: [argv1], command: process.execPath };
  }
  return { args: [], command: process.execPath };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function systemdQuote(value: string): string {
  return value.includes(" ") ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function windowsTaskQuote(value: string): string {
  return value.includes(" ") ? `"${value.replace(/"/g, '\\"')}"` : value;
}

function launchAgentPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "LaunchAgents",
    "app.tranquilo.slot-watch.plist"
  );
}

function schedulerRunnerPath(): string {
  return path.join(stateDir(), "Tranquilo");
}

function systemdUserDir(): string {
  return path.join(
    process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"),
    "systemd",
    "user"
  );
}

export async function installSlotWatchScheduler(): Promise<
  Record<string, unknown>
> {
  if (process.platform === "darwin") {
    await ensureStateDir();
    const runner = schedulerRunnerPath();
    await fs.writeFile(runner, schedulerRunnerScript(), { mode: 0o755 });
    const files = schedulerFiles(
      { args: [], command: runner },
      { appendRunDue: false }
    );
    const file = launchAgentPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, files.launchdPlist, { mode: 0o644 });
    await execa("launchctl", ["unload", file], { reject: false });
    await execa("launchctl", ["load", file]);
    return { installed: true, platform: "darwin", path: file, runner };
  }
  if (process.platform === "linux") {
    await ensureStateDir();
    const runner = schedulerRunnerPath();
    await fs.writeFile(runner, schedulerRunnerScript(), { mode: 0o755 });
    const files = schedulerFiles(
      { args: [], command: runner },
      { appendRunDue: false }
    );
    const dir = systemdUserDir();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "tranquilo-slot-watch.service"),
      files.linuxService
    );
    await fs.writeFile(
      path.join(dir, "tranquilo-slot-watch.timer"),
      files.linuxTimer
    );
    await execa("systemctl", ["--user", "daemon-reload"]);
    await execa("systemctl", [
      "--user",
      "enable",
      "--now",
      "tranquilo-slot-watch.timer",
    ]);
    return { installed: true, platform: "linux", path: dir, runner };
  }
  if (process.platform === "win32") {
    const files = schedulerFiles();
    await execa("schtasks.exe", [
      "/Create",
      "/TN",
      "Tranquilo Slot Watch",
      "/SC",
      "MINUTE",
      "/MO",
      "1",
      "/TR",
      files.windowsCommand,
      "/F",
    ]);
    return {
      installed: true,
      platform: "win32",
      taskName: "Tranquilo Slot Watch",
    };
  }
  throw new TranquiloError(
    "Automatic scheduler install is only supported on macOS, Linux systemd users, and Windows.",
    { code: "SCHEDULER_UNSUPPORTED" }
  );
}

export async function uninstallSlotWatchScheduler(): Promise<
  Record<string, unknown>
> {
  if (process.platform === "darwin") {
    const file = launchAgentPath();
    await execa("launchctl", ["unload", file], { reject: false });
    await fs.rm(file, { force: true });
    await fs.rm(schedulerRunnerPath(), { force: true });
    return { installed: false, platform: "darwin", path: file };
  }
  if (process.platform === "linux") {
    await execa(
      "systemctl",
      ["--user", "disable", "--now", "tranquilo-slot-watch.timer"],
      {
        reject: false,
      }
    );
    const dir = systemdUserDir();
    await fs.rm(path.join(dir, "tranquilo-slot-watch.service"), {
      force: true,
    });
    await fs.rm(path.join(dir, "tranquilo-slot-watch.timer"), { force: true });
    await fs.rm(schedulerRunnerPath(), { force: true });
    await execa("systemctl", ["--user", "daemon-reload"], { reject: false });
    return { installed: false, platform: "linux", path: dir };
  }
  if (process.platform === "win32") {
    await execa("schtasks.exe", [
      "/Delete",
      "/TN",
      "Tranquilo Slot Watch",
      "/F",
    ]);
    await fs.rm(schedulerRunnerPath(), { force: true });
    return {
      installed: false,
      platform: "win32",
      taskName: "Tranquilo Slot Watch",
    };
  }
  throw new TranquiloError(
    "Automatic scheduler uninstall is not supported here.",
    {
      code: "SCHEDULER_UNSUPPORTED",
    }
  );
}

export async function slotWatchSchedulerStatus(): Promise<
  Record<string, unknown>
> {
  if (process.platform === "darwin") {
    const file = launchAgentPath();
    return { installed: await exists(file), platform: "darwin", path: file };
  }
  if (process.platform === "linux") {
    const dir = systemdUserDir();
    return {
      installed:
        (await exists(path.join(dir, "tranquilo-slot-watch.service"))) &&
        (await exists(path.join(dir, "tranquilo-slot-watch.timer"))),
      platform: "linux",
      path: dir,
    };
  }
  if (process.platform === "win32") {
    return {
      platform: "win32",
      taskName: "Tranquilo Slot Watch",
      statusHint:
        'Run `schtasks.exe /Query /TN "Tranquilo Slot Watch"` for live status.',
    };
  }
  return {
    installed: false,
    platform: process.platform,
    unsupported: true,
  };
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
