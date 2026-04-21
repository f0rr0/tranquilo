import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Temporal } from "@js-temporal/polyfill";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createSlotWatch,
  listSlotWatches,
  nextRunAtForWatch,
  resolveDateRange,
  resolveWindow,
  runDueSlotWatches,
  type SlotWatch,
  schedulerFiles,
  slotMatchesWatch,
} from "../src/slot-watch";
import { extractActionableSlots } from "../src/slots";

interface ServerCall {
  method?: string | undefined;
  url?: string | undefined;
}

async function readBody(req: IncomingMessage): Promise<void> {
  for await (const _chunk of req) {
    // drain request bodies
  }
}

function jsonResponse(res: ServerResponse, payload: unknown): void {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(payload));
}

describe("slot watch planning helpers", () => {
  const now = Temporal.Instant.from("2026-04-20T08:00:00Z");

  it("resolves default date presets and custom windows", () => {
    expect(resolveDateRange({}, "UTC", now)).toEqual({
      from: "2026-04-20",
      preset: "next-4-days",
      to: "2026-04-23",
    });
    expect(resolveDateRange({ preset: "tomorrow" }, "UTC", now)).toEqual({
      from: "2026-04-21",
      preset: "tomorrow",
      to: "2026-04-21",
    });
    expect(resolveWindow({ from: "18:30", to: "21:00" })).toEqual({
      from: "18:30",
      preset: "custom",
      to: "21:00",
    });
    expect(() => resolveDateRange({ date: "2026-04-24" }, "UTC", now)).toThrow(
      "only be watched"
    );
  });

  it("filters only open slots inside the watch date and time window", () => {
    const watch: SlotWatch = {
      createdAt: "2026-04-20T08:00:00Z",
      id: "sw_test",
      runCount: 0,
      spec: {
        bookingType: "SCHEDULED",
        dateRange: { from: "2026-04-20", to: "2026-04-20" },
        itemIds: [],
        location: { addressId: "a1", source: "address" },
        timezone: "UTC",
        window: { preset: "after-work" },
      },
      status: "enabled",
      updatedAt: "2026-04-20T08:00:00Z",
    };

    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          startTime: "2026-04-20T18:30:00",
        },
        watch,
        now
      )
    ).toBe(true);
    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: true,
          startTime: "2026-04-20T18:30:00",
        },
        watch,
        now
      )
    ).toBe(false);
    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          slotsLeft: 0,
          startTime: "2026-04-20T18:30:00",
        },
        watch,
        now
      )
    ).toBe(false);
    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          startTime: "2026-04-20T10:30:00",
        },
        watch,
        now
      )
    ).toBe(false);
    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          startTime: "2026-04-20T07:30:00",
        },
        watch,
        now
      )
    ).toBe(false);
  });

  it("extracts actionable item-aware slots from captured slotGroups shape", () => {
    expect(
      extractActionableSlots({
        slotGroups: [
          {
            listingIds: [34, 27],
            skillId: 1,
            skillName: "HOUSE_HELP",
            slots: [
              {
                isFull: true,
                slotsLeft: 0,
                startTime: "2026-04-20T18:00:00",
              },
              {
                isFull: false,
                slotsLeft: 1,
                startTime: "2026-04-20T18:30:00",
              },
            ],
          },
        ],
      })
    ).toEqual([
      expect.objectContaining({
        group: expect.objectContaining({
          listingIds: [34, 27],
          skillName: "HOUSE_HELP",
        }),
        startTime: "2026-04-20T18:30:00",
      }),
    ]);
  });

  it("uses smart weekday and weekend windows", () => {
    const watch: SlotWatch = {
      createdAt: "2026-04-20T08:00:00Z",
      id: "sw_smart",
      runCount: 0,
      spec: {
        bookingType: "SCHEDULED",
        dateRange: { from: "2026-04-25", to: "2026-04-26" },
        itemIds: [],
        location: { addressId: "a1", source: "address" },
        timezone: "UTC",
        window: { preset: "smart" },
      },
      status: "enabled",
      updatedAt: "2026-04-20T08:00:00Z",
    };

    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          startTime: "2026-04-25T10:00:00",
        },
        watch,
        now
      )
    ).toBe(true);
    expect(
      slotMatchesWatch(
        {
          isExperiencingSurge: false,
          isFull: false,
          startTime: "2026-04-25T08:00:00",
        },
        watch,
        now
      )
    ).toBe(false);
  });

  it("calculates adaptive next run times", () => {
    const watch: SlotWatch = {
      createdAt: "2026-04-20T08:00:00Z",
      id: "sw_1000",
      runCount: 0,
      spec: {
        bookingType: "SCHEDULED",
        dateRange: { from: "2026-04-25", to: "2026-04-25" },
        itemIds: [],
        location: { addressId: "a1", source: "address" },
        timezone: "UTC",
        window: { preset: "after-work" },
      },
      status: "enabled",
      updatedAt: "2026-04-20T08:00:00Z",
    };

    expect(nextRunAtForWatch(watch, now)).toBe("2026-04-20T08:01:00Z");
  });

  it("generates OS scheduler files without installing them", () => {
    const files = schedulerFiles({
      args: [],
      command: "/usr/local/bin/tranquilo",
    });

    expect(files.launchdPlist).toContain("StartInterval");
    expect(files.launchdPlist).toContain("<integer>60</integer>");
    expect(files.linuxTimer).toContain("OnUnitActiveSec=1min");
    expect(files.linuxService).toContain(
      "/usr/local/bin/tranquilo househelp watch run-due"
    );
    expect(files.runnerScript).toContain(
      "exec /usr/local/bin/tranquilo househelp watch run-due"
    );
    expect(files.windowsCommand).toBe(
      "/usr/local/bin/tranquilo househelp watch run-due"
    );
  });
});

describe("slot watch run-due integration", () => {
  const now = Temporal.Instant.from("2026-04-20T08:00:00Z");
  let server: http.Server;
  let baseUrl: string;
  let calls: ServerCall[];
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(async () => {
    calls = [];
    originalEnv = { ...process.env };
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "tranquilo-watch-"));
    process.env.TRANQUILO_STATE_DIR = tempDir;
    process.env.TRANQUILO_CONFIG_DIR = tempDir;
    process.env.TRANQUILO_TOKEN = "test-token";

    server = http.createServer(async (req, res) => {
      await readBody(req);
      calls.push({ method: req.method, url: req.url });
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (url.pathname === "/gateway/users/addresses") {
        jsonResponse(res, {
          data: {
            data: [
              {
                id: "a1",
                latitude: 28.42,
                longitude: 77.05,
                default: true,
              },
            ],
          },
          status: "OK",
        });
        return;
      }
      if (req.method === "GET" && url.pathname === "/gateway/cart/v2") {
        jsonResponse(res, {
          data: {
            cart: {
              amountPayable: 79,
              deliveryAddress: {
                id: "a1",
                latitude: 28.42,
                longitude: 77.05,
              },
              items: [
                {
                  catalog: { id: "44", listingId: "44" },
                  listingItemId: "item-44",
                  quantity: 1,
                },
              ],
              version: 276,
            },
          },
          status: "OK",
        });
        return;
      }
      if (url.pathname === "/gateway/location/availability") {
        jsonResponse(res, {
          data: {
            serviceable: "SERVICEABLE",
            serviceableBookingTypes: ["SCHEDULED"],
          },
          status: "OK",
        });
        return;
      }
      if (req.method === "PATCH" && url.pathname === "/gateway/cart") {
        jsonResponse(res, { data: { cart: { id: "cart-1" } }, status: "OK" });
        return;
      }
      if (req.method === "POST" && url.pathname === "/gateway/cart/v2") {
        jsonResponse(res, {
          data: {
            cart: {
              amountPayable: 79,
              items: [
                {
                  catalog: { id: "44", listingId: "44" },
                  listingItemId: "item-44",
                  quantity: 1,
                },
              ],
              version: 276,
            },
          },
          status: "OK",
        });
        return;
      }
      if (req.method === "POST" && url.pathname === "/gateway/cart/checkout") {
        jsonResponse(res, {
          data: {
            bookingId: "booking-1",
            orderId: "order-1",
            sdkPayload: {
              payload: {
                amount: 79,
                clientAuthToken: "client-auth-token",
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
      if (url.pathname === "/gateway/bookings/slots/by-skill") {
        jsonResponse(res, {
          data: {
            slots: [
              {
                startTime: "2026-04-20T18:00:00",
                endTime: "2026-04-20T18:30:00",
                isFull: true,
                isExperiencingSurge: false,
                slotsLeft: 0,
              },
              {
                startTime: "2026-04-20T18:30:00",
                endTime: "2026-04-20T19:00:00",
                isFull: false,
                isExperiencingSurge: true,
                surgePrice: 25,
                slotsLeft: 1,
              },
            ],
          },
          status: "OK",
        });
        return;
      }
      jsonResponse(res, { data: {}, status: "OK" });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve)
    );
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("mock server did not bind to a port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
    process.env.TRANQUILO_BASE_URL = baseUrl;
  });

  afterEach(async () => {
    process.env = originalEnv;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await fs.rm(tempDir, { force: true, recursive: true });
  });

  it("skips future watches without making API calls", async () => {
    await createSlotWatch(
      {
        addressId: "a1",
        date: "2026-04-20",
        item: ["44"],
        timeWindow: "after-work",
        timezone: "UTC",
      },
      now
    );

    calls = [];
    const result = await runDueSlotWatches({ now, notify: false });

    expect(result).toMatchObject({ checked: 0, found: [], skipped: 1 });
    expect(calls).toEqual([]);
  });

  it("marks the watch found on the first matching open slot", async () => {
    const watch = await createSlotWatch(
      {
        addressId: "a1",
        date: "2026-04-20",
        item: ["44"],
        name: "After work",
        timeWindow: "after-work",
        timezone: "UTC",
      },
      now
    );

    const result = await runDueSlotWatches({
      force: true,
      now,
      notify: false,
      watchId: watch.id,
    });

    expect(result.found).toEqual([
      {
        id: watch.id,
        match: expect.objectContaining({
          actionCommand: `tranquilo househelp watch book ${watch.id}`,
          actionHint: expect.stringContaining(`book watch ${watch.id}`),
          startTime: "2026-04-20T18:30:00",
          slotsLeft: 1,
          surgePrice: 25,
        }),
      },
    ]);
    const store = JSON.parse(
      await fs.readFile(path.join(tempDir, "slot-watches.json"), "utf8")
    ) as { watches: SlotWatch[] };
    expect(store.watches[0]).toMatchObject({
      status: "found",
      foundMatch: { startTime: "2026-04-20T18:30:00" },
    });
    expect(
      calls.map((call) => new URL(call.url ?? "", baseUrl).pathname)
    ).toEqual(["/gateway/users/addresses", "/gateway/bookings/slots/by-skill"]);
  });

  it("does not create checkout from watches, including legacy checkout watches", async () => {
    const watch = await createSlotWatch(
      {
        addressId: "a1",
        date: "2026-04-20",
        item: ["44"],
        timeWindow: "after-work",
        timezone: "UTC",
      },
      now
    );

    const result = await runDueSlotWatches({
      force: true,
      now,
      notify: false,
      watchId: watch.id,
    });

    expect(result.found[0]?.match).toMatchObject({
      actionCommand: `tranquilo househelp watch book ${watch.id}`,
      startTime: "2026-04-20T18:30:00",
    });
    expect(
      calls.map(
        (call) => `${call.method} ${new URL(call.url ?? "", baseUrl).pathname}`
      )
    ).not.toContain("POST /gateway/cart/checkout");
  });

  it("strips legacy checkout-on-found state from loaded watches", async () => {
    await fs.writeFile(
      path.join(tempDir, "slot-watches.json"),
      `${JSON.stringify(
        {
          version: 1,
          watches: [
            {
              createdAt: "2026-04-20T08:00:00Z",
              foundMatch: {
                checkoutCommand: "tranquilo checkout pay order-1",
                checkoutOrderId: "order-1",
                checkoutPayCommand: "tranquilo checkout pay order-1",
                checkoutStatus: "created",
                endTime: "2026-04-20T19:00:00",
                isExperiencingSurge: false,
                slotsLeft: 1,
                startTime: "2026-04-20T18:30:00",
              },
              id: "sw_legacy",
              runCount: 1,
              spec: {
                bookingType: "SCHEDULED",
                dateRange: { from: "2026-04-20", to: "2026-04-20" },
                itemIds: ["44"],
                location: { addressId: "a1", source: "address" },
                onFound: "checkout",
                timezone: "UTC",
                window: { preset: "after-work" },
              },
              status: "found",
              updatedAt: "2026-04-20T08:00:00Z",
            },
          ],
        },
        null,
        2
      )}\n`
    );

    const [watch] = await listSlotWatches();

    expect(watch?.spec).not.toHaveProperty("onFound");
    expect(watch?.foundMatch).toEqual({
      actionCommand: undefined,
      actionHint: undefined,
      endTime: "2026-04-20T19:00:00",
      isExperiencingSurge: false,
      slotsLeft: 1,
      startTime: "2026-04-20T18:30:00",
      surgePrice: undefined,
    });
  });

  it("sends Slack webhook notifications without desktop notification", async () => {
    const originalFetch = globalThis.fetch;
    let slackPayload: unknown;
    globalThis.fetch = ((...args: Parameters<typeof fetch>) => {
      const [input, init] = args;
      if (String(input).startsWith("https://hooks.slack.com/")) {
        slackPayload = JSON.parse(String(init?.body));
        return Promise.resolve(new Response("ok", { status: 200 }));
      }
      return originalFetch(...args);
    }) as typeof fetch;
    try {
      const watch = await createSlotWatch(
        {
          addressId: "a1",
          date: "2026-04-20",
          desktopNotify: false,
          item: ["44"],
          slackWebhookUrl: "https://hooks.slack.com/services/T/ABC/XYZ",
          timeWindow: "after-work",
          timezone: "UTC",
        },
        now
      );

      await runDueSlotWatches({
        force: true,
        now,
        watchId: watch.id,
      });

      expect(slackPayload).toMatchObject({
        text: expect.stringContaining("Tranquilo slot found"),
      });
      expect(JSON.stringify(slackPayload)).toContain(watch.id);
      expect(JSON.stringify(slackPayload)).not.toContain(
        "tranquilo checkout pay"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("snapshots active cart address when watch location is omitted", async () => {
    const watch = await createSlotWatch(
      {
        date: "2026-04-20",
        item: ["44"],
        timeWindow: "after-work",
        timezone: "UTC",
      },
      now
    );

    expect(watch.spec.location).toEqual({ addressId: "a1", source: "address" });
    expect(
      calls.map((call) => new URL(call.url ?? "", baseUrl).pathname)
    ).toEqual(["/gateway/cart/v2"]);
  });

  it("returns locked without API calls when another runner is active", async () => {
    await fs.writeFile(path.join(tempDir, "slot-watch.lock"), "");
    await createSlotWatch(
      {
        addressId: "a1",
        date: "2026-04-20",
        item: ["44"],
        timeWindow: "after-work",
        timezone: "UTC",
      },
      now
    );

    calls = [];
    const result = await runDueSlotWatches({ force: true, now, notify: false });

    expect(result).toEqual({
      checked: 0,
      errors: 0,
      found: [],
      locked: true,
      skipped: 0,
    });
    expect(calls).toEqual([]);
  });

  it("expires past watches without hitting the API", async () => {
    const expiredWatch: SlotWatch = {
      createdAt: "2026-04-19T08:00:00Z",
      id: "sw_expired",
      runCount: 0,
      spec: {
        bookingType: "SCHEDULED",
        dateRange: { from: "2026-04-19", to: "2026-04-19" },
        itemIds: ["44"],
        location: { addressId: "a1", source: "address" },
        timezone: "UTC",
        window: { preset: "after-work" },
      },
      status: "enabled",
      updatedAt: "2026-04-19T08:00:00Z",
    };
    await fs.writeFile(
      path.join(tempDir, "slot-watches.json"),
      JSON.stringify({ version: 1, watches: [expiredWatch] })
    );

    calls = [];
    const result = await runDueSlotWatches({ now, notify: false });
    const store = JSON.parse(
      await fs.readFile(path.join(tempDir, "slot-watches.json"), "utf8")
    ) as { watches: SlotWatch[] };

    expect(result).toMatchObject({ checked: 0, found: [], skipped: 0 });
    expect(store.watches[0]?.status).toBe("expired");
    expect(calls).toEqual([]);
  });

  it("errors when run-now targets a missing watch", async () => {
    await expect(
      runDueSlotWatches({
        force: true,
        now,
        notify: false,
        watchId: "missing",
      })
    ).rejects.toMatchObject({ code: "SLOT_WATCH_NOT_FOUND" });
  });
});
