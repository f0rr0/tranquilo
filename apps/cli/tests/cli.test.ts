import { spawnSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PACKAGE_METADATA } from "@tranquilo/cli-model/release-metadata";
import open from "open";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalQr } from "../src/checkout";
import {
  addressesListAction,
  addressShowAction,
  addressUseAction,
  checkoutPayAction,
  doctorAction,
  househelpBookAction,
  househelpFindAction,
  househelpOptionsAction,
  househelpWatchCreateAction,
  loginAction,
  loginStartAction,
  loginVerifyAction,
  telemetryDisableAction,
  telemetryEnableAction,
  telemetryFlushAction,
  telemetryRecordInstallAction,
  telemetryStatusAction,
} from "../src/cli-actions";
import {
  clearCredentials,
  credentialStorageStatus,
  loadCredentials,
  saveCredentials,
} from "../src/storage";
import { maybeFlushTelemetry } from "../src/telemetry";
import type { Credentials, JsonObject } from "../src/types";

vi.mock("open", () => ({ default: vi.fn(() => Promise.resolve()) }));

const ANSI_PATTERN = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g"
);
const ANONYMOUS_ID_RE = /^anon_/u;
const CLI_VERSION = PACKAGE_METADATA.version;
const CUSTOM_QUADRANT_QR_PATTERN = /[▘▝▖▗▚▞▛▜▙▟]/;

interface ServerCall {
  authorization?: string | undefined;
  body: string;
  method?: string | undefined;
  url?: string | undefined;
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

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

const househelpListings = [
  {
    id: 34,
    metadata: { handlingType: "BUNDLE", type: "HOURLY_BUNDLE" },
    name: "Hourly Services",
    requiredSkills: ["HOUSE_HELP"],
    items: [
      {
        effectivePrice: 39,
        id: 51,
        name: "Hourly Services - 30 min",
        price: 150,
        qty: 30,
        timeTaken: 30,
        unit: "MINUTE",
      },
    ],
  },
  {
    id: 27,
    metadata: { handlingType: "BUNDLE", type: "HOURLY_BUNDLE" },
    name: "Hourly Services",
    requiredSkills: ["HOUSE_HELP"],
    items: [
      {
        effectivePrice: 79,
        id: 44,
        name: "Hourly Services - 60 min",
        price: 250,
        qty: 60,
        timeTaken: 60,
        unit: "MINUTE",
      },
    ],
  },
  {
    id: 28,
    metadata: { handlingType: "BUNDLE", type: "HOURLY_BUNDLE" },
    name: "Hourly Services",
    requiredSkills: ["HOUSE_HELP"],
    items: [
      {
        effectivePrice: 119,
        id: 45,
        name: "Hourly Services - 90 min",
        price: 350,
        qty: 90,
        timeTaken: 90,
        unit: "MINUTE",
      },
    ],
  },
];

function listingFor(id: string): JsonObject | undefined {
  return househelpListings.find((listing) => String(listing.id) === id);
}

function cartPayload(
  activeAddressId: string,
  catalogInfo: Record<string, number>
): JsonObject {
  const baseData = addressFixture.cart.data as JsonObject;
  const baseCart = baseData.cart as JsonObject;
  const address = (
    (addressFixture.addresses.data as JsonObject).data as JsonObject[]
  ).find((candidate) => candidate.id === activeAddressId);
  const items = Object.entries(catalogInfo)
    .filter(([, quantity]) => quantity > 0)
    .map(([catalogId, quantity]) => {
      const listing = listingFor(catalogId);
      const listingItem = ((listing?.items as JsonObject[] | undefined) ??
        [])[0];
      const unitPrice = Number(listingItem?.effectivePrice ?? 0);
      return {
        amountPayable: unitPrice * quantity,
        catalog: {
          id: catalogId,
          listingId: catalogId,
          name: listing?.name ?? "Hourly Services",
        },
        id: `cart-item-${catalogId}`,
        listingItemId: listingItem?.id,
        quantity,
        unitPrice,
      };
    });
  const amountPayable = items.reduce(
    (sum, item) => sum + Number(item.amountPayable),
    0
  );
  return {
    ...addressFixture.cart,
    data: {
      ...baseData,
      cart: {
        ...baseCart,
        amountPayable,
        deliveryAddress: address,
        items,
        version: 276,
      },
    },
  };
}

function jsonResponse(res: ServerResponse, payload: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

describe("CLI integration against a mocked API", () => {
  let server: http.Server;
  let baseUrl: string;
  let calls: ServerCall[];
  let activeAddressId: string;
  let cartCatalogInfo: Record<string, number>;
  let originalEnv: NodeJS.ProcessEnv;
  let paymentStatusCalls: number;
  let tempDir: string;

  beforeEach(async () => {
    vi.mocked(open).mockClear();
    calls = [];
    activeAddressId = "988639";
    cartCatalogInfo = { "27": 2 };
    originalEnv = { ...process.env };
    delete process.env.CI;
    delete process.env.TRANQUILO_NO_TELEMETRY;
    delete process.env.TRANQUILO_TELEMETRY_DEBUG;
    delete process.env.TRANQUILO_TELEMETRY_URL;
    paymentStatusCalls = 0;
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tranquilo-cli-"));
    process.env.TRANQUILO_NOW = "2026-04-20T08:00:00Z";
    server = http.createServer(
      async (req: IncomingMessage, res: ServerResponse) => {
        const body = await readBody(req);
        calls.push({
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body,
        });
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        if (req.method === "GET" && url.pathname === "/api/cli/update") {
          jsonResponse(res, {
            currentVersion: url.searchParams.get("version") ?? "0.1.0",
            docsUrl: "https://tranquilo-ai.vercel.app/docs",
            installCommand:
              "curl -fsSL https://tranquilo-ai.vercel.app/install.sh | sh",
            latestVersion: "0.1.0",
            releaseNotesUrl: "https://github.com/example/releases/v0.1.0",
            updateAvailable: false,
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/cli/telemetry") {
          jsonResponse(res, { ok: true });
          return;
        }
        if (req.method === "POST" && url.pathname === "/gateway/auth/login") {
          const parsed = JSON.parse(body) as { mobileNumber: string };
          jsonResponse(res, {
            data: { token: `otp-token-${parsed.mobileNumber}` },
            status: "OK",
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/gateway/auth/verify") {
          jsonResponse(res, {
            data: {
              data: {
                refreshToken: "login-refresh-token",
                token: "login-access-token",
                userData: { id: "login-user" },
              },
            },
            status: "OK",
          });
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/gateway/users/addresses"
        ) {
          jsonResponse(res, addressFixture.addresses);
          return;
        }
        if (req.method === "GET" && url.pathname === "/gateway/cart/v2") {
          jsonResponse(res, cartPayload(activeAddressId, cartCatalogInfo));
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/gateway/location/availability"
        ) {
          jsonResponse(res, {
            data: {
              serviceable: "SERVICEABLE",
              serviceableBookingTypes: ["SCHEDULED", "RECURRING"],
            },
            status: "OK",
          });
          return;
        }
        if (req.method === "GET" && url.pathname === "/gateway/listings") {
          jsonResponse(res, {
            data: { listings: househelpListings },
            status: "OK",
          });
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/gateway/bookings/slots/by-skill"
        ) {
          jsonResponse(res, {
            data: {
              slotGroups: [
                {
                  listingIds: url.searchParams.getAll("listingIds"),
                  skillId: 1,
                  skillName: "HOUSE_HELP",
                  slots: [
                    {
                      startTime: "2026-04-20T16:30:00",
                      endTime: "2026-04-20T17:00:00",
                      isFull: true,
                      isExperiencingSurge: false,
                      surgePrice: 0,
                      slotsLeft: 0,
                    },
                    {
                      startTime: "2026-04-20T07:00:00",
                      endTime: "2026-04-20T07:30:00",
                      isFull: false,
                      isExperiencingSurge: false,
                      surgePrice: 0,
                      slotsLeft: 1,
                    },
                    {
                      startTime: "2026-04-20T18:00:00",
                      endTime: "2026-04-20T18:30:00",
                      isFull: false,
                      isExperiencingSurge: false,
                      surgePrice: 0,
                      slotsLeft: 1,
                    },
                  ],
                },
              ],
            },
            status: "OK",
          });
          return;
        }
        if (req.method === "PATCH" && url.pathname === "/gateway/cart") {
          const parsed = JSON.parse(body) as {
            deliveryAddressId?: string | undefined;
            timeSlot?: unknown | undefined;
          };
          if (parsed.deliveryAddressId) {
            activeAddressId = parsed.deliveryAddressId;
          }
          jsonResponse(res, {
            data: {
              cart: {
                deliveryAddress: { id: activeAddressId },
                id: "cart-1",
              },
              message: "Cart updated successfully",
              success: true,
            },
            status: "OK",
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/gateway/cart/v2") {
          const parsed = JSON.parse(body) as {
            catalogInfo?: Record<string, number>;
          };
          cartCatalogInfo = parsed.catalogInfo ?? {};
          jsonResponse(res, cartPayload(activeAddressId, cartCatalogInfo));
          return;
        }
        if (
          req.method === "POST" &&
          url.pathname === "/gateway/cart/checkout"
        ) {
          const parsed = JSON.parse(body) as { amount: number };
          jsonResponse(res, {
            data: {
              bookingId: "booking-1",
              orderId: "order-1",
              sdkPayload: {
                payload: {
                  amount: parsed.amount,
                  clientAuthToken: "client-auth-token",
                  customerId: "customer-1",
                  merchantId: "pronto",
                  orderId: "order-1",
                },
              },
              status: "CREATED",
            },
            status: "OK",
          });
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/wapi/sdk/v1/savedPaymentMethods"
        ) {
          if (url.searchParams.get("order_id") === "gpay-order") {
            jsonResponse(res, {
              appsUsed: [
                {
                  packageName: "gpay://upi/pay",
                },
              ],
              lastUsedPaymentMethod: {
                methodType: "UPI_PAY",
                packageName: "gpay://upi/pay",
              },
              merchantPaymentMethods: [
                { paymentMethod: "UPI_QR", paymentMethodType: "UPI" },
                { paymentMethod: "UPI_PAY", paymentMethodType: "UPI" },
              ],
              status: "OK",
            });
            return;
          }
          jsonResponse(res, {
            merchantPaymentMethods: [
              { paymentMethod: "UPI_QR", paymentMethodType: "UPI" },
              { paymentMethod: "UPI_PAY", paymentMethodType: "UPI" },
            ],
            status: "OK",
          });
          return;
        }
        if (req.method === "POST" && url.pathname === "/wapi/txns") {
          const params = new URLSearchParams(body);
          if (
            params.get("order_id") === "page-order" &&
            params.get("payment_method") === "UPI_PAY"
          ) {
            jsonResponse(res, {
              payment: {
                authentication: {
                  url: "https://api.juspay.in/v2/pay/start/pronto/txn-page?cardIssuerBankName=UPI_PAY&cardType=UPI&paymentMethod=UPI_PAY&paymentMethodType=UPI",
                },
              },
              status: "PENDING_VBV",
            });
            return;
          }
          if (
            ["retry-order", "status-page-order"].includes(
              params.get("order_id") ?? ""
            )
          ) {
            res.statusCode = 400;
            jsonResponse(res, {
              error: true,
              errorInfo: {
                code: "INTERNAL_SERVER_ERROR",
                developerMessage:
                  "Retry is not Allowed because order id and transaction id are same",
                userMessage: "Unable to create entity.",
              },
              errorMessage:
                "Retry is not Allowed because order id and transaction id are same",
              userMessage: "Retry is not Allowed",
            });
            return;
          }
          if (params.get("payment_method") === "UPI_QR") {
            jsonResponse(res, { status: "NO_URI" });
            return;
          }
          jsonResponse(res, {
            payment: {
              sdk_params: {
                pgIntentUrl:
                  "upi://pay?pa=cf.pronto@cashfree&pn=Pronto&tr=txn-1&am=158&cu=INR",
              },
            },
            status: "PENDING_VBV",
          });
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/wapi/order/payment-status"
        ) {
          if (url.searchParams.get("order_id") === "status-page-order") {
            jsonResponse(res, {
              order_id: "status-page-order",
              return_url:
                "https://api.juspay.in/v2/pay/confirmation/pronto/statusTxn?status=PENDING_VBV&status_id=23&order_id=status-page-order",
              status: "PENDING_VBV",
            });
            return;
          }
          paymentStatusCalls += 1;
          jsonResponse(res, {
            status: paymentStatusCalls > 1 ? "CHARGED" : "PENDING_VBV",
          });
          return;
        }
        if (
          req.method === "POST" &&
          url.pathname === "/gateway/v1/process-order"
        ) {
          jsonResponse(res, {
            data: { bookingId: "booking-1", paymentStatus: "SUCCESS" },
            status: "OK",
          });
          return;
        }
        if (
          req.method === "GET" &&
          url.pathname === "/gateway/bookings/booking-1"
        ) {
          jsonResponse(res, {
            data: { id: "booking-1", status: "PENDING_MATCH" },
            status: "OK",
          });
          return;
        }
        jsonResponse(res, {
          data: { data: [{ id: "service-1", name: "Service" }] },
          status: { success: true },
        });
      }
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("mock server did not bind to a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.TRANQUILO_BASE_URL = baseUrl;
    process.env.TRANQUILO_CONFIG_DIR = tempDir;
    process.env.TRANQUILO_JUSPAY_BASE_URL = baseUrl;
    process.env.TRANQUILO_STATE_DIR = tempDir;
    process.env.TRANQUILO_TOKEN = "test-token";
  });

  afterEach(async () => {
    process.env = originalEnv;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fsp.rm(tempDir, { force: true, recursive: true });
  });

  it("generates the address command tree through Citty", () => {
    const result = spawnSync("bun", ["src/index.ts", "addresses", "--help"], {
      cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("use");
    expect(result.stdout).toContain("list");
    expect(result.stdout).toContain("show");
    expect(result.stdout).not.toContain(" add ");
    expect(result.stdout).not.toContain(" edit ");
  }, 20_000);

  it("keeps doctor secret checks opt-in", async () => {
    const basic = JSON.parse(await doctorAction({ json: true })) as JsonObject;
    expect(basic.ok).toBe(true);
    expect(basic.secretsChecked).toBe(false);
    expect(basic.authenticated).toBeUndefined();
    expect(basic.storage).toBeUndefined();
    expect(basic.version).toBe(PACKAGE_METADATA.version);

    const withSecrets = JSON.parse(
      await doctorAction({ json: true, secrets: true })
    ) as JsonObject;
    expect(withSecrets.secretsChecked).toBe(true);
    expect(withSecrets.authenticated).toBe(true);
    expect(withSecrets.storage).toBeDefined();
  });

  it("renders doctor output as human-readable text by default", async () => {
    const output = await doctorAction();

    expect(output).toContain("Tranquilo");
    expect(output).toContain("Platform:");
    expect(output).toContain("Config:");
    expect(output).not.toContain('"ok"');
  });

  it("stores credentials in the encrypted local file", async () => {
    delete process.env.TRANQUILO_TOKEN;
    delete process.env.TRANQUILO_REFRESH_TOKEN;
    const credentials: Credentials = {
      accessToken: "access-token",
      refreshToken: "refresh-token",
      savedAt: "2026-04-21T00:00:00.000Z",
      userId: "user-1",
    };

    await clearCredentials();
    await expect(saveCredentials(credentials)).resolves.toBe("encrypted-file");
    await expect(loadCredentials()).resolves.toEqual(credentials);
    await expect(credentialStorageStatus()).resolves.toEqual({
      fallbackFileExists: true,
    });
  });

  it("fails login in no-interactive mode before prompting or sending OTP", async () => {
    await expect(loginAction({ noInteractive: true })).rejects.toMatchObject({
      code: "LOGIN_INPUT_REQUIRED",
    });
    expect(calls).toHaveLength(0);
  });

  it("logs in with explicit phone and OTP without prompting", async () => {
    delete process.env.TRANQUILO_TOKEN;
    delete process.env.TRANQUILO_REFRESH_TOKEN;
    await clearCredentials();

    const output = await loginAction({
      noInteractive: true,
      otp: "123456",
      phone: "+919999999999",
    });

    expect(JSON.parse(output)).toMatchObject({
      ok: true,
      storage: "encrypted-file",
      userId: "login-user",
    });
    const loginCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/auth/login"
    );
    const verifyCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/auth/verify"
    );
    expect(JSON.parse(loginCall?.body ?? "{}")).toEqual({
      mobileNumber: "+919999999999",
    });
    expect(JSON.parse(verifyCall?.body ?? "{}")).toEqual({
      idtoken: "123456",
      mobileNumber: "+919999999999",
      referralCode: null,
      token: "otp-token-+919999999999",
    });
    await expect(loadCredentials()).resolves.toMatchObject({
      accessToken: "login-access-token",
      mobileNumber: "+919999999999",
      refreshToken: "login-refresh-token",
      userId: "login-user",
    });
  });

  it("supports agent-safe two-step login without prompting", async () => {
    delete process.env.TRANQUILO_TOKEN;
    delete process.env.TRANQUILO_REFRESH_TOKEN;
    await clearCredentials();

    const start = JSON.parse(
      await loginStartAction({
        noInteractive: true,
        phone: "+919999999999",
      })
    ) as JsonObject;
    expect(start).toMatchObject({
      ok: true,
      mobileNumber: "+919999999999",
    });
    expect(start.loginSessionId).toEqual(expect.any(String));

    const verify = JSON.parse(
      await loginVerifyAction({
        noInteractive: true,
        otp: "123456",
        session: String(start.loginSessionId),
      })
    ) as JsonObject;

    expect(verify).toMatchObject({
      ok: true,
      storage: "encrypted-file",
      userId: "login-user",
    });
    await expect(loadCredentials()).resolves.toMatchObject({
      accessToken: "login-access-token",
      mobileNumber: "+919999999999",
      refreshToken: "login-refresh-token",
      userId: "login-user",
    });
  });

  it("parses --no-interactive for login without opening a prompt", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "login", "--json", "--no-interactive"],
      {
        cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          TRANQUILO_BASE_URL: baseUrl,
          TRANQUILO_NO_TELEMETRY: "1",
          TRANQUILO_STATE_DIR: tempDir,
        },
        timeout: 15_000,
      }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(JSON.parse(result.stderr)).toMatchObject({
      error: { code: "LOGIN_INPUT_REQUIRED" },
      ok: false,
    });
  }, 20_000);

  it("accepts install-agent target as a positional argument", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "install-agent", "--help"],
      {
        cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        timeout: 15_000,
      }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("<TARGET>");
    expect(result.stdout).toContain("auto");
    expect(result.stdout).not.toContain("--target");
  }, 20_000);

  it("runs update check without invoking the installer fallback", () => {
    const result = spawnSync(
      "bun",
      ["src/index.ts", "update", "check", "--json", "--no-interactive"],
      {
        cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        env: {
          ...process.env,
          TRANQUILO_NO_TELEMETRY: "1",
          TRANQUILO_STATE_DIR: tempDir,
          TRANQUILO_UPDATE_URL: `${baseUrl}/api/cli/update`,
        },
        timeout: 15_000,
      }
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual({
      data: null,
      ok: true,
    });
    expect(result.stderr).not.toContain("curl:");
  }, 20_000);

  it("persists telemetry preferences with explicit enable and disable commands", async () => {
    expect(
      JSON.parse(await telemetryStatusAction({ json: true }))
    ).toMatchObject({
      effectiveEnabled: false,
      pendingEvents: 0,
    });

    expect(
      JSON.parse(await telemetryEnableAction({ json: true }))
    ).toMatchObject({
      effectiveEnabled: true,
      enabled: true,
    });

    expect(
      JSON.parse(await telemetryDisableAction({ json: true }))
    ).toMatchObject({
      effectiveEnabled: false,
      enabled: false,
    });
  });

  it("records install telemetry once without sending sensitive fields", async () => {
    process.env.TRANQUILO_TELEMETRY_URL = `${baseUrl}/api/cli/telemetry`;
    calls = [];

    await telemetryEnableAction();
    await telemetryRecordInstallAction({ agentTarget: "auto" });
    await telemetryRecordInstallAction({ agentTarget: "auto" });
    await telemetryFlushAction();

    const telemetryCalls = calls.filter(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/api/cli/telemetry"
    );
    expect(telemetryCalls).toHaveLength(1);

    const payload = JSON.parse(telemetryCalls[0]?.body ?? "{}") as {
      events: Array<{
        anonymousId: string;
        event: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      anonymousId: expect.stringMatching(ANONYMOUS_ID_RE),
      event: "install_succeeded",
      properties: {
        agentTarget: "auto",
        arch: process.arch,
        cliVersion: CLI_VERSION,
        os: process.platform,
        transport: "install_sh",
      },
    });
    expect(telemetryCalls[0]?.body).not.toContain("order-1");
    expect(telemetryCalls[0]?.body).not.toContain("booking-1");
  });

  it("records confirmed booking telemetry without leaking order ids or slots", async () => {
    process.env.TRANQUILO_TELEMETRY_URL = `${baseUrl}/api/cli/telemetry`;
    calls = [];

    await telemetryEnableAction();
    await househelpBookAction({
      date: "2026-04-20",
      duration: "60",
      intervalMs: 1,
      json: true,
      noInteractive: true,
      pay: true,
      slot: "20 Apr 2026 6pm",
      timeoutMs: 250,
      upiApp: "googlepay",
      window: "after-work",
    });
    await maybeFlushTelemetry();

    const telemetryCalls = calls.filter(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/api/cli/telemetry"
    );
    expect(telemetryCalls).toHaveLength(1);

    const payload = JSON.parse(telemetryCalls[0]?.body ?? "{}") as {
      events: Array<{
        event: string;
        properties: Record<string, unknown>;
      }>;
    };
    expect(payload.events).toHaveLength(1);
    expect(payload.events[0]).toMatchObject({
      event: "booking_confirmed",
      properties: {
        arch: process.arch,
        cliVersion: CLI_VERSION,
        durationMinutes: 60,
        os: process.platform,
      },
    });
    expect(telemetryCalls[0]?.body).not.toContain("order-1");
    expect(telemetryCalls[0]?.body).not.toContain("booking-1");
    expect(telemetryCalls[0]?.body).not.toContain("2026-04-20T18:00:00");
    expect(telemetryCalls[0]?.body).not.toContain("client-auth-token");
  }, 20_000);

  it("lists addresses as a clean table by default", async () => {
    const output = await addressesListAction({});

    expect(output).toContain("Status");
    expect(output).toContain("Details");
    expect(output).toContain("active");
    expect(output).toContain("Gym");
    expect(output).toContain("988639");
    expect(output).toContain("╭");
  });

  it("stacks address rows on narrow terminals", async () => {
    process.env.COLUMNS = "56";
    const output = await addressesListAction({});

    expect(output).toContain("Label");
    expect(output).toContain("Details");
    expect(output).toContain("Gym");
    expect(output).toContain("989392");
    expect(output).not.toContain("City / PIN");
    expect(
      Math.max(
        ...output
          .split("\n")
          .map((line) => line.replace(ANSI_PATTERN, "").length)
      )
    ).toBeLessThanOrEqual(56);
  });

  it("lists House Help options from the live backend catalog", async () => {
    const output = await househelpOptionsAction({ json: true });

    expect(JSON.parse(output)).toMatchObject({
      location: { addressId: "988639", source: "active-cart-address" },
      options: [
        {
          durationMinutes: 30,
          listingId: "34",
          listingItemId: "51",
        },
        {
          durationMinutes: 60,
          listingId: "27",
          listingItemId: "44",
        },
        {
          durationMinutes: 90,
          listingId: "28",
          listingItemId: "45",
        },
      ],
      serviceableBookingTypes: ["SCHEDULED", "RECURRING"],
    });

    const humanOutput = await househelpOptionsAction({});
    expect(humanOutput).toContain("Find slots");
    expect(humanOutput).toContain("househelp find");
    expect(humanOutput).toContain("--duration 30");
  });

  it("finds ranked House Help slots with duration preferences", async () => {
    const output = await househelpFindAction({
      date: "2026-04-20",
      duration: "60",
      exactDuration: true,
      json: true,
      noInteractive: true,
      window: "after-work",
    });

    const url = new URL(calls.at(-1)?.url ?? "", baseUrl);
    expect(url.pathname).toBe("/gateway/bookings/slots/by-skill");
    expect(url.searchParams.getAll("listingIds")).toEqual(["27"]);
    expect(JSON.parse(output)).toMatchObject({
      durationOrder: [60],
      queryListingIds: ["27"],
      slots: [
        {
          durationMinutes: 60,
          listingId: "27",
          listingItemId: "44",
          rank: 1,
          startTime: "2026-04-20T18:00:00",
        },
      ],
    });
  });

  it("filters out same-day House Help slots that are earlier than now", async () => {
    const output = await househelpFindAction({
      date: "2026-04-20",
      duration: "60",
      exactDuration: true,
      json: true,
      noInteractive: true,
      window: "any",
    });

    const url = new URL(calls.at(-1)?.url ?? "", baseUrl);
    expect(url.searchParams.get("time")).toContain("2026-04-20T");
    expect(url.searchParams.get("time")).not.toBe("2026-04-20T00:00:00");
    const slots = JSON.parse(output).slots as Array<{ startTime: string }>;
    expect(slots.map((slot) => slot.startTime)).toEqual([
      "2026-04-20T18:00:00",
    ]);
  });

  it("anchors House Help slot queries to the requested date", async () => {
    await househelpFindAction({
      date: "2026-04-21",
      duration: "60",
      exactDuration: true,
      json: true,
      noInteractive: true,
      window: "any",
    });

    const url = new URL(calls.at(-1)?.url ?? "", baseUrl);
    expect(url.pathname).toBe("/gateway/bookings/slots/by-skill");
    expect(url.searchParams.get("days")).toBe("1");
    expect(url.searchParams.get("time")).toBe("2026-04-21T00:00:00");
  });

  it("does not offer House Help slots beyond the real booking horizon", async () => {
    await expect(
      househelpFindAction({
        date: "2026-04-24",
        duration: "60",
        json: true,
        noInteractive: true,
        window: "after-work",
      })
    ).rejects.toMatchObject({ code: "BOOKING_DATE_OUT_OF_RANGE" });
  });

  it("rejects exact House Help slots earlier than now before querying", async () => {
    const callCount = calls.length;
    await expect(
      househelpFindAction({
        duration: "60",
        exactSlot: "2026-04-20T07:00:00",
        json: true,
        noInteractive: true,
        window: "any",
      })
    ).rejects.toMatchObject({ code: "BOOKING_SLOT_IN_PAST" });
    expect(calls).toHaveLength(callCount);
  });

  it("renders House Help find output with safe next commands", async () => {
    const output = await househelpFindAction({
      date: "2026-04-20",
      duration: "60",
      exactDuration: true,
      window: "after-work",
    });

    expect(output).toContain("Book best");
    expect(output).toContain("househelp book");
    expect(output).toContain("--slot 2026-04-20T18:00:00");
    expect(output).toContain("Re-rank live");
    expect(output).toContain("--rank 1");
  });

  it("prepares House Help booking handoff without prompting in JSON no-interactive mode", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "60",
      json: true,
      noInteractive: true,
      slot: "20 Apr 2026 6pm",
      window: "after-work",
    });

    const setCartCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/v2"
    );
    expect(JSON.parse(setCartCall?.body ?? "{}")).toEqual({
      catalogInfo: { "27": 1 },
      isQuickAdd: false,
    });
    expect(JSON.parse(output)).toMatchObject({
      durationMinutes: 60,
      listingId: "27",
      listingItemId: "44",
      order: {
        orderId: "order-1",
        payCommand: "tranquilo checkout pay order-1",
      },
      payCommand: "tranquilo checkout pay order-1",
    });
  });

  it("prepares 90 minute House Help with the backend listing id, not the item id", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "90",
      json: true,
      noInteractive: true,
      slot: "20 Apr 2026 6pm",
      window: "after-work",
    });

    const setCartCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/v2"
    );
    expect(JSON.parse(setCartCall?.body ?? "{}")).toEqual({
      catalogInfo: { "28": 1 },
      isQuickAdd: false,
    });
    expect(JSON.parse(output)).toMatchObject({
      amount: 119,
      durationMinutes: 90,
      listingId: "28",
      listingItemId: "45",
      order: {
        selectedDurationMinutes: 90,
        selectedListingId: "28",
        selectedListingItemId: "45",
      },
    });
  });

  it("replaces stale cart duration when preparing 30 minute House Help", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "30",
      json: true,
      noInteractive: true,
      slot: "20 Apr 2026 6pm",
      window: "after-work",
    });

    const setCartCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/v2"
    );
    expect(JSON.parse(setCartCall?.body ?? "{}")).toEqual({
      catalogInfo: { "34": 1 },
      isQuickAdd: false,
    });
    expect(JSON.parse(output)).toMatchObject({
      amount: 39,
      durationMinutes: 30,
      listingId: "34",
      listingItemId: "51",
      order: {
        selectedDurationMinutes: 30,
        selectedListingId: "34",
        selectedListingItemId: "51",
      },
    });
  });

  it("prepares House Help booking from a ranked live result", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "60",
      json: true,
      noInteractive: true,
      rank: 1,
      window: "after-work",
    });

    const slotCalls = calls.filter(
      (call) =>
        call.method === "GET" &&
        new URL(call.url ?? "", baseUrl).pathname ===
          "/gateway/bookings/slots/by-skill"
    );
    expect(slotCalls).toHaveLength(2);
    expect(JSON.parse(output)).toMatchObject({
      durationMinutes: 60,
      selectedSlot: "2026-04-20T18:00:00",
    });
  });

  it("creates a House Help watch with the same explicit time window used for search", async () => {
    const output = await househelpWatchCreateAction({
      date: "2026-04-20",
      duration: "60",
      exactDuration: true,
      json: true,
      timeWindow: ["18:00-22:00"],
    });

    expect(JSON.parse(output)).toMatchObject({
      watch: {
        spec: {
          itemIds: ["27"],
          notifications: {
            desktop: true,
          },
          window: {
            from: "18:00",
            preset: "custom",
            to: "22:00",
          },
        },
      },
    });
  });

  it("creates a House Help watch with exact date and time filters persisted", async () => {
    const output = await househelpWatchCreateAction({
      duration: "60",
      exactDate: "2026-04-21",
      exactDuration: true,
      exactTime: "18:30",
      json: true,
      window: "after-work",
    });

    expect(JSON.parse(output)).toMatchObject({
      watch: {
        spec: {
          dateRange: {
            from: "2026-04-21",
            to: "2026-04-21",
          },
          itemIds: ["27"],
          window: {
            from: "18:30",
            preset: "custom",
            to: "18:30",
          },
        },
      },
    });
  });

  it("rejects unsupported House Help watch filters before searching slots", async () => {
    const slotCallCount = calls.filter(
      (call) =>
        call.method === "GET" &&
        new URL(call.url ?? "", baseUrl).pathname ===
          "/gateway/bookings/slots/by-skill"
    ).length;

    await expect(
      househelpWatchCreateAction({
        date: "2026-04-20",
        duration: "60",
        json: true,
        timeWindow: ["06:00-09:00", "18:00-22:00"],
      })
    ).rejects.toMatchObject({ code: "WATCH_TIME_WINDOW_UNSUPPORTED" });

    expect(
      calls.filter(
        (call) =>
          call.method === "GET" &&
          new URL(call.url ?? "", baseUrl).pathname ===
            "/gateway/bookings/slots/by-skill"
      )
    ).toHaveLength(slotCallCount);
  });

  it("creates a House Help watch with Slack notifications when requested", async () => {
    const output = await househelpWatchCreateAction({
      date: "2026-04-20",
      duration: "60",
      exactDuration: true,
      json: true,
      slackWebhookUrl: "https://hooks.slack.com/services/T/ABC/XYZ",
      timeWindow: ["18:00-22:00"],
    });

    expect(JSON.parse(output)).toMatchObject({
      watch: {
        spec: {
          itemIds: ["27"],
          notifications: {
            desktop: true,
            slackWebhookUrl: "https://hooks.slack.com/services/T/ABC/XYZ",
          },
        },
      },
    });
  });

  it("prints and polls QR payment by default for interactive House Help booking", async () => {
    const stdout = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    let output = "";
    try {
      output = await househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        intervalMs: 1,
        slot: "20 Apr 2026 6pm",
        timeoutMs: 5000,
        upiApp: "phonepe",
        window: "after-work",
        yes: true,
      });
    } finally {
      stdout.mockRestore();
    }

    expect(output).toContain("Status: CHARGED");
    expect(output).toContain("Booking: booking-1");
    expect(paymentStatusCalls).toBeGreaterThan(0);
  });

  it("can still prepare a human handoff when requested explicitly", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "60",
      handoff: true,
      slot: "20 Apr 2026 6pm",
      window: "after-work",
      yes: true,
    });

    expect(output).toContain("Checkout order-1 prepared");
    expect(output).toContain("tranquilo checkout pay order-1");
    expect(paymentStatusCalls).toBe(0);
  });

  it("can complete House Help booking payment from the book command", async () => {
    const output = await househelpBookAction({
      date: "2026-04-20",
      duration: "60",
      intervalMs: 1,
      json: true,
      noInteractive: true,
      pay: true,
      slot: "20 Apr 2026 6pm",
      timeoutMs: 5000,
      upiApp: "phonepe",
      window: "after-work",
    });

    expect(JSON.parse(output)).toMatchObject({
      booking: {
        durationMinutes: 60,
        order: { orderId: "order-1" },
      },
      payment: {
        paymentUri:
          "upi://pay?pa=cf.pronto@cashfree&pn=Pronto&tr=txn-1&am=158&cu=INR",
        status: {
          order: {
            bookingId: "booking-1",
            status: "confirmed",
          },
        },
      },
    });
  });

  it("rejects missing ranked House Help slots without prompting", async () => {
    await expect(
      househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        json: true,
        noInteractive: true,
        rank: 99,
        window: "after-work",
      })
    ).rejects.toMatchObject({ code: "SLOT_RANK_NOT_FOUND" });
  });

  it("requires slot input instead of prompting in JSON no-interactive mode", async () => {
    await expect(
      househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        json: true,
        noInteractive: true,
        window: "after-work",
      })
    ).rejects.toMatchObject({ code: "SLOT_REQUIRED" });
  });

  it("documents agent-safe House Help CLI fallback flags in command help", () => {
    const findResult = spawnSync(
      "bun",
      ["src/index.ts", "househelp", "find", "--help"],
      {
        cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        timeout: 15_000,
      }
    );

    expect(findResult.status).toBe(0);
    expect(findResult.stdout).toContain("--json");
    expect(findResult.stdout).toContain("--no-interactive");
    expect(findResult.stdout).toContain("--duration");

    const bookResult = spawnSync(
      "bun",
      ["src/index.ts", "househelp", "book", "--help"],
      {
        cwd: path.join(path.dirname(fileURLToPath(import.meta.url)), ".."),
        encoding: "utf8",
        timeout: 15_000,
      }
    );
    expect(bookResult.status).toBe(0);
    expect(bookResult.stdout).toContain("--rank");
    expect(bookResult.stdout).toContain("--pay");
  }, 20_000);

  it("lists addresses as normalized JSON", async () => {
    const output = await addressesListAction({ json: true });

    expect(JSON.parse(output)).toMatchObject({
      activeAddressId: "988639",
      addresses: [
        { id: "989392", label: "Gym" },
        { id: "988639", isActive: true, label: "Home" },
      ],
    });
  });

  it("shows one address and returns not found for missing ids", async () => {
    const output = await addressShowAction("989392", {});

    expect(output).toContain("Label: Gym");
    await expect(addressShowAction("missing", {})).rejects.toMatchObject({
      code: "ADDRESS_NOT_FOUND",
    });
  });

  it("sets the active delivery address with the captured cart patch", async () => {
    const output = await addressUseAction("989392", { json: true });

    const patchCall = calls.find(
      (call) =>
        call.method === "PATCH" &&
        new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart"
    );
    expect(JSON.parse(patchCall?.body ?? "{}")).toEqual({
      deliveryAddressId: "989392",
    });
    expect(JSON.parse(output)).toMatchObject({
      activeAddressId: "989392",
      address: { id: "989392", isActive: true },
    });
  });

  it("creates checkout, renders QR payment data, and finalizes after Juspay charge", async () => {
    const created = JSON.parse(
      await househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        handoff: true,
        json: true,
        noInteractive: true,
        slot: "2026-04-20T18:00:00",
        window: "after-work",
      })
    ) as { order: { orderId: string; payCommand: string } };

    expect(created.order).toMatchObject({
      orderId: "order-1",
      payCommand: "tranquilo checkout pay order-1",
    });

    const paid = JSON.parse(
      await checkoutPayAction(created.order.orderId, {
        intervalMs: 1,
        json: true,
        timeoutMs: 5000,
        upiApp: "phonepe",
      })
    );

    expect(paid).toMatchObject({
      paymentUri:
        "upi://pay?pa=cf.pronto@cashfree&pn=Pronto&tr=txn-1&am=158&cu=INR",
      source: "UPI_PAY",
      status: {
        order: {
          bookingId: "booking-1",
          status: "confirmed",
        },
      },
    });

    const txnCalls = calls.filter(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/wapi/txns"
    );
    expect(txnCalls).toHaveLength(1);
    const txnBody = new URLSearchParams(txnCalls[0]?.body ?? "");
    expect(txnBody.get("payment_method")).toBe("UPI_PAY");
    expect(txnBody.get("upi_app")).toBe("phonepe://pay");
  });

  it("requires and remembers the selected UPI app", async () => {
    await fsp.writeFile(
      path.join(tempDir, "checkout-orders.json"),
      `${JSON.stringify(
        {
          orders: [
            {
              addressId: "988639",
              amount: 79,
              bookingType: "SCHEDULED",
              cartVersion: 276,
              clientAuthToken: "client-auth-token",
              createdAt: "2026-04-20T11:30:00.000Z",
              customerId: "customer-1",
              merchantId: "pronto",
              orderId: "gpay-order",
              selectedDurationMinutes: 60,
              selectedListingId: "27",
              selectedListingItemId: "44",
              slot: "2026-04-21T13:00:00",
              status: "created",
              updatedAt: "2026-04-20T11:30:00.000Z",
            },
          ],
          version: 1,
        },
        null,
        2
      )}\n`
    );

    await expect(
      checkoutPayAction("gpay-order", { json: true, watch: false })
    ).rejects.toMatchObject({ code: "UPI_APP_REQUIRED" });

    const paid = JSON.parse(
      await checkoutPayAction("gpay-order", {
        json: true,
        upiApp: "googlepay",
        watch: false,
      })
    );

    expect(paid).toMatchObject({
      paymentUri:
        "upi://pay?pa=cf.pronto@cashfree&pn=Pronto&tr=txn-1&am=158&cu=INR",
      source: "UPI_PAY",
    });
    const txnCall = calls.find(
      (call) =>
        call.method === "POST" &&
        new URL(call.url ?? "", baseUrl).pathname === "/wapi/txns"
    );
    const txnBody = new URLSearchParams(txnCall?.body ?? "");
    expect(txnBody.get("payment_method")).toBe("UPI_PAY");
    expect(txnBody.get("upi_app")).toBe("tez://upi/pay");
    expect(
      JSON.parse(
        await fsp.readFile(
          path.join(tempDir, "payment-preferences.json"),
          "utf8"
        )
      )
    ).toMatchObject({ upiApp: "googlepay" });
  });

  it("refuses to create checkout beyond the real booking horizon", async () => {
    await expect(
      househelpBookAction({
        duration: "60",
        handoff: true,
        json: true,
        noInteractive: true,
        slot: "2026-04-24T09:30:00",
        window: "any",
      })
    ).rejects.toMatchObject({ code: "BOOKING_DATE_OUT_OF_RANGE" });

    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/checkout"
      )
    ).toBe(false);
  });

  it("refuses to create checkout for same-day slots earlier than now", async () => {
    await expect(
      househelpBookAction({
        duration: "60",
        handoff: true,
        json: true,
        noInteractive: true,
        slot: "2026-04-20T07:30:00",
        window: "any",
      })
    ).rejects.toMatchObject({ code: "BOOKING_SLOT_IN_PAST" });

    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/checkout"
      )
    ).toBe(false);
  });

  it("refuses to pay stale checkout orders beyond the real booking horizon", async () => {
    await fsp.writeFile(
      path.join(tempDir, "checkout-orders.json"),
      `${JSON.stringify(
        {
          orders: [
            {
              amount: 119,
              bookingType: "SCHEDULED",
              cartVersion: 276,
              clientAuthToken: "client-auth-token",
              createdAt: "2026-04-20T11:30:00.000Z",
              merchantId: "pronto",
              orderId: "stale-order",
              slot: "2026-04-24T07:30:00",
              status: "created",
              updatedAt: "2026-04-20T11:30:00.000Z",
            },
          ],
          version: 1,
        },
        null,
        2
      )}\n`
    );
    calls = [];

    await expect(
      checkoutPayAction("stale-order", {
        json: true,
        timeoutMs: 1,
        upiApp: "phonepe",
      })
    ).rejects.toMatchObject({ code: "BOOKING_DATE_OUT_OF_RANGE" });
    expect(calls).toHaveLength(0);
  });

  it("recreates a fresh checkout when Juspay refuses to reopen payment", async () => {
    await fsp.writeFile(
      path.join(tempDir, "checkout-orders.json"),
      `${JSON.stringify(
        {
          orders: [
            {
              addressId: "988639",
              amount: 79,
              bookingId: "old-booking",
              bookingType: "SCHEDULED",
              cartVersion: 276,
              clientAuthToken: "client-auth-token",
              createdAt: "2026-04-20T11:30:00.000Z",
              customerId: "customer-1",
              merchantId: "pronto",
              orderId: "retry-order",
              selectedDurationMinutes: 60,
              selectedListingId: "27",
              selectedListingItemId: "44",
              slot: "2026-04-21T13:00:00",
              status: "created",
              updatedAt: "2026-04-20T11:30:00.000Z",
            },
          ],
          version: 1,
        },
        null,
        2
      )}\n`
    );

    const paid = JSON.parse(
      await checkoutPayAction("retry-order", {
        intervalMs: 1,
        json: true,
        timeoutMs: 100,
        upiApp: "phonepe",
      })
    );

    expect(paid).toMatchObject({
      order: {
        orderId: "order-1",
        selectedDurationMinutes: 60,
        selectedListingId: "27",
      },
      replacedOrderId: "retry-order",
      status: { order: { status: "confirmed" } },
    });
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/checkout"
      )
    ).toBe(true);
  });

  it("uses the Juspay payment page URL when a raw UPI URI is unavailable", async () => {
    await fsp.writeFile(
      path.join(tempDir, "checkout-orders.json"),
      `${JSON.stringify(
        {
          orders: [
            {
              addressId: "988639",
              amount: 79,
              bookingType: "SCHEDULED",
              cartVersion: 276,
              clientAuthToken: "client-auth-token",
              createdAt: "2026-04-20T11:30:00.000Z",
              customerId: "customer-1",
              merchantId: "pronto",
              orderId: "page-order",
              selectedDurationMinutes: 60,
              selectedListingId: "27",
              selectedListingItemId: "44",
              slot: "2026-04-21T13:00:00",
              status: "created",
              updatedAt: "2026-04-20T11:30:00.000Z",
            },
          ],
          version: 1,
        },
        null,
        2
      )}\n`
    );

    const paid = JSON.parse(
      await checkoutPayAction("page-order", {
        json: true,
        upiApp: "phonepe",
        watch: false,
      })
    );

    expect(paid).toMatchObject({
      paymentUri:
        "https://api.juspay.in/v2/pay/start/pronto/txn-page?cardIssuerBankName=UPI_PAY&cardType=UPI&paymentMethod=UPI_PAY&paymentMethodType=UPI",
      source: "PAYMENT_PAGE",
    });
    expect(
      calls.some((call) => {
        if (
          call.method !== "POST" ||
          new URL(call.url ?? "", baseUrl).pathname !== "/wapi/txns"
        ) {
          return false;
        }
        const body = new URLSearchParams(call.body);
        return (
          body.get("order_id") === "page-order" &&
          body.get("payment_method") === "UPI_PAY" &&
          body.get("upi_app") === "phonepe://pay"
        );
      })
    ).toBe(true);
  });

  it("recovers a payment page URL from Juspay status when retry is blocked", async () => {
    await fsp.writeFile(
      path.join(tempDir, "checkout-orders.json"),
      `${JSON.stringify(
        {
          orders: [
            {
              addressId: "988639",
              amount: 79,
              bookingType: "SCHEDULED",
              cartVersion: 276,
              clientAuthToken: "client-auth-token",
              createdAt: "2026-04-20T11:30:00.000Z",
              customerId: "customer-1",
              merchantId: "pronto",
              orderId: "status-page-order",
              selectedDurationMinutes: 60,
              selectedListingId: "27",
              selectedListingItemId: "44",
              slot: "2026-04-21T13:00:00",
              status: "created",
              updatedAt: "2026-04-20T11:30:00.000Z",
            },
          ],
          version: 1,
        },
        null,
        2
      )}\n`
    );

    const paid = JSON.parse(
      await checkoutPayAction("status-page-order", {
        json: true,
        upiApp: "phonepe",
        watch: false,
      })
    );

    expect(paid).toMatchObject({
      paymentUri:
        "https://api.juspay.in/v2/pay/start/pronto/statusTxn?cardIssuerBankName=UPI_PAY&cardType=UPI&paymentMethod=UPI_PAY&paymentMethodType=UPI",
      source: "PAYMENT_PAGE",
    });
    expect(
      calls.some(
        (call) =>
          call.method === "POST" &&
          new URL(call.url ?? "", baseUrl).pathname === "/gateway/cart/checkout"
      )
    ).toBe(false);
  });

  it("renders QR payment instructions before polling when watch is disabled", async () => {
    const created = JSON.parse(
      await househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        handoff: true,
        json: true,
        noInteractive: true,
        slot: "2026-04-20T18:00:00",
        window: "after-work",
      })
    ) as { order: { orderId: string } };
    paymentStatusCalls = 0;

    const output = await checkoutPayAction(created.order.orderId, {
      upiApp: "phonepe",
      watch: false,
    });

    expect(output).toContain("Order: order-1");
    expect(output).toContain("Payment: UPI_PAY");
    expect(output).toContain("QR image:");
    expect(output).toContain("Status: not watched");
    expect(paymentStatusCalls).toBe(0);
  });

  it("opens the saved QR image when requested", async () => {
    const created = JSON.parse(
      await househelpBookAction({
        date: "2026-04-20",
        duration: "60",
        handoff: true,
        json: true,
        noInteractive: true,
        slot: "2026-04-20T18:00:00",
        window: "after-work",
      })
    ) as { order: { orderId: string } };
    const qrPath = path.join(tempDir, "payment.png");

    const output = await checkoutPayAction(created.order.orderId, {
      openQr: true,
      saveQr: qrPath,
      upiApp: "phonepe",
      watch: false,
    });

    expect(output).toContain("Opened QR image in the OS image viewer.");
    expect(fs.existsSync(qrPath)).toBe(true);
    expect(open).toHaveBeenCalledWith(qrPath);
    expect(paymentStatusCalls).toBe(0);
  });

  it("renders terminal QR through the standard qrcode renderer", async () => {
    const paymentUri =
      "upi://pay?pa=cf.pronto@cashfree&pn=Pronto&tr=txn-1&am=158&cu=INR";
    const compact = await terminalQr(paymentUri, "compact");

    expect(compact).toContain("\u001B[");
    expect(compact).not.toContain("�");
    expect(compact).not.toMatch(CUSTOM_QUADRANT_QR_PATTERN);
  });
});
