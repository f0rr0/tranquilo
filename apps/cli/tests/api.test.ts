import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { activeAddressIdFromCart, normalizeAddresses } from "../src/address";
import {
  appendQuery,
  BOOKING_PRESETS,
  parseCartItems,
  TranquiloClient,
} from "../src/api";
import { errorToJson, formatSlotTime } from "../src/context";
import {
  type Credentials,
  type JsonObject,
  type RuntimeConfig,
  TranquiloError,
} from "../src/types";

const config: RuntimeConfig = {
  baseUrl: "https://api.example.test",
  juspayBaseUrl: "https://juspay.example.test",
  platform: "ios",
  appVersion: "1.4.5",
};

const credentials: Credentials = {
  accessToken: "access-token",
  refreshToken: "refresh-token",
  savedAt: "2026-04-20T00:00:00.000Z",
};

const fixturePath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "fixtures",
  "addresses.redacted.json"
);
const addressFixture = JSON.parse(fs.readFileSync(fixturePath, "utf8")) as {
  addresses: JsonObject;
  cart: JsonObject;
};

interface CapturedRequest {
  init: RequestInit;
  url: string;
}

function firstCall(calls: CapturedRequest[]): CapturedRequest {
  const call = calls[0];
  if (!call) {
    throw new Error("Expected a captured request.");
  }
  return call;
}

function okResponse(data: unknown = { ok: true }): Response {
  return new Response(JSON.stringify({ status: { success: true }, data }), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}

describe("TranquiloClient endpoint mapping", () => {
  let calls: CapturedRequest[];

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init: init ?? {} });
        return Promise.resolve(okResponse());
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts login without an auth header", async () => {
    await new TranquiloClient(config, null).loginStart("+15551234567");

    expect(firstCall(calls).url).toBe(
      "https://api.example.test/gateway/auth/login"
    );
    expect(firstCall(calls).init.method).toBe("POST");
    expect(
      new Headers(firstCall(calls).init.headers).get("authorization")
    ).toBeNull();
    expect(JSON.parse(firstCall(calls).init.body as string)).toEqual({
      mobileNumber: "+15551234567",
    });
  });

  it("checks serviceability with captured long query parameter and auth", async () => {
    await new TranquiloClient(config, credentials).serviceability({
      lat: 12.9,
      lng: 77.6,
    });

    const url = new URL(firstCall(calls).url);
    expect(url.pathname).toBe("/gateway/location/availability");
    expect(url.searchParams.get("lat")).toBe("12.9");
    expect(url.searchParams.get("long")).toBe("77.6");
    expect(
      new Headers(firstCall(calls).init.headers).get("authorization")
    ).toBe("Bearer access-token");
  });

  it("encodes repeated booking status and booking type parameters from capture", async () => {
    await new TranquiloClient(config, credentials).bookings("past", 3);

    const url = new URL(firstCall(calls).url);
    expect(url.pathname).toBe("/gateway/bookings/v2");
    expect(url.searchParams.getAll("status[]")).toEqual(
      BOOKING_PRESETS.past.statuses
    );
    expect(url.searchParams.getAll("bookingType[]")).toEqual(
      BOOKING_PRESETS.past.bookingTypes
    );
    expect(url.searchParams.get("page")).toBe("3");
  });

  it("encodes item-aware slot listing ids as repeated query params", async () => {
    await new TranquiloClient(config, credentials).slotsBySkill({
      lat: 1,
      lng: 2,
      listingIds: ["27", "28"],
      days: 4,
      time: "2026-04-20T00:00:00.000Z",
    });

    const url = new URL(firstCall(calls).url);
    expect(url.pathname).toBe("/gateway/bookings/slots/by-skill");
    expect(url.searchParams.getAll("listingIds")).toEqual(["27", "28"]);
    expect(url.searchParams.get("bookingType")).toBe("SCHEDULED");
  });

  it("sets cart quantities with captured catalogInfo semantics", async () => {
    await new TranquiloClient(config, credentials).setCart({
      "27": 2,
      "28": 0,
    });

    expect(firstCall(calls).url).toBe(
      "https://api.example.test/gateway/cart/v2"
    );
    expect(firstCall(calls).init.method).toBe("POST");
    expect(JSON.parse(firstCall(calls).init.body as string)).toEqual({
      catalogInfo: { "27": 2, "28": 0 },
      isQuickAdd: false,
    });
  });

  it("sets active delivery address with captured cart PATCH semantics", async () => {
    await new TranquiloClient(config, credentials).setDeliveryAddress("988639");

    expect(firstCall(calls).url).toBe("https://api.example.test/gateway/cart");
    expect(firstCall(calls).init.method).toBe("PATCH");
    expect(JSON.parse(firstCall(calls).init.body as string)).toEqual({
      deliveryAddressId: "988639",
    });
  });

  it("sets selected cart slot with captured cart PATCH semantics", async () => {
    await new TranquiloClient(config, credentials).setCartSlot({
      time: "2026-04-23T09:30:00",
    });

    expect(firstCall(calls).url).toBe("https://api.example.test/gateway/cart");
    expect(firstCall(calls).init.method).toBe("PATCH");
    expect(JSON.parse(firstCall(calls).init.body as string)).toEqual({
      bookingType: "SCHEDULED",
      timeSlot: { time: [{ start: "2026-04-23T09:30:00" }] },
    });
  });

  it("creates checkout with captured body semantics", async () => {
    await new TranquiloClient(config, credentials).checkoutCart({
      amount: 82.96,
      cartVersion: 276,
    });

    expect(firstCall(calls).url).toBe(
      "https://api.example.test/gateway/cart/checkout"
    );
    expect(firstCall(calls).init.method).toBe("POST");
    expect(JSON.parse(firstCall(calls).init.body as string)).toEqual({
      amount: 82.96,
      cartVersion: 276,
      meta: { orderSource: "APP" },
      paymentMethodId: 0,
      viaSessionCall: true,
    });
  });

  it("posts Juspay UPI transactions as form encoded requests", async () => {
    await new TranquiloClient(config, credentials).juspayTransaction({
      clientAuthToken: "client-token",
      merchantId: "pronto",
      orderId: "order-1",
      paymentMethod: "UPI_PAY",
      upiApp: "phonepe://pay",
    });

    expect(firstCall(calls).url).toBe("https://juspay.example.test/wapi/txns");
    expect(firstCall(calls).init.method).toBe("POST");
    expect(new Headers(firstCall(calls).init.headers).get("content-type")).toBe(
      "application/x-www-form-urlencoded"
    );
    const body = new URLSearchParams(firstCall(calls).init.body as string);
    expect(body.get("client_auth_token")).toBe("client-token");
    expect(body.get("order_id")).toBe("order-1");
    expect(body.get("payment_method")).toBe("UPI_PAY");
    expect(body.get("upi_app")).toBe("phonepe://pay");
  });

  it("normalizes HTTP and API status errors", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "bad" }), { status: 500 })
    );

    await expect(
      new TranquiloClient(config, credentials).cart()
    ).rejects.toMatchObject({
      code: "HTTP_ERROR",
      status: 500,
    });

    vi.mocked(fetch).mockResolvedValueOnce(okResponse());
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          status: { success: false, message: "No slots" },
        }),
        { status: 200 }
      )
    );

    await new TranquiloClient(config, credentials).cart();
    await expect(
      new TranquiloClient(config, credentials).cart()
    ).rejects.toMatchObject({
      code: "API_ERROR",
      message: "No slots",
    });
  });
});

describe("helpers", () => {
  it("appends array query params and skips nullish values", () => {
    const url = new URL("https://api.example.test/path");
    appendQuery(url, {
      "status[]": ["MATCHED", "STARTED"],
      empty: undefined,
      page: 1,
    });

    expect(url.searchParams.getAll("status[]")).toEqual(["MATCHED", "STARTED"]);
    expect(url.searchParams.has("empty")).toBe(false);
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("parses cart item pairs", () => {
    expect(parseCartItems(["27=2", "28=0"])).toEqual({ "27": 2, "28": 0 });
    expect(() => parseCartItems(["27=-1"])).toThrow(TranquiloError);
  });

  it("serializes Tranquilo errors for CLI and MCP consumers", () => {
    expect(
      errorToJson(
        new TranquiloError("No auth", {
          code: "NOT_AUTHENTICATED",
          status: 401,
        })
      )
    ).toEqual({
      ok: false,
      error: {
        code: "NOT_AUTHENTICATED",
        message: "No auth",
        status: 401,
        details: undefined,
      },
    });
  });

  it("formats slot times in the local API shape captured by the app", () => {
    expect(formatSlotTime(new Date(2026, 3, 20, 12, 17, 24, 123))).toBe(
      "2026-04-20T12:17:24"
    );
    expect(formatSlotTime("2026-04-20T12:17")).toBe("2026-04-20T12:17:00");
    expect(formatSlotTime("2026-04-20T12:17:24")).toBe("2026-04-20T12:17:24");
    expect(formatSlotTime("2026-04-20 6pm")).toBe("2026-04-20T18:00:00");
    expect(formatSlotTime("20 Apr 2026 8:30am")).toBe("2026-04-20T08:30:00");
    expect(formatSlotTime("20/04/2026 18:15")).toBe("2026-04-20T18:15:00");
    expect(formatSlotTime("2026-04-20T12:17:24.123Z")).not.toContain("Z");
    expect(() => formatSlotTime("not-a-time")).toThrow(TranquiloError);
  });

  it("normalizes addresses and extracts active cart address ids", () => {
    const activeAddressId = activeAddressIdFromCart(addressFixture.cart);
    const addresses = normalizeAddresses(
      addressFixture.addresses,
      activeAddressId
    );

    expect(activeAddressId).toBe("988639");
    expect(addresses).toEqual([
      expect.objectContaining({
        id: "989392",
        isActive: false,
        label: "Gym",
        profileDefault: false,
        type: "OTHER",
      }),
      expect.objectContaining({
        id: "988639",
        isActive: true,
        label: "Home",
        profileDefault: true,
        type: "HOME",
      }),
    ]);
  });
});
