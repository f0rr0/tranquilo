import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import {
  type AddressesListInput,
  type AddressShowInput,
  type AddressUseInput,
  AGENT_CATALOG,
  AgentPromptSchemas,
  type AuthLoginStartInput,
  type AuthLoginVerifyInput,
  type BookingsListInput,
  type HousehelpFindInput,
  type HousehelpOptionsInput,
  type HousehelpPaymentHandoffInput,
  type HousehelpPrepareBookingInput,
  type HousehelpWatchCreateInput,
  type IdOnlyInput,
  type McpToolName,
  toolByName,
} from "@tranquilo/cli-model/agent-catalog";
import { PACKAGE_METADATA } from "@tranquilo/cli-model/release-metadata";
import { activeAddressIdFromCart, normalizeAddresses } from "./address";
import { TranquiloClient } from "./api";
import { saveVerifiedLogin, tokenFromLoginStart } from "./auth";
import { ensureConfig, loadConfig } from "./config";
import { createClient, errorToJson, resolveLocation } from "./context";
import {
  findHousehelpSlots,
  househelpPaymentHandoff,
  prepareHousehelpBooking,
  resolveHousehelpOptions,
  slotWatchWindowFromHousehelpInput,
} from "./househelp";
import {
  createLoginSession,
  deleteLoginSession,
  getLoginSession,
} from "./login-session";
import { assertScheduledServiceable } from "./serviceability";
import {
  createSlotWatch,
  deleteSlotWatch,
  getSlotWatch,
  listSlotWatches,
  pauseSlotWatch,
  resumeSlotWatch,
  runDueSlotWatches,
} from "./slot-watch";
import { loadCredentials } from "./storage";
import type { BookingStatusPreset, JsonObject } from "./types";
import { TranquiloError } from "./types";

function dataOf(payload: JsonObject): unknown {
  return payload.data ?? payload;
}

function structured(data: unknown): Record<string, unknown> {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { data };
}

function toolOk(data: unknown, message?: string) {
  return {
    content: message ? [{ type: "text" as const, text: message }] : [],
    structuredContent: structured(data),
  };
}

function toolError(error: unknown) {
  return {
    isError: true,
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    structuredContent: structured(errorToJson(error)),
  };
}

async function runTool<T>(fn: () => Promise<T>, message?: string) {
  try {
    return toolOk(await fn(), message);
  } catch (error) {
    return toolError(error);
  }
}

function toolConfig(name: McpToolName) {
  const tool = toolByName(name);
  return {
    title: tool.title,
    description: tool.description,
    inputSchema: tool.schema,
    annotations: tool.annotations,
  };
}

/** @internal White-box tested MCP server factory. */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: PACKAGE_METADATA.name,
    version: PACKAGE_METADATA.version,
  });

  server.registerTool("auth_status", toolConfig("auth_status"), async () =>
    runTool(async () => {
      const [config, credentials] = await Promise.all([
        loadConfig(),
        loadCredentials(),
      ]);
      return {
        authenticated: Boolean(credentials?.accessToken),
        userId: credentials?.userId,
        mobileNumber: credentials?.mobileNumber,
        savedAt: credentials?.savedAt,
        config,
        loginHint: credentials?.accessToken
          ? undefined
          : AGENT_CATALOG.loginHint,
      };
    })
  );

  server.registerTool(
    "auth_login_start",
    toolConfig("auth_login_start"),
    async (args: AuthLoginStartInput) =>
      runTool(async () => {
        const mobileNumber = args.mobileNumber.trim();
        if (!mobileNumber) {
          throw new TranquiloError("Phone number is required.", {
            code: "LOGIN_INPUT_REQUIRED",
          });
        }
        const client = new TranquiloClient(await ensureConfig(), null);
        const token = tokenFromLoginStart(
          await client.loginStart(mobileNumber)
        );
        const session = await createLoginSession({
          token,
          mobileNumber,
        });
        return {
          ...session,
          nextAction:
            "Ask the user for the Pronto OTP they received, then call auth_login_verify with loginSessionId and otp.",
        };
      }, "OTP sent by Pronto.")
  );

  server.registerTool(
    "auth_login_verify",
    toolConfig("auth_login_verify"),
    async (args: AuthLoginVerifyInput) =>
      runTool(async () => {
        const session = await getLoginSession(args.loginSessionId);
        const client = new TranquiloClient(await ensureConfig(), null);
        const verified = await client.verifyLogin({
          token: session.token,
          idtoken: args.otp.trim(),
          mobileNumber: session.mobileNumber,
        });
        await deleteLoginSession(args.loginSessionId);
        const { credentials, storage } = await saveVerifiedLogin(
          verified,
          session.mobileNumber
        );
        return {
          authenticated: true,
          mobileNumber: credentials.mobileNumber,
          savedAt: credentials.savedAt,
          storage,
          userId: credentials.userId,
        };
      }, "Logged in to Pronto.")
  );

  server.registerTool(
    "addresses_list",
    toolConfig("addresses_list"),
    async (args: AddressesListInput) =>
      runTool(async () => {
        const client = await createClient();
        const raw = await client.addresses();
        const activeAddressId =
          args.includeActive === false
            ? undefined
            : activeAddressIdFromCart(await client.cart());
        return {
          activeAddressId,
          addresses: normalizeAddresses(raw, activeAddressId),
        };
      })
  );

  server.registerTool(
    "address_show",
    toolConfig("address_show"),
    async (args: AddressShowInput) =>
      runTool(async () => {
        const client = await createClient();
        const raw = await client.addresses();
        const activeAddressId =
          args.includeActive === false
            ? undefined
            : activeAddressIdFromCart(await client.cart());
        const address = normalizeAddresses(raw, activeAddressId).find(
          (candidate) => candidate.id === args.addressId
        );
        if (!address) {
          throw new Error(`Address ${args.addressId} was not found.`);
        }
        return { address };
      })
  );

  server.registerTool(
    "address_use",
    toolConfig("address_use"),
    async (args: AddressUseInput) =>
      runTool(async () => {
        const client = await createClient();
        const raw = await client.addresses();
        const address = normalizeAddresses(raw).find(
          (candidate) => candidate.id === args.addressId
        );
        if (!address) {
          throw new Error(`Address ${args.addressId} was not found.`);
        }
        const result = await client.setDeliveryAddress(args.addressId);
        return {
          activeAddressId: activeAddressIdFromCart(result) ?? args.addressId,
          address: { ...address, isActive: true },
          result: dataOf(result),
        };
      }, "Active delivery address updated.")
  );

  server.registerTool(
    "househelp_options",
    toolConfig("househelp_options"),
    async (args: HousehelpOptionsInput) =>
      runTool(async () => {
        const client = await createClient();
        const location = await resolveLocation(client, args);
        const serviceability = await assertScheduledServiceable(
          client,
          location
        );
        return {
          location,
          options: await resolveHousehelpOptions(client, location),
          serviceableBookingTypes: serviceability.serviceableBookingTypes,
        };
      })
  );

  server.registerTool(
    "househelp_find_slots",
    toolConfig("househelp_find_slots"),
    async (args: HousehelpFindInput) =>
      runTool(async () => {
        const result = await findHousehelpSlots(args);
        return args.limit
          ? { ...result, slots: result.slots.slice(0, args.limit) }
          : result;
      })
  );

  server.registerTool(
    "househelp_prepare_booking",
    toolConfig("househelp_prepare_booking"),
    async (args: HousehelpPrepareBookingInput) =>
      runTool(async () =>
        prepareHousehelpBooking({ ...args, noInteractive: true })
      )
  );

  server.registerTool(
    "househelp_payment_handoff",
    toolConfig("househelp_payment_handoff"),
    async (args: HousehelpPaymentHandoffInput) =>
      runTool(async () => househelpPaymentHandoff(args.orderId))
  );

  server.registerTool(
    "bookings_list",
    toolConfig("bookings_list"),
    async (args: BookingsListInput) =>
      runTool(async () => {
        const client = await createClient();
        return dataOf(
          await client.bookings(args.status as BookingStatusPreset, args.page)
        );
      })
  );

  server.registerTool(
    "househelp_watch_create",
    toolConfig("househelp_watch_create"),
    async (args: HousehelpWatchCreateInput) =>
      runTool(async () => {
        const resolved = await findHousehelpSlots(args);
        return {
          watch: await createSlotWatch({
            addressId: resolved.location.addressId,
            date: args.date,
            ...slotWatchWindowFromHousehelpInput(args),
            fromDate: args.fromDate,
            item: resolved.queryListingIds,
            lat: resolved.location.addressId
              ? undefined
              : resolved.location.lat,
            lng: resolved.location.addressId
              ? undefined
              : resolved.location.lng,
            name: args.name,
            desktopNotify: args.desktopNotify,
            preset: args.preset,
            slackWebhookUrl: args.slackWebhookUrl,
            toDate: args.toDate,
          }),
        };
      }, "House Help watch created.")
  );

  server.registerTool(
    "househelp_watch_list",
    toolConfig("househelp_watch_list"),
    async () => runTool(async () => ({ watches: await listSlotWatches() }))
  );

  server.registerTool(
    "househelp_watch_show",
    toolConfig("househelp_watch_show"),
    async (args: IdOnlyInput) =>
      runTool(async () => ({ watch: await getSlotWatch(args.id) }))
  );

  server.registerTool(
    "househelp_watch_pause",
    toolConfig("househelp_watch_pause"),
    async (args: IdOnlyInput) =>
      runTool(async () => ({ watch: await pauseSlotWatch(args.id) }))
  );

  server.registerTool(
    "househelp_watch_resume",
    toolConfig("househelp_watch_resume"),
    async (args: IdOnlyInput) =>
      runTool(async () => ({ watch: await resumeSlotWatch(args.id) }))
  );

  server.registerTool(
    "househelp_watch_delete",
    toolConfig("househelp_watch_delete"),
    async (args: IdOnlyInput) => runTool(async () => deleteSlotWatch(args.id))
  );

  server.registerTool(
    "househelp_watch_run_now",
    toolConfig("househelp_watch_run_now"),
    async (args: IdOnlyInput) =>
      runTool(async () => runDueSlotWatches({ force: true, watchId: args.id }))
  );

  server.registerPrompt(
    "find_househelp_slots",
    {
      title: "Find Maid / House Help slots",
      description:
        "Find ranked maid, cleaner, or House Help slots from natural language, including terse requests like 'keep looking for 1 hour slots after 6pm'. If no match is found, create a notify-only watch and tell the user how to book from the found watch later. Tranquilo is the wrapper; Pronto is the app users see.",
      argsSchema: AgentPromptSchemas.findHousehelpSlots,
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "This prompt handles user requests like 'find a maid tomorrow', 'book house help after work', 'need a cleaner this weekend', or 'get me a 60 minute maid slot'.",
              "Also handle terse requests like 'scan for slots', 'keep looking for 1 hour slots', or 'book any you find after 6pm': 1 hour means duration 60 unless the user says for the next hour, upcoming days means next-4-days, after 6pm means timeWindow 18:00-22:00, and any/first means earliest ranked acceptable match.",
              "Tranquilo is the local CLI/MCP wrapper around Pronto; when mentioning the mobile app or pending bookings to the user, say Pronto app, never Tranquilo app.",
              "First call auth_status. If unauthenticated, ask for the user's phone number, call auth_login_start, ask for the Pronto OTP, then call auth_login_verify before continuing.",
              args.naturalRequest
                ? `User request: ${args.naturalRequest}.`
                : "",
              "Use househelp_find_slots to find ranked House Help slots.",
              "If the user said scan or keep looking, do an immediate find first; if nothing matches, create househelp_watch_create. Watches are notify-only and must not create checkout automatically.",
              "When showing results, include each slot rank, startTime, duration, price, and address source.",
              args.duration
                ? `Preferred duration: ${args.duration}.`
                : "If no duration is provided, show the backend-supported options and ask for a preference.",
              args.addressId
                ? `Use saved address id ${args.addressId}.`
                : "Use the active cart delivery address if available.",
              "Map natural time language before calling tools: tomorrow -> preset tomorrow; after work/evening -> window after-work; before work/morning -> window before-work; weekend -> preset weekend only if it is within today plus 3 days.",
              "Never offer slots outside the valid booking horizon: today, tomorrow, and the next two days.",
              `Use preset ${(args.preset as string | undefined) ?? "next-4-days"} and window ${(args.window as string) ?? "smart"} unless the user asked for exact dates or times.`,
            ].join(" "),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "list_bookings",
    {
      title: "List bookings",
      description: "List upcoming, past, or all Tranquilo bookings.",
      argsSchema: AgentPromptSchemas.listBookings,
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use the Tranquilo bookings_list tool with status ${(args.status as string | undefined) ?? "upcoming"}.`,
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "watch_after_work_slots",
    {
      title: "Watch after-work maid slots",
      description:
        "Create an autopilot watch for after-work maid/house-help slots this week. Use for terse requests like 'keep looking for 1 hour slots after 6pm' when the immediate search has no match.",
      argsSchema: AgentPromptSchemas.watchAfterWorkSlots,
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "First call auth_status. If unauthenticated, ask for the user's phone number, call auth_login_start, ask for the Pronto OTP, then call auth_login_verify before continuing.",
              "Use househelp_watch_create to watch for after-work House Help slots this week.",
              "Watches are notify-only. If a slot is found later, tell the user to run or ask for the watch booking flow locally.",
              "Use preset next-4-days and window after-work.",
              args.addressId
                ? `Use saved address id ${args.addressId}.`
                : "If no address is provided, use the active cart delivery address.",
              args.duration
                ? `Preferred duration: ${args.duration}.`
                : "If no duration is provided, watch all backend-supported House Help durations.",
            ].join(" "),
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "show_slot_watches",
    {
      title: "Show slot watches",
      description: "Show the user's active Tranquilo slot watches.",
      argsSchema: AgentPromptSchemas.showSlotWatches,
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: "Use househelp_watch_list and summarize active, found, paused, and expired House Help watches.",
          },
        },
      ],
    })
  );

  server.registerPrompt(
    "prepare_slot_payment",
    {
      title: "Prepare Maid / House Help payment handoff",
      description:
        "Prepare a maid/house-help checkout and local QR payment handoff for a selected slot. Tranquilo is the wrapper; Pronto is the app users see.",
      argsSchema: AgentPromptSchemas.prepareSlotPayment,
    },
    (args) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "First call auth_status. If unauthenticated, ask for the user's phone number, call auth_login_start, ask for the Pronto OTP, then call auth_login_verify before continuing.",
              "Tranquilo is the local CLI/MCP wrapper around Pronto. If the user needs to inspect the mobile app, call it the Pronto app, never the Tranquilo app.",
              "Use househelp_prepare_booking for this House Help slot only in hosted/web handoff flows.",
              `Duration: ${args.duration}.`,
              `Slot: ${args.slot}.`,
              args.addressId ? `Address id: ${args.addressId}.` : "",
              "Use the exact startTime from househelp_find_slots; do not rely on human-only interactive booking.",
              "If this is a local terminal agent and the user said to book this slot, ask which UPI app to use if no local preference exists, then run the local CLI House Help book command with --pay --yes --open-qr --upi-app <phonepe|googlepay|paytm> so it prints QR, opens the saved QR image, and then polls. Do not ask a second pay-now question. If this is a hosted/web chat session, return the payCommand to the user. Never use --open-intent or raw OS commands to open a UPI app.",
            ]
              .filter(Boolean)
              .join(" "),
          },
        },
      ],
    })
  );

  return server;
}

export async function runMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
