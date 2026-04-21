import fs from "node:fs/promises";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import clipboard from "clipboardy";
import open from "open";
import QRCode from "qrcode";
import { parseCartItems } from "./api";
import { createClient, formatSlotTime, resolveLocation } from "./context";
import { stateDir } from "./paths";
import { rememberedUpiApp } from "./payment-preferences";
import { assertScheduledServiceable } from "./serviceability";
import { nowPlainDateTime, systemTimezone, todayPlainDate } from "./time";
import type { JsonObject } from "./types";
import { TranquiloError } from "./types";
import { parseUpiApp, type UpiApp } from "./upi-apps";

const STORE_FILE = "checkout-orders.json";
const STORE_VERSION = 1;
const BOOKABLE_DAYS = 4;
const DEFAULT_PAYMENT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_PAYMENT_INTERVAL_MS = 5000;
const SHELL_SAFE_PATTERN = /^[A-Za-z0-9_./:=@-]+$/;
const PAYMENT_PAGE_QUERY =
  "cardIssuerBankName=UPI_PAY&cardType=UPI&paymentMethod=UPI_PAY&paymentMethodType=UPI";
const PAYMENT_CONFIRMATION_PATH_RE =
  /^\/v2\/pay\/confirmation\/([^/]+)\/([^/?#]+)/;

type PaymentUriSource = "PAYMENT_PAGE" | "UPI_PAY" | "UPI_QR";
type UpiPaymentMethod = "UPI_PAY" | "UPI_QR";

type CheckoutOrderStatus =
  | "charged"
  | "confirmed"
  | "created"
  | "failed"
  | "payment_pending";

interface CheckoutOrder {
  addressId?: string | undefined;
  amount: number;
  bookingId?: string | undefined;
  bookingType: string;
  cartVersion: number;
  clientAuthToken: string;
  createdAt: string;
  customerId?: string | undefined;
  juspayStatus?: string | undefined;
  merchantId: string;
  orderId: string;
  paymentUri?: string | undefined;
  paymentUriSource?: PaymentUriSource | undefined;
  prontoStatus?: string | undefined;
  selectedDurationMinutes?: number | undefined;
  selectedListingId?: string | undefined;
  selectedListingItemId?: string | undefined;
  slot: string;
  status: CheckoutOrderStatus;
  updatedAt: string;
}

interface PublicCheckoutOrder {
  addressId?: string | undefined;
  amount: number;
  bookingId?: string | undefined;
  bookingType: string;
  cartVersion: number;
  createdAt: string;
  hasPaymentUri: boolean;
  juspayStatus?: string | undefined;
  merchantId: string;
  orderId: string;
  payCommand: string;
  paymentUriSource?: PaymentUriSource | undefined;
  prontoStatus?: string | undefined;
  selectedDurationMinutes?: number | undefined;
  selectedListingId?: string | undefined;
  selectedListingItemId?: string | undefined;
  slot: string;
  status: CheckoutOrderStatus;
  updatedAt: string;
}

interface CheckoutStore {
  orders: CheckoutOrder[];
  version: 1;
}

interface CheckoutStartInput {
  addressId?: string | undefined;
  bookingType?: string | undefined;
  expectedDurationMinutes?: number | undefined;
  expectedListingId?: string | undefined;
  expectedListingItemId?: string | undefined;
  item?: string[] | undefined;
  slot: string;
}

interface PaymentUriResult {
  order: PublicCheckoutOrder;
  paymentUri: string;
  replacedOrderId?: string | undefined;
  source: PaymentUriSource;
  upiApp?: UpiApp | undefined;
}

interface PaymentTarget {
  paymentUri: string;
  source: PaymentUriSource;
  upiApp?: UpiApp | undefined;
}

interface CheckoutStatusResult {
  booking?: unknown | undefined;
  order: PublicCheckoutOrder;
  payment?: unknown | undefined;
  processOrder?: unknown | undefined;
}

export type TerminalQrSize = "compact" | "normal" | "small";

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

function dataOf(payload: JsonObject): JsonObject {
  return asObject(payload.data) ?? payload;
}

function withOptionalUpiApp<T extends object>(
  value: T,
  upiApp?: UpiApp
): T & { upiApp?: UpiApp | undefined } {
  return upiApp ? { ...value, upiApp } : value;
}

function checkoutStorePath(): string {
  return path.join(stateDir(), STORE_FILE);
}

export function defaultPaymentQrPath(orderId: string): string {
  const safeOrderId = orderId.replace(/[^A-Za-z0-9_-]/g, "_");
  return path.join(stateDir(), `payment-qr-${safeOrderId}.png`);
}

async function loadCheckoutStore(): Promise<CheckoutStore> {
  try {
    const text = await fs.readFile(checkoutStorePath(), "utf8");
    const parsed = JSON.parse(text) as CheckoutStore;
    return {
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      version: STORE_VERSION,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { orders: [], version: STORE_VERSION };
    }
    throw error;
  }
}

async function saveCheckoutStore(store: CheckoutStore): Promise<void> {
  await fs.mkdir(stateDir(), { recursive: true });
  await fs.writeFile(
    checkoutStorePath(),
    `${JSON.stringify(store, null, 2)}\n`,
    { mode: 0o600 }
  );
}

async function upsertOrder(order: CheckoutOrder): Promise<CheckoutOrder> {
  const store = await loadCheckoutStore();
  const index = store.orders.findIndex(
    (candidate) => candidate.orderId === order.orderId
  );
  if (index === -1) {
    store.orders.push(order);
  } else {
    store.orders[index] = order;
  }
  await saveCheckoutStore(store);
  return order;
}

export async function getCheckoutOrder(
  orderId: string
): Promise<CheckoutOrder> {
  const order = (await loadCheckoutStore()).orders.find(
    (candidate) => candidate.orderId === orderId
  );
  if (!order) {
    throw new TranquiloError(`Checkout order ${orderId} was not found.`, {
      code: "CHECKOUT_ORDER_NOT_FOUND",
    });
  }
  return order;
}

function shellQuote(value: string): string {
  return SHELL_SAFE_PATTERN.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

function checkoutPayCommand(orderId: string): string {
  const entry = process.argv[1];
  if (entry?.endsWith("/src/index.ts") || entry === "src/index.ts") {
    return `${shellQuote(process.argv[0] ?? "tranquilo")} ${shellQuote(entry)} checkout pay ${shellQuote(orderId)}`;
  }
  return `tranquilo checkout pay ${orderId}`;
}

export function publicCheckoutOrder(order: CheckoutOrder): PublicCheckoutOrder {
  return {
    addressId: order.addressId,
    amount: order.amount,
    bookingId: order.bookingId,
    bookingType: order.bookingType,
    cartVersion: order.cartVersion,
    createdAt: order.createdAt,
    hasPaymentUri: Boolean(order.paymentUri),
    juspayStatus: order.juspayStatus,
    merchantId: order.merchantId,
    orderId: order.orderId,
    payCommand: checkoutPayCommand(order.orderId),
    paymentUriSource: order.paymentUriSource,
    prontoStatus: order.prontoStatus,
    selectedDurationMinutes: order.selectedDurationMinutes,
    selectedListingId: order.selectedListingId,
    selectedListingItemId: order.selectedListingItemId,
    slot: order.slot,
    status: order.status,
    updatedAt: order.updatedAt,
  };
}

function extractCart(payload: JsonObject): JsonObject {
  const data = dataOf(payload);
  return asObject(data.cart) ?? data;
}

function paymentAmount(cart: JsonObject): number {
  const amount = numberValue(
    cart.amountPayable ?? cart.finalTotalAmount ?? cart.totalPriceWithGst
  );
  if (amount === undefined) {
    throw new TranquiloError("Cart did not return an amount payable.", {
      code: "CHECKOUT_AMOUNT_MISSING",
      details: cart,
    });
  }
  return amount;
}

function cartVersion(cart: JsonObject): number {
  const version = numberValue(cart.version);
  if (version === undefined) {
    throw new TranquiloError("Cart did not return a version.", {
      code: "CHECKOUT_CART_VERSION_MISSING",
      details: cart,
    });
  }
  return version;
}

function today(): Temporal.PlainDate {
  return todayPlainDate(systemTimezone());
}

function currentDateTime(): Temporal.PlainDateTime {
  return nowPlainDateTime(systemTimezone());
}

function bookableEnd(date: Temporal.PlainDate): Temporal.PlainDate {
  return date.add({ days: BOOKABLE_DAYS - 1 });
}

function slotPlainDateTime(slot: string): Temporal.PlainDateTime {
  try {
    return Temporal.PlainDateTime.from(slot);
  } catch {
    throw new TranquiloError("Checkout slot is not a valid local date/time.", {
      code: "INVALID_TIME",
      details: { slot },
    });
  }
}

function assertBookableSlot(slot: string): void {
  const current = today();
  const last = bookableEnd(current);
  const currentTime = currentDateTime();
  const requestedDateTime = slotPlainDateTime(slot);
  const requested = requestedDateTime.toPlainDate();
  if (
    Temporal.PlainDate.compare(requested, current) < 0 ||
    Temporal.PlainDate.compare(requested, last) > 0
  ) {
    throw new TranquiloError(
      `Tranquilo House Help can only be booked from ${current.toString()} through ${last.toString()}.`,
      {
        code: "BOOKING_DATE_OUT_OF_RANGE",
        details: {
          bookableFrom: current.toString(),
          bookableTo: last.toString(),
          requestedDate: requested.toString(),
        },
      }
    );
  }
  if (Temporal.PlainDateTime.compare(requestedDateTime, currentTime) < 0) {
    throw new TranquiloError(
      `Checkout slot ${requestedDateTime.toString({ smallestUnit: "minute" })} is in the past. Pick a future slot.`,
      {
        code: "BOOKING_SLOT_IN_PAST",
        details: {
          currentTime: currentTime.toString({ smallestUnit: "minute" }),
          requestedSlot: requestedDateTime.toString({ smallestUnit: "minute" }),
        },
      }
    );
  }
}

function cartItems(cart: JsonObject): JsonObject[] {
  return asArray(cart.items).filter((item): item is JsonObject =>
    Boolean(asObject(item))
  );
}

function cartItemListingId(item: JsonObject): string | undefined {
  const catalog = asObject(item.catalog);
  const listing = asObject(item.listing);
  return (
    stringValue(item.listingId) ??
    stringValue(item.catalogId) ??
    stringValue(catalog?.listingId) ??
    stringValue(catalog?.id) ??
    stringValue(listing?.id)
  );
}

function cartItemListingItemId(item: JsonObject): string | undefined {
  const catalog = asObject(item.catalog);
  return (
    stringValue(item.listingItemId) ??
    stringValue(item.itemId) ??
    stringValue(catalog?.listingItemId) ??
    stringValue(catalog?.itemId)
  );
}

function cartItemQuantity(item: JsonObject): number | undefined {
  return numberValue(item.quantity ?? item.qty ?? item.count);
}

function validateExpectedCartSelection(
  cart: JsonObject,
  input: CheckoutStartInput
): void {
  if (!(input.expectedListingId || input.expectedListingItemId)) {
    return;
  }

  const mappedItems = cartItems(cart).map((item) => ({
    listingId: cartItemListingId(item),
    listingItemId: cartItemListingItemId(item),
    name: stringValue(item.name ?? asObject(item.catalog)?.name),
    quantity: cartItemQuantity(item),
  }));
  const activeItems = mappedItems.filter(
    (item) => item.quantity === undefined || item.quantity > 0
  );
  const unexpectedItems = activeItems.filter((item) => {
    if (input.expectedListingId && item.listingId !== input.expectedListingId) {
      return true;
    }
    return Boolean(
      input.expectedListingItemId &&
        item.listingItemId &&
        item.listingItemId !== input.expectedListingItemId
    );
  });
  const match = activeItems.find((item) => {
    if (item.quantity !== undefined && item.quantity <= 0) {
      return false;
    }
    if (input.expectedListingId && item.listingId !== input.expectedListingId) {
      return false;
    }
    if (
      input.expectedListingItemId &&
      item.listingItemId &&
      item.listingItemId !== input.expectedListingItemId
    ) {
      return false;
    }
    return Boolean(item.listingId || item.listingItemId);
  });

  if (!(match && unexpectedItems.length === 0)) {
    throw new TranquiloError(
      "Cart does not contain the selected House Help duration. Restart slot search before checkout.",
      {
        code: "CHECKOUT_CART_MISMATCH",
        details: {
          expectedDurationMinutes: input.expectedDurationMinutes,
          expectedListingId: input.expectedListingId,
          expectedListingItemId: input.expectedListingItemId,
          items: mappedItems,
          unexpectedItems,
        },
      }
    );
  }
}

function checkoutData(payload: JsonObject): JsonObject {
  const data = dataOf(payload);
  return asObject(data.data) ?? data;
}

function checkoutErrorCode(error: unknown): number | undefined {
  const details = asObject((error as { details?: unknown }).details);
  const status = asObject(details?.status);
  return numberValue(status?.code);
}

export async function createCheckout(
  input: CheckoutStartInput
): Promise<PublicCheckoutOrder> {
  const client = await createClient();
  const slot = formatSlotTime(input.slot);
  assertBookableSlot(slot);
  const location = await resolveLocation(client, {
    addressId: input.addressId,
  });
  const { bookingType } = await assertScheduledServiceable(
    client,
    location,
    input.bookingType
  );

  if (input.addressId) {
    await client.setDeliveryAddress(input.addressId);
  }
  if (input.item?.length) {
    await client.setCart(parseCartItems(input.item), false);
  }
  await client.setCartSlot({ bookingType, time: slot });

  const cartPayload = await client.cart();
  const cart = extractCart(cartPayload);
  validateExpectedCartSelection(cart, input);
  const amount = paymentAmount(cart);
  const version = cartVersion(cart);

  let checkout: JsonObject;
  try {
    checkout = await client.checkoutCart({ amount, cartVersion: version });
  } catch (error) {
    if (checkoutErrorCode(error) === 2010) {
      throw new TranquiloError(
        "This slot is already overbooked. Pick or scan for a fresh slot.",
        {
          code: "SLOT_OVERBOOKED",
          details: (error as { details?: unknown }).details,
        }
      );
    }
    throw error;
  }

  const data = checkoutData(checkout);
  const sdkPayload = asObject(asObject(data.sdkPayload)?.payload);
  const clientAuthToken = stringValue(sdkPayload?.clientAuthToken);
  const orderId = stringValue(data.orderId ?? sdkPayload?.orderId);
  const merchantId = stringValue(sdkPayload?.merchantId) ?? "pronto";
  if (!(orderId && clientAuthToken)) {
    throw new TranquiloError("Checkout did not return a Juspay order token.", {
      code: "CHECKOUT_TOKEN_MISSING",
      details: checkout,
    });
  }

  const now = new Date().toISOString();
  const order: CheckoutOrder = {
    addressId: location.addressId,
    amount,
    bookingId: stringValue(data.bookingId),
    bookingType,
    cartVersion: version,
    clientAuthToken,
    createdAt: now,
    customerId: stringValue(sdkPayload?.customerId),
    merchantId,
    orderId,
    prontoStatus: stringValue(data.status),
    selectedDurationMinutes: input.expectedDurationMinutes,
    selectedListingId: input.expectedListingId,
    selectedListingItemId: input.expectedListingItemId,
    slot,
    status: "created",
    updatedAt: now,
  };
  await upsertOrder(order);
  return publicCheckoutOrder(order);
}

function savedMethodsData(payload: JsonObject): JsonObject {
  return dataOf(payload);
}

function merchantPaymentMethods(payload: JsonObject): JsonObject[] {
  const data = savedMethodsData(payload);
  return asArray(data.merchantPaymentMethods).filter(
    (item): item is JsonObject => Boolean(asObject(item))
  );
}

function supportsPaymentMethod(
  payload: JsonObject,
  method: "UPI_PAY" | "UPI_QR"
): boolean {
  const methods = merchantPaymentMethods(payload);
  if (!methods.length) {
    return true;
  }
  return methods.some(
    (item) =>
      stringValue(item.paymentMethod) === method ||
      stringValue(item.juspayBankCode) === method
  );
}

function extractUpiUri(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.startsWith("upi://pay?") ? value : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractUpiUri(item);
      if (found) {
        return found;
      }
    }
    return;
  }
  const object = asObject(value);
  if (!object) {
    return;
  }
  const preferred = [
    asObject(asObject(object.payment)?.sdk_params)?.pgIntentUrl,
    asObject(object.sdk_params)?.pgIntentUrl,
    object.pgIntentUrl,
    object.upiIntentUrl,
    object.intentUrl,
  ];
  for (const candidate of preferred) {
    const found = extractUpiUri(candidate);
    if (found) {
      return found;
    }
  }
  for (const candidate of Object.values(object)) {
    const found = extractUpiUri(candidate);
    if (found) {
      return found;
    }
  }
  return;
}

function extractPaymentPageUrl(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.startsWith("https://") && value.includes("/v2/pay/start/")
      ? value
      : undefined;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = extractPaymentPageUrl(item);
      if (found) {
        return found;
      }
    }
    return;
  }
  const object = asObject(value);
  if (!object) {
    return;
  }
  const preferred = [
    asObject(asObject(object.payment)?.authentication)?.url,
    asObject(object.authentication)?.url,
    object.paymentPageUrl,
  ];
  for (const candidate of preferred) {
    const found = extractPaymentPageUrl(candidate);
    if (found) {
      return found;
    }
  }
  for (const candidate of Object.values(object)) {
    const found = extractPaymentPageUrl(candidate);
    if (found) {
      return found;
    }
  }
  return;
}

function paymentPageFromStatus(payload: JsonObject): string | undefined {
  const data = dataOf(payload);
  const returnUrl = stringValue(
    asObject(data.payment)?.return_url ?? data.return_url ?? payload.return_url
  );
  if (!returnUrl) {
    return;
  }
  try {
    const url = new URL(returnUrl);
    const match = PAYMENT_CONFIRMATION_PATH_RE.exec(url.pathname);
    if (!match) {
      return;
    }
    return `${url.origin}/v2/pay/start/${match[1]}/${match[2]}?${PAYMENT_PAGE_QUERY}`;
  } catch {
    return;
  }
}

function updateOrderPaymentUri(
  order: CheckoutOrder,
  paymentUri: string,
  source: PaymentUriSource
): Promise<CheckoutOrder> {
  const updated: CheckoutOrder = {
    ...order,
    paymentUri,
    paymentUriSource: source,
    status: "payment_pending",
    updatedAt: new Date().toISOString(),
  };
  return upsertOrder(updated);
}

function isPaymentRetryNotAllowed(error: unknown): boolean {
  const details = asObject((error as { details?: unknown }).details);
  const candidates = [
    stringValue(details?.errorMessage),
    stringValue(details?.userMessage),
    stringValue(asObject(details?.errorInfo)?.developerMessage),
    error instanceof Error ? error.message : undefined,
  ];
  return candidates.some((text) =>
    text?.toLowerCase().includes("retry is not allowed")
  );
}

function paymentRetryNotAllowedError(error: unknown): TranquiloError {
  return new TranquiloError(
    "Juspay will not re-open payment for this order. Create a fresh checkout and pay immediately.",
    {
      code: "PAYMENT_RETRY_NOT_ALLOWED",
      details: (error as { details?: unknown }).details ?? error,
    }
  );
}

function checkoutCartListingIdPairs(selectedListingId: string): string[] {
  return [`${selectedListingId}=1`];
}

async function markPaymentRetryFailed(order: CheckoutOrder): Promise<void> {
  await upsertOrder({
    ...order,
    prontoStatus: order.prontoStatus ?? "PAYMENT_RETRY_NOT_ALLOWED",
    status: "failed",
    updatedAt: new Date().toISOString(),
  });
}

async function recoverExistingPaymentPage(
  client: Awaited<ReturnType<typeof createClient>>,
  order: CheckoutOrder
): Promise<PaymentUriResult | undefined> {
  const status = await client.juspayPaymentStatus({
    clientAuthToken: order.clientAuthToken,
    merchantId: order.merchantId,
    orderId: order.orderId,
  });
  const paymentUri = paymentPageFromStatus(status);
  if (!paymentUri) {
    return;
  }
  const updated = await updateOrderPaymentUri(
    order,
    paymentUri,
    "PAYMENT_PAGE"
  );
  return {
    order: publicCheckoutOrder(updated),
    paymentUri,
    source: "PAYMENT_PAGE",
  };
}

function paymentTargetFromTransaction(
  transaction: JsonObject,
  upiSource: UpiPaymentMethod
): PaymentTarget | undefined {
  const upiUri = extractUpiUri(transaction);
  if (upiUri) {
    return { paymentUri: upiUri, source: upiSource };
  }
  const paymentPage = extractPaymentPageUrl(transaction);
  return paymentPage
    ? { paymentUri: paymentPage, source: "PAYMENT_PAGE" }
    : undefined;
}

async function updateOrderPaymentTarget(
  order: CheckoutOrder,
  target: PaymentTarget
): Promise<PaymentUriResult> {
  const updated = await updateOrderPaymentUri(
    order,
    target.paymentUri,
    target.source
  );
  return withOptionalUpiApp(
    {
      order: publicCheckoutOrder(updated),
      paymentUri: target.paymentUri,
      source: target.source,
    },
    target.upiApp
  );
}

async function requestPaymentTarget(
  client: Awaited<ReturnType<typeof createClient>>,
  order: CheckoutOrder,
  paymentMethod: UpiPaymentMethod,
  upiApp?: UpiApp
): Promise<PaymentUriResult | undefined> {
  try {
    const transaction = await client.juspayTransaction({
      clientAuthToken: order.clientAuthToken,
      merchantId: order.merchantId,
      orderId: order.orderId,
      paymentMethod,
      upiApp: upiApp?.packageName,
    });
    const target = paymentTargetFromTransaction(transaction, paymentMethod);
    return target
      ? updateOrderPaymentTarget(order, withOptionalUpiApp(target, upiApp))
      : undefined;
  } catch (error) {
    if (isPaymentRetryNotAllowed(error)) {
      const recovered = await recoverExistingPaymentPage(client, order);
      if (recovered) {
        return recovered;
      }
      if (paymentMethod === "UPI_PAY") {
        throw paymentRetryNotAllowedError(error);
      }
    }
    if (paymentMethod === "UPI_PAY") {
      throw error;
    }
    return;
  }
}

export async function recreateCheckoutPaymentUri(
  orderId: string,
  options: {
    upiApp?: string | undefined;
  } = {}
): Promise<PaymentUriResult> {
  const original = await getCheckoutOrder(orderId);
  assertBookableSlot(original.slot);
  if (!(original.addressId && original.selectedListingId)) {
    throw new TranquiloError(
      "This checkout cannot be reopened automatically. Re-run the House Help booking command so Tranquilo can create a fresh order and show QR immediately.",
      {
        code: "PAYMENT_RECREATE_UNAVAILABLE",
        details: {
          hasAddressId: Boolean(original.addressId),
          hasSelectedListingId: Boolean(original.selectedListingId),
          orderId,
        },
      }
    );
  }

  await markPaymentRetryFailed(original);
  const item = checkoutCartListingIdPairs(original.selectedListingId);
  const fresh = await createCheckout({
    addressId: original.addressId,
    bookingType: original.bookingType,
    expectedDurationMinutes: original.selectedDurationMinutes,
    expectedListingId: original.selectedListingId,
    expectedListingItemId: original.selectedListingItemId,
    item,
    slot: original.slot,
  });
  const payment = await resolveCheckoutPaymentUri(fresh.orderId, {
    upiApp: options.upiApp,
  });
  return { ...payment, replacedOrderId: original.orderId };
}

export async function resolveCheckoutPaymentUri(
  orderId: string,
  options: {
    requireUpiApp?: boolean | undefined;
    upiApp?: string | undefined;
  } = {}
): Promise<PaymentUriResult> {
  const order = await getCheckoutOrder(orderId);
  assertBookableSlot(order.slot);
  if (order.paymentUri && order.paymentUriSource) {
    return {
      order: publicCheckoutOrder(order),
      paymentUri: order.paymentUri,
      source: order.paymentUriSource,
    };
  }

  const client = await createClient();
  const savedMethods = await client.juspaySavedPaymentMethods({
    clientAuthToken: order.clientAuthToken,
    customerId: order.customerId,
    merchantId: order.merchantId,
    orderId: order.orderId,
  });
  const selectedUpiApp = options.upiApp
    ? parseUpiApp(options.upiApp)
    : await rememberedUpiApp();

  if (supportsPaymentMethod(savedMethods, "UPI_PAY")) {
    if (selectedUpiApp) {
      const upiPayment = await requestPaymentTarget(
        client,
        order,
        "UPI_PAY",
        selectedUpiApp
      );
      if (upiPayment) {
        return upiPayment;
      }
      throw new TranquiloError(
        "Juspay did not return a UPI URI or payment page URL.",
        {
          code: "PAYMENT_URI_MISSING",
        }
      );
    }
    if (options.requireUpiApp !== false) {
      throw new TranquiloError(
        "Choose a UPI app before starting payment. Pass --upi-app phonepe, --upi-app googlepay, or --upi-app paytm.",
        {
          code: "UPI_APP_REQUIRED",
          details: { allowed: ["phonepe", "googlepay", "paytm"] },
        }
      );
    }
  }

  if (!supportsPaymentMethod(savedMethods, "UPI_QR")) {
    throw new TranquiloError("Juspay did not return a supported UPI method.", {
      code: "UPI_METHOD_UNAVAILABLE",
      details: savedMethods,
    });
  }

  const qrPayment = await requestPaymentTarget(client, order, "UPI_QR");
  if (qrPayment) {
    return qrPayment;
  }
  throw new TranquiloError(
    "Juspay did not return a UPI URI or payment page URL.",
    {
      code: "PAYMENT_URI_MISSING",
    }
  );
}

function extractPaymentStatus(payload: JsonObject): string | undefined {
  const data = dataOf(payload);
  return stringValue(
    data.status ??
      data.order_status ??
      data.txn_status ??
      payload.status ??
      asObject(data.payment)?.status
  );
}

function isFailureStatus(status?: string): boolean {
  return Boolean(
    status &&
      [
        "AUTHORIZATION_FAILED",
        "CANCELLED",
        "DECLINED",
        "FAILED",
        "FAILURE",
      ].includes(status)
  );
}

async function finalizeChargedOrder(
  order: CheckoutOrder,
  payment: JsonObject
): Promise<CheckoutStatusResult> {
  const client = await createClient();
  const processed = await client.processOrder(order.orderId);
  const processedData = dataOf(processed);
  const bookingId =
    stringValue(processedData.bookingId) ??
    stringValue(asObject(processedData.data)?.bookingId) ??
    order.bookingId;
  let booking: unknown;
  if (bookingId) {
    try {
      booking = await client.bookingDetail(bookingId);
    } catch {
      booking = undefined;
    }
  }
  const status = stringValue(processedData.paymentStatus);
  const updated = await upsertOrder({
    ...order,
    bookingId,
    juspayStatus: "CHARGED",
    prontoStatus: status,
    status: status === "SUCCESS" || bookingId ? "confirmed" : "charged",
    updatedAt: new Date().toISOString(),
  });
  return {
    booking,
    order: publicCheckoutOrder(updated),
    payment,
    processOrder: processed,
  };
}

export async function checkoutStatus(
  orderId: string
): Promise<CheckoutStatusResult> {
  const order = await getCheckoutOrder(orderId);
  assertBookableSlot(order.slot);
  const client = await createClient();
  const payment = await client.juspayPaymentStatus({
    clientAuthToken: order.clientAuthToken,
    merchantId: order.merchantId,
    orderId: order.orderId,
  });
  const status = extractPaymentStatus(payment);
  if (status === "CHARGED") {
    return finalizeChargedOrder(order, payment);
  }
  const updated = await upsertOrder({
    ...order,
    juspayStatus: status,
    status: isFailureStatus(status) ? "failed" : order.status,
    updatedAt: new Date().toISOString(),
  });
  return { order: publicCheckoutOrder(updated), payment };
}

export async function watchCheckoutStatus(
  orderId: string,
  options: {
    intervalMs?: number | undefined;
    timeoutMs?: number | undefined;
  } = {}
): Promise<CheckoutStatusResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_PAYMENT_TIMEOUT_MS;
  const intervalMs = options.intervalMs ?? DEFAULT_PAYMENT_INTERVAL_MS;
  const startedAt = Date.now();
  let last = await checkoutStatus(orderId);
  while (
    !["charged", "confirmed", "failed"].includes(last.order.status) &&
    Date.now() - startedAt < timeoutMs
  ) {
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
    last = await checkoutStatus(orderId);
  }
  return last;
}

export function terminalQr(
  paymentUri: string,
  size: TerminalQrSize = "compact"
): Promise<string> {
  let margin = 1;
  if (size === "small") {
    margin = 2;
  }
  if (size === "normal") {
    margin = 4;
  }
  return QRCode.toString(paymentUri, {
    errorCorrectionLevel: size === "compact" ? "L" : "M",
    margin,
    small: size !== "normal",
    type: "terminal",
  });
}

export async function savePaymentQr(
  paymentUri: string,
  file: string
): Promise<void> {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await QRCode.toFile(file, paymentUri);
}

export function copyPaymentUri(paymentUri: string): Promise<void> {
  return clipboard.write(paymentUri);
}

export async function openPaymentUri(paymentUri: string): Promise<void> {
  await open(paymentUri);
}
