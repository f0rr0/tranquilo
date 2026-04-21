import { confirm, input, password, select } from "@inquirer/prompts";
import { createTable, type TableCell } from "@visulima/tabular";
import { ROUNDED_BORDER } from "@visulima/tabular/style";
import { bold, cyan, dim, green, red, yellow } from "yoctocolors";
import {
  activeAddressIdFromCart,
  type NormalizedAddress,
  normalizeAddresses,
} from "./address";
import { installAgent } from "./agent-install";
import { TranquiloClient } from "./api";
import {
  checkoutStatus,
  copyPaymentUri,
  defaultPaymentQrPath,
  openPaymentUri,
  recreateCheckoutPaymentUri,
  resolveCheckoutPaymentUri,
  savePaymentQr,
  type TerminalQrSize,
  terminalQr,
  watchCheckoutStatus,
} from "./checkout";
import { ensureConfig, loadConfig } from "./config";
import {
  createClient,
  formatSlotTime,
  optionalNumber,
  resolveLocation,
} from "./context";
import {
  findHousehelpSlots,
  type HousehelpFindInput,
  type HousehelpPrepareInput,
  type HousehelpSlotMatch,
  househelpPaymentHandoff,
  prepareHousehelpBooking,
  resolveHousehelpOptions,
  slotWatchWindowFromHousehelpInput,
} from "./househelp";
import { rememberedUpiApp, rememberUpiApp } from "./payment-preferences";
import { assertScheduledServiceable } from "./serviceability";
import {
  createSlotWatch,
  deleteSlotWatch,
  getSlotWatch,
  installSlotWatchScheduler,
  listSlotWatches,
  pauseSlotWatch,
  resumeSlotWatch,
  runDueSlotWatches,
  slotWatchSchedulerStatus,
  uninstallSlotWatchScheduler,
  type WatchStatus,
} from "./slot-watch";
import {
  clearCredentials,
  credentialStorageStatus,
  loadCredentials,
  saveCredentials,
} from "./storage";
import type { BookingStatusPreset, Credentials, JsonObject } from "./types";
import { TranquiloError } from "./types";
import {
  allowedUpiAppText,
  parseUpiApp,
  UPI_APPS,
  type UpiApp,
} from "./upi-apps";

const SLOT_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/;
const MANUAL_SLOT_CHOICE = "__manual__";
const SHELL_SAFE_PATTERN = /^[A-Za-z0-9_./:@%+=,-]+$/;

function dataOf(payload: JsonObject): unknown {
  return payload.data ?? payload;
}

function numberValue(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function tokenFromVerify(payload: JsonObject): {
  accessToken: string;
  refreshToken?: string | undefined;
  userId?: string | undefined;
} {
  const topData = payload.data as JsonObject | undefined;
  const verifyData = topData?.data as JsonObject | undefined;
  const token = verifyData?.token;
  if (typeof token !== "string" || !token) {
    throw new TranquiloError("Login verification did not return a token.", {
      code: "LOGIN_VERIFY_FAILED",
      details: payload,
    });
  }
  const userData = verifyData?.userData as JsonObject | undefined;
  return {
    accessToken: token,
    refreshToken:
      typeof verifyData?.refreshToken === "string"
        ? verifyData.refreshToken
        : undefined,
    userId: typeof userData?.id === "string" ? userData.id : undefined,
  };
}

function formatHomeDetails(address: NormalizedAddress): string {
  const details = [
    address.homeDetails.bhk === null
      ? undefined
      : `${address.homeDetails.bhk}BHK`,
    address.homeDetails.bathroom === null
      ? undefined
      : `${address.homeDetails.bathroom} bath`,
    address.homeDetails.balcony === null
      ? undefined
      : `${address.homeDetails.balcony} balcony`,
  ].filter(Boolean);
  return details.join(", ");
}

function outputWidth(): number {
  const width = process.stdout.columns;
  if (typeof width === "number" && Number.isFinite(width) && width > 0) {
    return width;
  }
  const envWidth = Number(process.env.COLUMNS);
  return Number.isFinite(envWidth) && envWidth > 0 ? envWidth : 100;
}

function ensureTrailingNewline(output: string): string {
  return output.endsWith("\n") ? output : `${output}\n`;
}

function shellQuote(value: string): string {
  return SHELL_SAFE_PATTERN.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function localTranquiloCommand(args: string[]): string {
  const entry = process.argv[1];
  const executable =
    entry?.endsWith("/src/index.ts") || entry === "src/index.ts"
      ? [process.argv[0] ?? "tranquilo", entry]
      : ["tranquilo"];
  return [...executable, ...args].map(shellQuote).join(" ");
}

interface ColumnPlan {
  max?: number | undefined;
  min: number;
  weight?: number | undefined;
}

function distributeInteger(total: number, weights: number[]): number[] {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) {
    return weights.map(() => 0);
  }
  const exact = weights.map((weight) => (total * weight) / weightTotal);
  const base = exact.map(Math.floor);
  let remainder = total - base.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);
  for (const item of order) {
    if (remainder <= 0) {
      break;
    }
    base[item.index] = (base[item.index] ?? 0) + 1;
    remainder -= 1;
  }
  return base;
}

function planColumnWidths(width: number, plans: ColumnPlan[]): number[] {
  const columnCount = plans.length;
  const contentBudget = Math.max(
    columnCount * 4,
    width - (3 * columnCount + 1)
  );
  const minTotal = plans.reduce((sum, plan) => sum + plan.min, 0);

  if (contentBudget <= minTotal) {
    const scaled = distributeInteger(
      contentBudget,
      plans.map((plan) => plan.min)
    );
    return scaled.map((value) => Math.max(4, value));
  }

  const widths = plans.map((plan) => plan.min);
  let remaining = contentBudget - minTotal;

  while (remaining > 0) {
    const growable = plans
      .map((plan, index) => ({ index, plan }))
      .filter(
        ({ index, plan }) =>
          plan.max === undefined || (widths[index] ?? 0) < plan.max
      );
    if (!growable.length) {
      break;
    }

    const shares = distributeInteger(
      remaining,
      growable.map(({ plan }) => plan.weight ?? 1)
    );
    let used = 0;
    for (const [shareIndex, { index, plan }] of growable.entries()) {
      const share = Math.max(1, shares[shareIndex] ?? 0);
      const currentWidth = widths[index] ?? 0;
      const capped =
        plan.max === undefined
          ? share
          : Math.min(share, plan.max - currentWidth);
      widths[index] = currentWidth + capped;
      used += capped;
      if (used >= remaining) {
        break;
      }
    }
    if (used <= 0) {
      break;
    }
    remaining -= used;
  }

  return widths;
}

function renderTable(
  headers: TableCell[],
  rows: TableCell[][],
  columnPlans: ColumnPlan[],
  options: { footer?: TableCell[]; width?: number } = {}
): string {
  const width = options.width ?? outputWidth();
  const table = createTable({
    columnWidths: planColumnWidths(width, columnPlans),
    maxWidth: width,
    showFooter: Boolean(options.footer),
    showHeader: true,
    style: {
      border: ROUNDED_BORDER,
      borderColor: dim,
      paddingLeft: 1,
      paddingRight: 1,
    },
    terminalWidth: width,
    wordWrap: true,
  });
  table.setHeaders(headers.map((header) => bold(cyan(String(header)))));
  table.addRows(...rows);
  if (options.footer) {
    table.setFooter(options.footer);
  }
  return ensureTrailingNewline(table.toString());
}

function addressFlags(address: NormalizedAddress): string {
  return (
    [
      address.isActive ? green("active") : undefined,
      address.profileDefault ? cyan("default") : undefined,
    ]
      .filter(Boolean)
      .join(", ") || "-"
  );
}

function addressCityPin(address: NormalizedAddress): string {
  return [address.city, address.pincode].filter(Boolean).join(" ");
}

function renderAddressTable(addresses: NormalizedAddress[]): string {
  if (!addresses.length) {
    return "No saved addresses.\n";
  }

  const width = outputWidth();
  if (width < 72) {
    return renderTable(
      ["Label", "Status", "Details"],
      addresses.map((address) => [
        `${address.label}\n${address.id}`,
        addressFlags(address),
        [address.type, addressCityPin(address), address.summary]
          .filter(Boolean)
          .join("\n"),
      ]),
      [
        { min: 14, max: 20, weight: 2 },
        { min: 8, max: 12, weight: 1 },
        { min: 22, weight: 4 },
      ],
      { width }
    );
  }

  if (width < 112) {
    return renderTable(
      ["Status", "Label", "ID", "Details", "Address"],
      addresses.map((address) => [
        addressFlags(address),
        address.label,
        address.id,
        [address.type, addressCityPin(address), formatHomeDetails(address)]
          .filter(Boolean)
          .join("\n"),
        address.summary,
      ]),
      [
        { min: 8, max: 12, weight: 1 },
        { min: 14, max: 22, weight: 2 },
        { min: 8, max: 10, weight: 1 },
        { min: 18, max: 26, weight: 2 },
        { min: 24, weight: 5 },
      ],
      { width }
    );
  }

  return renderTable(
    ["Status", "Label", "ID", "Type", "City / PIN", "Home", "Address"],
    addresses.map((address) => [
      addressFlags(address),
      address.label,
      address.id,
      address.type,
      addressCityPin(address) || "-",
      formatHomeDetails(address) || "-",
      address.summary,
    ]),
    [
      { min: 8, max: 12, weight: 1 },
      { min: 14, max: 22, weight: 2 },
      { min: 8, max: 10, weight: 1 },
      { min: 6, max: 8, weight: 1 },
      { min: 14, max: 18, weight: 2 },
      { min: 16, max: 22, weight: 2 },
      { min: 28, weight: 6 },
    ],
    { width }
  );
}

function renderAddressDetail(address: NormalizedAddress): string {
  return [
    `Label: ${address.label}`,
    `ID: ${address.id}`,
    `Type: ${address.type}`,
    `Summary: ${address.summary}`,
    `City/Pincode: ${[address.city, address.pincode].filter(Boolean).join(" ")}`,
    `Home: ${formatHomeDetails(address) || "-"}`,
    `Flags: ${
      [
        address.isActive ? "active delivery" : undefined,
        address.profileDefault ? "profile default" : undefined,
        address.canDelete ? "can delete" : undefined,
      ]
        .filter(Boolean)
        .join(", ") || "-"
    }`,
    address.coordinates
      ? `Coordinates: ${address.coordinates.lat}, ${address.coordinates.lng}`
      : "Coordinates: -",
    "",
  ].join("\n");
}

function formatAmount(value: unknown): string {
  const amount = numberValue(value);
  if (amount === undefined) {
    return "-";
  }
  return `INR ${amount.toLocaleString("en-IN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  })}`;
}

async function resolvePaymentUpiApp(options: {
  json?: boolean | undefined;
  noInteractive?: boolean | undefined;
  upiApp?: string | undefined;
}): Promise<UpiApp> {
  if (options.upiApp) {
    const app = parseUpiApp(options.upiApp);
    await rememberUpiApp(app);
    return app;
  }
  const remembered = await rememberedUpiApp();
  if (remembered) {
    return remembered;
  }
  if (
    options.json ||
    options.noInteractive ||
    !(process.stdin.isTTY && process.stdout.isTTY)
  ) {
    throw new TranquiloError(
      `Choose a UPI app before starting payment. Pass --upi-app ${allowedUpiAppText()}.`,
      {
        code: "UPI_APP_REQUIRED",
        details: { allowed: UPI_APPS.map((app) => app.id) },
      }
    );
  }
  const id = await select({
    choices: UPI_APPS.map((app) => ({
      name: app.label,
      value: app.id,
    })),
    message: "UPI app for payment",
  });
  const app = parseUpiApp(id);
  await rememberUpiApp(app);
  return app;
}

function formatSlot(value: string | undefined): string {
  if (!value) {
    return "-";
  }
  const match = SLOT_TIME_PATTERN.exec(value);
  return match ? `${match[2]}/${match[3]} ${match[4]}:${match[5]}` : value;
}

function renderHousehelpOptionsTable(
  options: Awaited<ReturnType<typeof resolveHousehelpOptions>>
): string {
  if (!options.length) {
    return "No House Help options found.\n";
  }
  return renderTable(
    ["Duration", "Payable", "Original", "Savings", "Listing", "Cart item"],
    options.map((option) => [
      `${option.durationMinutes} min`,
      formatAmount(option.effectivePrice),
      formatAmount(option.price),
      option.formattedSaving ?? formatAmount(option.saving),
      option.listingId,
      option.listingItemId,
    ]),
    [
      { min: 10, max: 12, weight: 1 },
      { min: 12, max: 14, weight: 1 },
      { min: 12, max: 14, weight: 1 },
      { min: 12, max: 16, weight: 1 },
      { min: 10, max: 12, weight: 1 },
      { min: 10, max: 12, weight: 1 },
    ],
    { width: outputWidth() }
  );
}

function renderHousehelpSlotsTable(
  slots: Awaited<ReturnType<typeof findHousehelpSlots>>["slots"]
): string {
  if (!slots.length) {
    return "No actionable House Help slots returned.\n";
  }
  return renderTable(
    ["Rank", "Start", "Duration", "Payable", "Savings", "Reason"],
    slots.map((slot) => [
      String(slot.rank),
      formatSlot(slot.startTime),
      `${slot.durationMinutes} min`,
      formatAmount(slot.price),
      slot.formattedSaving ?? formatAmount(slot.savings),
      slot.rankReason,
    ]),
    [
      { min: 5, max: 6, weight: 1 },
      { min: 14, max: 18, weight: 2 },
      { min: 10, max: 12, weight: 1 },
      { min: 12, max: 14, weight: 1 },
      { min: 12, max: 16, weight: 1 },
      { min: 18, weight: 3 },
    ],
    { width: outputWidth() }
  );
}

function locationArgsForCommand(
  location: Awaited<ReturnType<typeof findHousehelpSlots>>["location"]
): string[] {
  if (location.addressId) {
    return ["--address-id", location.addressId];
  }
  return ["--lat", String(location.lat), "--lng", String(location.lng)];
}

function locationSummary(
  location: Awaited<ReturnType<typeof findHousehelpSlots>>["location"]
): string {
  const label = location.label ? `${location.label} ` : "";
  const address = location.addressId ? `address ${location.addressId}` : "";
  const coordinates = `${location.lat}, ${location.lng}`;
  return `${label}${address || coordinates} (${location.source})`;
}

function renderHousehelpOptionsResult(
  options: Awaited<ReturnType<typeof resolveHousehelpOptions>>,
  location: Awaited<ReturnType<typeof findHousehelpSlots>>["location"]
): string {
  const table = renderHousehelpOptionsTable(options).trimEnd();
  const first = options[0];
  if (!first) {
    return `${table}\n`;
  }
  const command = localTranquiloCommand([
    "househelp",
    "find",
    "--duration",
    String(first.durationMinutes),
    "--preset",
    "next-4-days",
    "--window",
    "smart",
    ...locationArgsForCommand(location),
  ]);
  return `${table}\n\n${bold("Find slots")} ${dim(command)}\n`;
}

function windowsSummary(
  windows: Awaited<ReturnType<typeof findHousehelpSlots>>["windows"]
): string {
  return windows
    .map((window) => `${window.label} ${window.from}-${window.to}`)
    .join(", ");
}

function exactBookCommand(
  result: Awaited<ReturnType<typeof findHousehelpSlots>>,
  slot: HousehelpSlotMatch
): string {
  return localTranquiloCommand([
    "househelp",
    "book",
    "--duration",
    String(slot.durationMinutes),
    "--slot",
    slot.startTime,
    ...locationArgsForCommand(result.location),
  ]);
}

function rankedBookCommand(
  result: Awaited<ReturnType<typeof findHousehelpSlots>>,
  rank: number
): string {
  const selected = result.slots[rank - 1];
  const duration = selected?.durationMinutes ?? result.durationOrder[0];
  const args = [
    "househelp",
    "book",
    "--duration",
    String(duration),
    "--rank",
    String(rank),
    "--from-date",
    result.dateRange.from,
    "--to-date",
    result.dateRange.to,
    ...locationArgsForCommand(result.location),
  ];
  for (const window of result.windows) {
    args.push("--time-window", `${window.from}-${window.to}`);
  }
  return localTranquiloCommand(args);
}

function renderHousehelpFindResult(
  result: Awaited<ReturnType<typeof findHousehelpSlots>>
): string {
  const table = renderHousehelpSlotsTable(result.slots).trimEnd();
  const best = result.slots[0];
  const lines = [
    table,
    "",
    `${bold("Location")} ${locationSummary(result.location)}`,
    `${bold("Dates")} ${result.dateRange.from} to ${result.dateRange.to}`,
    `${bold("Windows")} ${windowsSummary(result.windows)}`,
  ];
  if (best) {
    lines.push(
      `${bold("Book best")} ${dim(exactBookCommand(result, best))}`,
      `${bold("Re-rank live")} ${dim(rankedBookCommand(result, 1))}`
    );
  } else {
    lines.push(
      `${yellow("No actionable slots.")} Try --window any or --preset next-4-days. Tranquilo only allows booking today through the next 3 days.`
    );
  }
  return `${lines.join("\n")}\n`;
}

function watchStatus(status: WatchStatus): string {
  if (status === "enabled") {
    return green(status);
  }
  if (status === "found") {
    return cyan(status);
  }
  if (status === "expired") {
    return red(status);
  }
  return yellow(status);
}

function renderWatchTable(
  watches: Awaited<ReturnType<typeof listSlotWatches>>
): string {
  if (!watches.length) {
    return "No slot watches.\n";
  }
  const width = outputWidth();
  return renderTable(
    ["Status", "Name", "ID", "Target", "Next run", "Last result"],
    watches.map((watch) => [
      watchStatus(watch.status),
      watch.name ?? "-",
      watch.id,
      [
        watch.spec.location.addressId
          ? `Address ${watch.spec.location.addressId}`
          : `${watch.spec.location.lat}, ${watch.spec.location.lng}`,
        watch.spec.itemIds.length
          ? `Listings ${watch.spec.itemIds.join(", ")}`
          : "No service listing",
        `${watch.spec.dateRange.from} to ${watch.spec.dateRange.to}`,
        watch.spec.window.preset,
      ].join("\n"),
      watch.nextRunAt ?? "-",
      watch.foundMatch?.startTime ?? watch.lastError ?? "-",
    ]),
    [
      { min: 8, max: 10, weight: 1 },
      { min: 12, max: 20, weight: 2 },
      { min: 14, max: 18, weight: 2 },
      { min: 24, weight: 5 },
      { min: 18, max: 24, weight: 3 },
      { min: 18, weight: 3 },
    ],
    { width }
  );
}

async function loadAddressContext(
  client: TranquiloClient,
  options: {
    active?: boolean | undefined;
    lat?: number | undefined;
    lng?: number | undefined;
    nearest?: boolean | undefined;
  } = {}
): Promise<{
  activeAddressId?: string | undefined;
  addresses: NormalizedAddress[];
}> {
  const raw = await client.addresses({
    lat: options.lat,
    lng: options.lng,
    nearestAddressRequired: Boolean(options.nearest),
  });
  const activeAddressId =
    options.active === false
      ? undefined
      : activeAddressIdFromCart(await client.cart());
  return {
    activeAddressId,
    addresses: normalizeAddresses(raw, activeAddressId),
  };
}

function findAddressOrThrow(
  addresses: NormalizedAddress[],
  addressId: string
): NormalizedAddress {
  const address = addresses.find((candidate) => candidate.id === addressId);
  if (!address) {
    throw new TranquiloError(`Address ${addressId} was not found.`, {
      code: "ADDRESS_NOT_FOUND",
    });
  }
  return address;
}

export async function loginAction(options: {
  noInteractive?: boolean | undefined;
  otp?: string | undefined;
  phone?: string | undefined;
}): Promise<string> {
  if (options.noInteractive && !(options.phone && options.otp)) {
    throw new TranquiloError(
      "Pass both --phone and --otp when using --no-interactive.",
      {
        code: "LOGIN_INPUT_REQUIRED",
        details: {
          missing: [
            options.phone ? undefined : "phone",
            options.otp ? undefined : "otp",
          ].filter(Boolean),
        },
      }
    );
  }
  const cfg = await ensureConfig();
  const mobileNumber =
    options.phone ?? (await input({ message: "Mobile number" }));
  const client = new TranquiloClient(cfg, null);
  const start = await client.loginStart(mobileNumber);
  const startData = start.data as JsonObject | undefined;
  const token = startData?.token;
  if (typeof token !== "string" || !token) {
    throw new TranquiloError("Login start did not return an OTP token.", {
      code: "LOGIN_START_FAILED",
      details: start,
    });
  }
  const idtoken = options.otp ?? (await password({ message: "OTP" }));
  const verified = await client.verifyLogin({
    token,
    idtoken,
    mobileNumber,
  });
  const tokens = tokenFromVerify(verified);
  const credentials: Credentials = {
    ...tokens,
    mobileNumber,
    savedAt: new Date().toISOString(),
  };
  const storage = await saveCredentials(credentials);
  return json({ ok: true, storage, userId: credentials.userId });
}

export async function logoutAction(): Promise<string> {
  await clearCredentials();
  return json({ ok: true });
}

export async function statusAction(): Promise<string> {
  const [cfg, credentials, storage] = await Promise.all([
    loadConfig(),
    loadCredentials(),
    credentialStorageStatus(),
  ]);
  return json({
    authenticated: Boolean(credentials?.accessToken),
    userId: credentials?.userId,
    mobileNumber: credentials?.mobileNumber,
    savedAt: credentials?.savedAt,
    config: cfg,
    storage,
  });
}

export async function whoamiAction(): Promise<string> {
  const client = await createClient();
  return json(dataOf(await client.user()));
}

export async function addressesListAction(options: {
  active?: boolean | undefined;
  json?: boolean | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
  nearest?: boolean | undefined;
}): Promise<string> {
  const client = await createClient();
  const result = await loadAddressContext(client, options);
  if (options.json) {
    return json({
      activeAddressId: result.activeAddressId,
      addresses: result.addresses,
    });
  }
  return renderAddressTable(result.addresses);
}

export async function addressShowAction(
  addressId: string,
  options: { active?: boolean | undefined; json?: boolean | undefined }
): Promise<string> {
  const client = await createClient();
  const { addresses } = await loadAddressContext(client, options);
  const address = findAddressOrThrow(addresses, addressId);
  return options.json ? json(address) : renderAddressDetail(address);
}

export async function addressUseAction(
  addressId: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const client = await createClient();
  const context = await loadAddressContext(client, { active: false });
  const address = findAddressOrThrow(context.addresses, addressId);
  const updated = await client.setDeliveryAddress(addressId);
  const activeAddressId = activeAddressIdFromCart(updated) ?? addressId;
  const selected = { ...address, isActive: true };
  if (options.json) {
    return json({
      activeAddressId,
      address: selected,
      result: dataOf(updated),
    });
  }
  return `Active delivery address set to ${selected.label} (${selected.id}).\n`;
}

export async function househelpOptionsAction(options: {
  addressId?: string | undefined;
  json?: boolean | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
}): Promise<string> {
  const client = await createClient();
  const location = await resolveLocation(client, {
    addressId: options.addressId,
    lat: optionalNumber(options.lat),
    lng: optionalNumber(options.lng),
  });
  const serviceability = await assertScheduledServiceable(client, location);
  const househelpOptions = await resolveHousehelpOptions(client, location);
  const payload = {
    location,
    options: househelpOptions,
    serviceableBookingTypes: serviceability.serviceableBookingTypes,
  };
  return options.json
    ? json(payload)
    : renderHousehelpOptionsResult(househelpOptions, location);
}

export async function househelpFindAction(
  options: HousehelpFindInput & {
    json?: boolean | undefined;
    limit?: number | undefined;
    noInteractive?: boolean | undefined;
  }
): Promise<string> {
  const result = await findHousehelpSlots(options);
  const limit = options.limit;
  const limited =
    limit && Number.isInteger(limit) && limit > 0
      ? { ...result, slots: result.slots.slice(0, limit) }
      : result;
  return options.json ? json(limited) : renderHousehelpFindResult(limited);
}

async function confirmHousehelpBooking(
  optionsInput: Pick<HousehelpPrepareInput, "duration" | "slot">,
  options: {
    json?: boolean | undefined;
    noInteractive?: boolean | undefined;
    payAfterCheckout?: boolean | undefined;
    yes?: boolean | undefined;
  }
): Promise<void> {
  if (options.yes || options.json || options.noInteractive) {
    return;
  }
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new TranquiloError("Pass --yes or --json for non-interactive use.", {
      code: "CONFIRMATION_REQUIRED",
    });
  }
  const action = options.payAfterCheckout
    ? "Create House Help checkout and show payment QR"
    : "Create House Help checkout";
  const ok = await confirm({
    message: `${action} for ${optionsInput.duration ?? "selected duration"} at ${formatSlot(optionsInput.slot)}?`,
    default: false,
  });
  if (!ok) {
    throw new TranquiloError("House Help booking was not confirmed.", {
      code: "BOOKING_NOT_CONFIRMED",
    });
  }
}

async function resolveHousehelpSlotInput(
  options: {
    rank?: number | undefined;
    json?: boolean | undefined;
    noInteractive?: boolean | undefined;
    slot?: string | undefined;
  } & HousehelpFindInput
): Promise<{ duration?: number; slot: string }> {
  if (options.slot) {
    return { slot: formatSlotTime(options.slot) };
  }
  if (options.rank !== undefined) {
    if (
      !Number.isInteger(options.rank) ||
      options.rank < 1 ||
      !Number.isFinite(options.rank)
    ) {
      throw new TranquiloError("Pass --rank as a positive integer.", {
        code: "INVALID_RANK",
      });
    }
    const result = await findHousehelpSlots(options);
    const selected = result.slots[options.rank - 1];
    if (!selected) {
      throw new TranquiloError(
        `No actionable House Help slot found at rank ${options.rank}.`,
        {
          code: "SLOT_RANK_NOT_FOUND",
          details: { availableSlots: result.slots.length },
        }
      );
    }
    return {
      duration: selected.durationMinutes,
      slot: formatSlotTime(selected.startTime),
    };
  }
  if (options.json || options.noInteractive) {
    throw new TranquiloError(
      'Pass --slot with a human time like "today 6pm" or an ISO time like 2026-04-23T18:00:00.',
      { code: "SLOT_REQUIRED" }
    );
  }
  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new TranquiloError("Pass --slot for non-interactive use.", {
      code: "SLOT_REQUIRED",
    });
  }
  const result = await findHousehelpSlots(options);
  if (result.slots.length) {
    const selected = await select({
      choices: [
        ...result.slots.slice(0, 10).map((slot) => ({
          name: `#${slot.rank} ${formatSlot(slot.startTime)} | ${slot.durationMinutes} min | ${formatAmount(slot.price)} | ${slot.rankReason}`,
          value: String(slot.rank),
        })),
        {
          name: "Enter another time",
          value: MANUAL_SLOT_CHOICE,
        },
      ],
      message: "Slot",
    });
    if (selected !== MANUAL_SLOT_CHOICE) {
      const chosen = result.slots[Number(selected) - 1];
      if (!chosen) {
        throw new TranquiloError("Selected slot was not found.", {
          code: "SLOT_RANK_NOT_FOUND",
        });
      }
      return {
        duration: chosen.durationMinutes,
        slot: formatSlotTime(chosen.startTime),
      };
    }
  }
  const manualSlot = await input({
    message:
      'Slot time (examples: "today 6pm", "tomorrow 8:30am", "2026-04-23 18:00")',
  });
  return { slot: formatSlotTime(manualSlot) };
}

export async function househelpBookAction(
  options: Omit<HousehelpPrepareInput, "slot"> & {
    copyLink?: boolean | undefined;
    handoff?: boolean | undefined;
    intervalMs?: number | undefined;
    json?: boolean | undefined;
    noInteractive?: boolean | undefined;
    pay?: boolean | undefined;
    rank?: number | undefined;
    qrSize?: TerminalQrSize | undefined;
    saveQr?: string | undefined;
    slot?: string | undefined;
    timeoutMs?: number | undefined;
    upiApp?: string | undefined;
  }
): Promise<string> {
  const resolved = await resolveHousehelpSlotInput(options);
  const shouldPay =
    options.pay === true ||
    !(
      options.handoff === true || Boolean(options.json || options.noInteractive)
    );
  await confirmHousehelpBooking(
    { duration: resolved.duration ?? options.duration, slot: resolved.slot },
    { ...options, payAfterCheckout: shouldPay }
  );
  const result = await prepareHousehelpBooking({
    ...options,
    duration: resolved.duration ?? options.duration,
    slot: resolved.slot,
  });
  if (shouldPay) {
    if (options.json) {
      return json({
        booking: result,
        payment: JSON.parse(
          await checkoutPayAction(result.order.orderId, {
            copyLink: options.copyLink,
            intervalMs: options.intervalMs,
            json: true,
            noInteractive: options.noInteractive,
            qrSize: options.qrSize,
            saveQr: options.saveQr,
            timeoutMs: options.timeoutMs,
            upiApp: options.upiApp,
          })
        ),
      });
    }
    process.stdout.write(
      `Checkout ${result.order.orderId} prepared for ${result.durationMinutes} min House Help.\nStarting QR payment. Keep this terminal open until payment finishes.\n`
    );
    return checkoutPayAction(result.order.orderId, {
      copyLink: options.copyLink,
      intervalMs: options.intervalMs,
      noInteractive: options.noInteractive,
      qrSize: options.qrSize,
      saveQr: options.saveQr,
      timeoutMs: options.timeoutMs,
      upiApp: options.upiApp,
    });
  }
  if (options.json) {
    return json(result);
  }
  return [
    `Checkout ${result.order.orderId} prepared for ${result.durationMinutes} min House Help.`,
    result.userInstruction,
    "",
  ].join("\n");
}

export async function househelpPaymentHandoffAction(
  orderId: string,
  options: { json?: boolean | undefined } = {}
): Promise<string> {
  const result = await househelpPaymentHandoff(orderId);
  if (options.json) {
    return json(result);
  }
  return `${result.userInstruction}\n`;
}

export async function househelpWatchCreateAction(
  options: HousehelpFindInput & {
    desktopNotify?: boolean | undefined;
    json?: boolean | undefined;
    name?: string | undefined;
    slackWebhookUrl?: string | undefined;
  }
): Promise<string> {
  const resolved = await findHousehelpSlots(options);
  const watch = await createSlotWatch({
    addressId: resolved.location.addressId,
    date: options.date,
    ...slotWatchWindowFromHousehelpInput(options),
    fromDate: options.fromDate,
    item: resolved.queryListingIds,
    lat: resolved.location.addressId ? undefined : resolved.location.lat,
    lng: resolved.location.addressId ? undefined : resolved.location.lng,
    name: options.name,
    desktopNotify: options.desktopNotify,
    preset: options.preset,
    slackWebhookUrl: options.slackWebhookUrl,
    toDate: options.toDate,
  });
  if (options.json) {
    return json({ watch });
  }
  return `Created House Help watch ${watch.id}${watch.name ? ` (${watch.name})` : ""}.\n`;
}

export async function househelpWatchBookAction(
  id: string,
  options: {
    copyLink?: boolean | undefined;
    intervalMs?: number | undefined;
    json?: boolean | undefined;
    noInteractive?: boolean | undefined;
    pay?: boolean | undefined;
    qrSize?: TerminalQrSize | undefined;
    saveQr?: string | undefined;
    timeoutMs?: number | undefined;
    upiApp?: string | undefined;
  } = {}
): Promise<string> {
  const watch = await getSlotWatch(id);
  const found = watch.foundMatch;
  if (!found) {
    throw new TranquiloError(
      "This watch has not found a slot yet. Run `tranquilo househelp watch show <id>` to inspect it.",
      { code: "WATCH_MATCH_NOT_FOUND", details: { id } }
    );
  }
  const addressId = watch.spec.location.addressId;
  if (!addressId) {
    throw new TranquiloError(
      "Booking a found watch requires a saved address. Recreate the watch with --address-id or use a saved active delivery address.",
      { code: "WATCH_BOOK_ADDRESS_REQUIRED", details: { id } }
    );
  }
  const listingPreference = new Map(
    watch.spec.itemIds.map((itemId, index) => [itemId, index])
  );
  const live = await findHousehelpSlots({
    addressId,
    date: found.startTime.slice(0, 10),
    exactSlot: found.startTime,
    window: "any",
  });
  const selected = live.slots
    .filter((slot) => listingPreference.has(slot.listingId))
    .sort(
      (a, b) =>
        (listingPreference.get(a.listingId) ?? Number.MAX_SAFE_INTEGER) -
        (listingPreference.get(b.listingId) ?? Number.MAX_SAFE_INTEGER)
    )[0];
  if (!selected) {
    throw new TranquiloError(
      "The found slot is no longer available for the watched House Help service.",
      {
        code: "WATCH_FOUND_SLOT_STALE",
        details: { id, slot: found.startTime },
      }
    );
  }
  const result = await prepareHousehelpBooking({
    addressId,
    duration: selected.durationMinutes,
    slot: selected.startTime,
    yes: true,
  });
  if (options.pay !== false && !options.json) {
    process.stdout.write(
      `Checkout ${result.order.orderId} prepared for ${result.durationMinutes} min House Help from watch ${id}.\nStarting QR payment. Keep this terminal open until payment finishes.\n`
    );
    return checkoutPayAction(result.order.orderId, {
      copyLink: options.copyLink,
      intervalMs: options.intervalMs,
      noInteractive: options.noInteractive,
      qrSize: options.qrSize,
      saveQr: options.saveQr,
      timeoutMs: options.timeoutMs,
      upiApp: options.upiApp,
    });
  }
  if (options.json) {
    return json(result);
  }
  return [
    `Checkout ${result.order.orderId} prepared for ${result.durationMinutes} min House Help from watch ${id}.`,
    result.userInstruction,
    "",
  ].join("\n");
}

async function preparePaymentOutput(
  payment: Awaited<ReturnType<typeof resolveCheckoutPaymentUri>>,
  options: {
    copyLink?: boolean | undefined;
    json?: boolean | undefined;
    openIntent?: boolean | undefined;
    saveQr?: string | undefined;
  }
): Promise<string | undefined> {
  if (options.copyLink) {
    await copyPaymentUri(payment.paymentUri);
  }
  const savedQrPath = options.json
    ? options.saveQr
    : (options.saveQr ?? defaultPaymentQrPath(payment.order.orderId));
  if (savedQrPath) {
    await savePaymentQr(payment.paymentUri, savedQrPath);
  }
  if (options.openIntent) {
    await openPaymentUri(payment.paymentUri);
  }
  return savedQrPath;
}

export async function checkoutPayAction(
  orderId: string,
  options: {
    copyLink?: boolean | undefined;
    intervalMs?: number | undefined;
    json?: boolean | undefined;
    noInteractive?: boolean | undefined;
    openIntent?: boolean | undefined;
    qrSize?: TerminalQrSize | undefined;
    saveQr?: string | undefined;
    timeoutMs?: number | undefined;
    upiApp?: string | undefined;
    watch?: boolean | undefined;
  } = {}
): Promise<string> {
  let upiApp = options.upiApp
    ? await resolvePaymentUpiApp(options)
    : await rememberedUpiApp();
  const payment = await resolveCheckoutPaymentUri(orderId, {
    upiApp: upiApp?.id,
  }).catch(async (error: unknown) => {
    if (error instanceof TranquiloError && error.code === "UPI_APP_REQUIRED") {
      upiApp = await resolvePaymentUpiApp(options);
      return resolveCheckoutPaymentUri(orderId, { upiApp: upiApp.id });
    }
    if (
      error instanceof TranquiloError &&
      error.code === "PAYMENT_RETRY_NOT_ALLOWED"
    ) {
      upiApp ??= await resolvePaymentUpiApp(options);
      return recreateCheckoutPaymentUri(orderId, { upiApp: upiApp.id });
    }
    throw error;
  });
  const savedQrPath = await preparePaymentOutput(payment, options);

  if (!options.json) {
    const qr = await terminalQr(payment.paymentUri, options.qrSize);
    const instructions = [
      payment.replacedOrderId
        ? `Previous order ${payment.replacedOrderId} could not be reopened; created fresh order ${payment.order.orderId}.`
        : undefined,
      `Order: ${payment.order.orderId}`,
      `Amount: ${formatAmount(payment.order.amount)}`,
      `Slot: ${payment.order.slot}`,
      `Payment: ${payment.source}`,
      `UPI app: ${payment.upiApp?.label ?? upiApp?.label ?? "-"}`,
      `QR image: ${savedQrPath}`,
      "",
      qr.trimEnd(),
      "",
      options.copyLink ? "UPI link copied to clipboard." : undefined,
      savedQrPath ? `QR saved to ${savedQrPath}.` : undefined,
      options.openIntent ? "Opened UPI intent with the OS." : undefined,
    ]
      .filter((line) => line !== undefined)
      .join("\n");

    if (options.watch === false) {
      return `${instructions}\nStatus: not watched\n`;
    }

    process.stdout.write(
      `${instructions}\nWaiting for payment confirmation. Scan the QR above from your phone.\n`
    );
    const status = await watchCheckoutStatus(payment.order.orderId, {
      intervalMs: options.intervalMs,
      timeoutMs: options.timeoutMs,
    });
    return [
      `Status: ${status.order.juspayStatus ?? status.order.status}`,
      status.order.bookingId ? `Booking: ${status.order.bookingId}` : undefined,
      "",
    ]
      .filter((line) => line !== undefined)
      .join("\n");
  }

  const status =
    options.watch === false
      ? undefined
      : await watchCheckoutStatus(payment.order.orderId, {
          intervalMs: options.intervalMs,
          timeoutMs: options.timeoutMs,
        });
  if (options.json) {
    return json({
      copied: Boolean(options.copyLink),
      order: status?.order ?? payment.order,
      paymentUri: payment.paymentUri,
      replacedOrderId: payment.replacedOrderId,
      savedQr: savedQrPath,
      source: payment.source,
      status,
      upiApp: payment.upiApp ?? upiApp,
    });
  }
  throw new TranquiloError("Payment output mode was not handled.", {
    code: "PAYMENT_OUTPUT_UNHANDLED",
  });
}

export async function checkoutStatusAction(
  orderId: string,
  options: {
    intervalMs?: number | undefined;
    json?: boolean | undefined;
    timeoutMs?: number | undefined;
    watch?: boolean | undefined;
  } = {}
): Promise<string> {
  const result = options.watch
    ? await watchCheckoutStatus(orderId, {
        intervalMs: options.intervalMs,
        timeoutMs: options.timeoutMs,
      })
    : await checkoutStatus(orderId);
  if (options.json) {
    return json(result);
  }
  return [
    `Order: ${result.order.orderId}`,
    `Status: ${result.order.juspayStatus ?? result.order.status}`,
    result.order.prontoStatus
      ? `Pronto: ${result.order.prontoStatus}`
      : undefined,
    result.order.bookingId ? `Booking: ${result.order.bookingId}` : undefined,
    "",
  ]
    .filter((line) => line !== undefined)
    .join("\n");
}

export async function bookingsListAction(options: {
  page: number;
  status: BookingStatusPreset;
}): Promise<string> {
  if (!["upcoming", "past", "all"].includes(options.status)) {
    throw new TranquiloError("--status must be upcoming, past, or all", {
      code: "INVALID_STATUS_PRESET",
    });
  }
  const page = Number(options.page);
  if (!Number.isInteger(page) || page < 1) {
    throw new TranquiloError("--page must be a positive integer");
  }
  const client = await createClient();
  return json(dataOf(await client.bookings(options.status, page)));
}

export async function slotWatchListAction(options: {
  json?: boolean | undefined;
}): Promise<string> {
  const watches = await listSlotWatches();
  return options.json ? json({ watches }) : renderWatchTable(watches);
}

export async function slotWatchShowAction(
  id: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const watch = await getSlotWatch(id);
  return options.json ? json({ watch }) : renderWatchTable([watch]);
}

export async function slotWatchPauseAction(
  id: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const watch = await pauseSlotWatch(id);
  return options.json ? json({ watch }) : `Paused slot watch ${watch.id}.\n`;
}

export async function slotWatchResumeAction(
  id: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const watch = await resumeSlotWatch(id);
  return options.json ? json({ watch }) : `Resumed slot watch ${watch.id}.\n`;
}

export async function slotWatchDeleteAction(
  id: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const result = await deleteSlotWatch(id);
  return options.json ? json(result) : `Deleted slot watch ${result.id}.\n`;
}

export async function slotWatchRunNowAction(
  id: string,
  options: { json?: boolean | undefined }
): Promise<string> {
  const result = await runDueSlotWatches({ force: true, watchId: id });
  return options.json ? json(result) : json(result);
}

export async function slotWatchRunDueAction(options: {
  json?: boolean | undefined;
}): Promise<string> {
  const result = await runDueSlotWatches();
  return options.json ? json(result) : "";
}

export async function slotWatchSchedulerAction(
  action: "install" | "status" | "uninstall"
): Promise<string> {
  if (action === "install") {
    return json(await installSlotWatchScheduler());
  }
  if (action === "uninstall") {
    return json(await uninstallSlotWatchScheduler());
  }
  return json(await slotWatchSchedulerStatus());
}

export async function doctorAction(
  options: { secrets?: boolean | undefined } = {}
): Promise<string> {
  const cfg = await ensureConfig();
  const secrets = options.secrets
    ? await Promise.all([loadCredentials(), credentialStorageStatus()])
    : undefined;
  const credentials = secrets?.[0];
  const storage = secrets?.[1];
  return json({
    ok: true,
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    config: cfg,
    secretsChecked: options.secrets === true,
    ...(options.secrets
      ? {
          authenticated: Boolean(credentials?.accessToken),
          storage,
        }
      : {}),
  });
}

export async function installAgentAction(target: string): Promise<string> {
  if (
    !["all", "auto", "claude-code", "claude-desktop", "codex"].includes(target)
  ) {
    throw new TranquiloError(
      "Install target must be auto, codex, claude-code, claude-desktop, or all.",
      {
        code: "INVALID_INSTALL_TARGET",
        details: { target },
      }
    );
  }
  return json(await installAgent(target));
}
