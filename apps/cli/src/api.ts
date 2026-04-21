import type {
  BookingStatusPreset,
  CartItemMap,
  Credentials,
  JsonObject,
  RuntimeConfig,
} from "./types";
import { TranquiloError } from "./types";

type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | Array<string | number | boolean>;

/** @internal White-box tested booking query presets. */
export const BOOKING_PRESETS: Record<
  BookingStatusPreset,
  { statuses: string[]; bookingTypes: string[] }
> = {
  upcoming: {
    statuses: ["PENDING_MATCH", "MATCHED", "STARTED"],
    bookingTypes: ["INSTANT", "SCHEDULED"],
  },
  past: {
    statuses: ["COMPLETED", "CANCELLED"],
    bookingTypes: ["RECURRING", "INSTANT", "SCHEDULED"],
  },
  all: {
    statuses: ["PENDING_MATCH", "MATCHED", "STARTED", "COMPLETED", "CANCELLED"],
    bookingTypes: ["RECURRING", "INSTANT", "SCHEDULED"],
  },
};

/** @internal White-box tested query encoder. */
export function appendQuery(url: URL, query: Record<string, QueryValue>): void {
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        url.searchParams.append(key, String(item));
      }
      continue;
    }
    url.searchParams.set(key, String(value));
  }
}

export function parseCartItems(items: string[]): CartItemMap {
  const result: CartItemMap = {};
  for (const item of items) {
    const [id, qtyText] = item.split("=");
    const qty = Number(qtyText);
    if (!(id && Number.isInteger(qty)) || qty < 0) {
      throw new TranquiloError(
        `Invalid cart item "${item}". Expected listingId=qty.`,
        {
          code: "INVALID_CART_ITEM",
        }
      );
    }
    result[id] = qty;
  }
  return result;
}

export class TranquiloClient {
  private readonly config: RuntimeConfig;
  private readonly credentials: Credentials | null | undefined;

  constructor(config: RuntimeConfig, credentials?: Credentials | null) {
    this.config = config;
    this.credentials = credentials;
  }

  private async request<T = unknown>(
    method: "GET" | "PATCH" | "POST",
    pathname: string,
    options: {
      auth?: boolean | undefined;
      baseUrl?: string | undefined;
      body?: unknown | undefined;
      form?: Record<string, QueryValue>;
      query?: Record<string, QueryValue>;
    } = {}
  ): Promise<T> {
    if (options.auth && !this.credentials?.accessToken) {
      throw new TranquiloError("Not logged in. Run `tranquilo login` first.", {
        code: "NOT_AUTHENTICATED",
      });
    }

    const url = new URL(pathname, options.baseUrl ?? this.config.baseUrl);
    appendQuery(url, options.query ?? {});

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": options.form
        ? "application/x-www-form-urlencoded"
        : "application/json",
      "User-Agent": "tranquilo-cli/0.1",
      platform: this.config.platform,
      "app-version": this.config.appVersion,
    };
    if (options.auth) {
      headers.Authorization = `Bearer ${this.credentials?.accessToken}`;
    }

    let body: string | undefined;
    if (method !== "GET") {
      body = options.form
        ? formBody(options.form)
        : JSON.stringify(options.body ?? {});
    }

    const init: RequestInit = {
      method,
      headers,
    };
    if (body !== undefined) {
      init.body = body;
    }

    const response = await fetch(url, init);

    let payload: unknown = null;
    const text = await response.text();
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = text;
      }
    }

    if (!response.ok) {
      throw new TranquiloError(
        `API request failed with HTTP ${response.status}`,
        {
          code: "HTTP_ERROR",
          status: response.status,
          details: payload,
        }
      );
    }

    const status = (payload as JsonObject | null)?.status as
      | JsonObject
      | string;
    if (typeof status === "object" && status && status.success === false) {
      throw new TranquiloError(String(status.message || "API request failed"), {
        code: "API_ERROR",
        details: payload,
      });
    }

    return payload as T;
  }

  loginStart(mobileNumber: string): Promise<JsonObject> {
    return this.request("POST", "/gateway/auth/login", {
      body: { mobileNumber },
    });
  }

  verifyLogin(args: {
    token: string;
    idtoken: string;
    mobileNumber: string;
    referralCode?: string | null;
  }): Promise<JsonObject> {
    return this.request("POST", "/gateway/auth/verify", {
      body: { ...args, referralCode: args.referralCode ?? null },
    });
  }

  settings(): Promise<JsonObject> {
    return this.request("GET", "/gateway/settings");
  }

  pendingAgreements(): Promise<JsonObject> {
    return this.request("GET", "/gateway/agreement/pending", { auth: true });
  }

  user(): Promise<JsonObject> {
    return this.request("GET", "/gateway/users", { auth: true });
  }

  addresses(
    query: {
      lat?: number | undefined;
      lng?: number | undefined;
      nearestAddressRequired?: boolean | undefined;
    } = {}
  ): Promise<JsonObject> {
    return this.request("GET", "/gateway/users/addresses", {
      auth: true,
      query,
    });
  }

  serviceability(query: { lat: number; lng: number }): Promise<JsonObject> {
    return this.request("GET", "/gateway/location/availability", {
      auth: true,
      query: { lat: query.lat, long: query.lng },
    });
  }

  listings(query: { lat: number; lng: number }): Promise<JsonObject> {
    return this.request("GET", "/gateway/listings", { auth: true, query });
  }

  cart(): Promise<JsonObject> {
    return this.request("GET", "/gateway/cart/v2", { auth: true });
  }

  setDeliveryAddress(addressId: string): Promise<JsonObject> {
    return this.request("PATCH", "/gateway/cart", {
      auth: true,
      body: { deliveryAddressId: addressId },
    });
  }

  setCartSlot(args: {
    bookingType?: string | undefined;
    time: string;
  }): Promise<JsonObject> {
    return this.request("PATCH", "/gateway/cart", {
      auth: true,
      body: {
        bookingType: args.bookingType ?? "SCHEDULED",
        timeSlot: { time: [{ start: args.time }] },
      },
    });
  }

  setCart(catalogInfo: CartItemMap, isQuickAdd = false): Promise<JsonObject> {
    return this.request("POST", "/gateway/cart/v2", {
      auth: true,
      body: { catalogInfo, isQuickAdd },
    });
  }

  slotsBySkill(query: {
    lat: number;
    lng: number;
    listingIds: Array<string | number>;
    bookingType?: string | undefined;
    time: string;
    days: number;
  }): Promise<JsonObject> {
    return this.request("GET", "/gateway/bookings/slots/by-skill", {
      auth: true,
      query: {
        lat: query.lat,
        lng: query.lng,
        bookingType: query.bookingType ?? "SCHEDULED",
        time: query.time,
        days: query.days,
        listingIds: query.listingIds,
      },
    });
  }

  bookings(preset: BookingStatusPreset, page = 1): Promise<JsonObject> {
    const params = BOOKING_PRESETS[preset];
    return this.request("GET", "/gateway/bookings/v2", {
      auth: true,
      query: {
        "status[]": params.statuses,
        "bookingType[]": params.bookingTypes,
        page,
      },
    });
  }

  checkoutCart(args: {
    amount: number;
    cartVersion: number;
    paymentMethodId?: number | undefined;
  }): Promise<JsonObject> {
    return this.request("POST", "/gateway/cart/checkout", {
      auth: true,
      body: {
        amount: args.amount,
        cartVersion: args.cartVersion,
        meta: { orderSource: "APP" },
        paymentMethodId: args.paymentMethodId ?? 0,
        viaSessionCall: true,
      },
    });
  }

  processOrder(orderId: string): Promise<JsonObject> {
    return this.request("POST", "/gateway/v1/process-order", {
      auth: true,
      body: { orderId },
    });
  }

  bookingDetail(bookingId: string): Promise<JsonObject> {
    return this.request("GET", `/gateway/bookings/${bookingId}`, {
      auth: true,
    });
  }

  juspaySavedPaymentMethods(args: {
    clientAuthToken: string;
    customerId?: string | undefined;
    merchantId: string;
    orderId: string;
  }): Promise<JsonObject> {
    return this.request("GET", "/wapi/sdk/v1/savedPaymentMethods", {
      baseUrl: this.config.juspayBaseUrl,
      query: {
        add_customized_pm: false,
        add_default_reference_id: true,
        add_emandate_payment_methods: true,
        add_nick_name: true,
        add_outage: true,
        add_preferred_payment_methods: false,
        add_supported_features: true,
        add_tpv_payment_method: false,
        add_virtual_accounts: false,
        check_cvv_less_support: true,
        check_direct_otp_support: true,
        check_rewards_support: true,
        client_auth_token: args.clientAuthToken,
        customer_id: args.customerId,
        mandate_feature: "optional",
        merchant_id: args.merchantId,
        offers: true,
        order_id: args.orderId,
        refresh: false,
        supported_reference_ids_feature: true,
      },
    });
  }

  juspayTransaction(args: {
    clientAuthToken: string;
    merchantId: string;
    orderId: string;
    paymentMethod: "UPI_PAY" | "UPI_QR";
    upiApp?: string | undefined;
  }): Promise<JsonObject> {
    return this.request("POST", "/wapi/txns", {
      baseUrl: this.config.juspayBaseUrl,
      form: {
        additional_payment_details: "[]",
        client_auth_token: args.clientAuthToken,
        format: "json",
        merchant_id: args.merchantId,
        metadata: JSON.stringify({
          microapp: "hyperpay",
          payment_channel: this.config.platform.toUpperCase(),
          pp_mode: "RELEASE",
        }),
        order_id: args.orderId,
        payment_channel: this.config.platform.toUpperCase(),
        payment_method: args.paymentMethod,
        payment_method_type: "UPI",
        redirect_after_payment: true,
        sdk_params: true,
        txn_type: args.paymentMethod,
        upi_app: args.upiApp,
        upi_tr_field: "txn_id",
      },
    });
  }

  juspayPaymentStatus(args: {
    clientAuthToken?: string | undefined;
    merchantId: string;
    orderId: string;
  }): Promise<JsonObject> {
    return this.request("GET", "/wapi/order/payment-status", {
      baseUrl: this.config.juspayBaseUrl,
      query: {
        client_auth_token: args.clientAuthToken,
        merchant_id: args.merchantId,
        order_id: args.orderId,
      },
    });
  }
}

function formBody(form: Record<string, QueryValue>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, String(item));
      }
      continue;
    }
    params.set(key, String(value));
  }
  return params.toString();
}
