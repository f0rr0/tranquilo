import { z } from "zod/v4";

const PRODUCT_LANGUAGE =
  "Tranquilo is the local CLI/MCP wrapper around Pronto. There is no user-facing Tranquilo app; say Pronto app when referring to the mobile app.";

const LOGIN_HINT = "Run `tranquilo login` in a local terminal, then retry.";

const VALID_BOOKING_HORIZON =
  "House Help bookings are only valid for today, tomorrow, and the next two days.";

const LocationInputSchema = z.object({
  addressId: z.string().optional().describe("Saved address id"),
  lat: z.number().optional().describe("Latitude"),
  lng: z.number().optional().describe("Longitude"),
});

const HousehelpFindInputSchema = LocationInputSchema.extend({
  around: z.string().optional().describe("Natural-language location context"),
  date: z.string().optional().describe("Natural-language date"),
  duration: z
    .union([z.string(), z.number()])
    .optional()
    .describe("Preferred House Help duration in minutes"),
  durationOrder: z
    .array(z.string())
    .optional()
    .describe("Ordered duration preferences in minutes"),
  exactDate: z.string().optional().describe("Exact date as YYYY-MM-DD"),
  exactDuration: z
    .boolean()
    .optional()
    .describe("If true, do not include fallback durations"),
  exactSlot: z.string().optional().describe("Exact slot start time to verify"),
  exactTime: z.string().optional().describe("Exact local time as HH:mm"),
  flexDays: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe("Allowed day flexibility around the requested date"),
  fromDate: z.string().optional().describe("Search start date as YYYY-MM-DD"),
  preset: z
    .enum(["today", "tomorrow", "next-4-days", "weekend"])
    .optional()
    .describe("Date preset"),
  timeWindow: z
    .array(z.string())
    .optional()
    .describe("Explicit time windows as HH:mm-HH:mm"),
  toDate: z.string().optional().describe("Search end date as YYYY-MM-DD"),
  window: z
    .enum(["smart", "before-work", "after-work", "weekend", "any", "custom"])
    .optional()
    .describe("Time-window preset"),
});

const AgentInputSchemas = {
  addressShow: z.object({
    addressId: z.string().describe("Saved address id"),
    includeActive: z.boolean().default(true),
  }),
  addressUse: z.object({
    addressId: z.string().describe("Saved address id"),
  }),
  addressesList: z.object({
    includeActive: z.boolean().default(true),
  }),
  authStatus: z.object({}),
  bookingsList: z.object({
    status: z.enum(["upcoming", "past", "all"]).default("upcoming"),
    page: z.number().int().positive().default(1),
  }),
  househelpFind: HousehelpFindInputSchema.extend({
    limit: z.number().int().positive().optional(),
  }),
  househelpOptions: LocationInputSchema,
  househelpPaymentHandoff: z.object({
    orderId: z.string().describe("Pronto/Juspay order id"),
  }),
  househelpPrepareBooking: HousehelpFindInputSchema.extend({
    duration: z.union([z.string(), z.number()]),
    slot: z.string().describe("Selected slot start time"),
  }),
  househelpWatchCreate: HousehelpFindInputSchema.extend({
    desktopNotify: z.boolean().optional(),
    name: z.string().optional(),
    slackWebhookUrl: z.url().optional(),
  }),
  idOnly: z.object({
    id: z.string().describe("Slot watch id"),
  }),
  empty: z.object({}),
} as const;

export type AddressShowInput = z.infer<typeof AgentInputSchemas.addressShow>;
export type AddressUseInput = z.infer<typeof AgentInputSchemas.addressUse>;
export type AddressesListInput = z.infer<
  typeof AgentInputSchemas.addressesList
>;
export type BookingsListInput = z.infer<typeof AgentInputSchemas.bookingsList>;
export type HousehelpFindInput = z.infer<
  typeof AgentInputSchemas.househelpFind
>;
export type HousehelpOptionsInput = z.infer<
  typeof AgentInputSchemas.househelpOptions
>;
export type HousehelpPaymentHandoffInput = z.infer<
  typeof AgentInputSchemas.househelpPaymentHandoff
>;
export type HousehelpPrepareBookingInput = z.infer<
  typeof AgentInputSchemas.househelpPrepareBooking
>;
export type HousehelpWatchCreateInput = z.infer<
  typeof AgentInputSchemas.househelpWatchCreate
>;
export type IdOnlyInput = z.infer<typeof AgentInputSchemas.idOnly>;

export const AgentPromptSchemas = {
  findHousehelpSlots: z.object({
    addressId: z.string().optional(),
    duration: z.string().optional(),
    naturalRequest: z.string().optional(),
    preset: z.string().optional(),
    window: z.string().optional(),
  }),
  listBookings: z.object({
    status: z.enum(["upcoming", "past", "all"]).optional(),
  }),
  prepareSlotPayment: z.object({
    duration: z.string(),
    slot: z.string(),
    addressId: z.string().optional(),
  }),
  showSlotWatches: z.object({}),
  watchAfterWorkSlots: z.object({
    addressId: z.string().optional(),
    duration: z.string().optional(),
  }),
} as const;

interface ToolAnnotations {
  destructiveHint?: boolean | undefined;
  idempotentHint?: boolean | undefined;
  openWorldHint?: boolean | undefined;
  readOnlyHint?: boolean | undefined;
}

type AgentInputSchema =
  (typeof AgentInputSchemas)[keyof typeof AgentInputSchemas];

interface McpToolDefinition {
  annotations: ToolAnnotations;
  cliFallback?: string | undefined;
  description: string;
  manifestDescription?: string | undefined;
  name: string;
  schema: AgentInputSchema;
  title: string;
}

export const MCP_TOOLS = [
  {
    name: "auth_status",
    title: "Auth status",
    description:
      "First tool to call for any Tranquilo, maid, house help, cleaner, slot, address, or booking request. If unauthenticated, return the loginHint and stop.",
    manifestDescription: "Check local Tranquilo login status.",
    schema: AgentInputSchemas.authStatus,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "addresses_list",
    title: "List addresses",
    description: "List saved addresses.",
    manifestDescription: "List saved Tranquilo addresses.",
    cliFallback: "tranquilo addresses list --json --no-interactive",
    schema: AgentInputSchemas.addressesList,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "address_show",
    title: "Show address",
    description: "Show one normalized saved address.",
    manifestDescription: "Show one saved Tranquilo address.",
    schema: AgentInputSchemas.addressShow,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "address_use",
    title: "Use delivery address",
    description:
      "Set the active delivery/cart address. This does not change a profile-level default address.",
    manifestDescription: "Set the active delivery/cart address.",
    schema: AgentInputSchemas.addressUse,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "househelp_options",
    title: "Maid / House Help options",
    description:
      "Agent-safe: list backend-supported maid/house-help/hourly-cleaner durations and prices for an address. Use this when the user asks for a maid, cleaner, house help, domestic help, or hourly cleaning.",
    manifestDescription: "List backend-supported House Help options.",
    cliFallback: "tranquilo househelp options --json --no-interactive",
    schema: AgentInputSchemas.househelpOptions,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "househelp_find_slots",
    title: "Find Maid / House Help slots",
    description:
      "Agent-safe: find ranked maid/house-help/hourly-cleaner slots from natural requests like 'find a maid tomorrow' or 'cleaner after work'. Follow-up corrections replace prior filters. Fallback durations are alternatives; do not book a fallback duration without explicit user confirmation. This does not mutate cart or create checkout.",
    manifestDescription:
      "Find ranked House Help slots without mutating cart or checkout.",
    cliFallback:
      "tranquilo househelp find --duration 60 --preset next-4-days --window smart --json --no-interactive",
    schema: AgentInputSchemas.househelpFind,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "househelp_prepare_booking",
    title: "Prepare Maid / House Help booking",
    description:
      "Agent-safe hosted/web mutation: create a maid/house-help checkout only from explicit duration and slot, then return a local CLI payment command. Local terminal agents should run the CLI QR flow directly after the user says to book.",
    manifestDescription:
      "Hosted/web handoff: prepare a House Help checkout from explicit structured inputs and return the local QR payment command.",
    cliFallback:
      'tranquilo househelp book --duration 60 --slot "2026-04-23 18:00" --address-id <id> --handoff --json --no-interactive',
    schema: AgentInputSchemas.househelpPrepareBooking,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "househelp_payment_handoff",
    title: "Maid / House Help payment handoff",
    description:
      "Agent-safe hosted/web handoff: return the local terminal command that shows QR, polls payment, and finalizes the booking when run locally.",
    manifestDescription:
      "Hosted/web handoff: return the local command that prints QR, polls payment, and finalizes the booking when run locally.",
    cliFallback:
      "tranquilo househelp payment-handoff <orderId> --json --no-interactive",
    schema: AgentInputSchemas.househelpPaymentHandoff,
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "bookings_list",
    title: "List bookings",
    description: "List bookings using captured status/type presets.",
    manifestDescription: "List Tranquilo booking history.",
    cliFallback: "tranquilo bookings list --json --no-interactive",
    schema: AgentInputSchemas.bookingsList,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: "househelp_watch_create",
    title: "Create House Help watch",
    description:
      "Agent-safe mutation: create a notify-only House Help slot watch. It never creates checkout automatically; when a slot is found, tell the user to inspect/book the watch locally.",
    manifestDescription: "Create a notify-only House Help slot watch.",
    cliFallback:
      "tranquilo househelp watch create --duration 60 --preset next-4-days --time-window 18:00-22:00 --address-id <id> --json --no-interactive",
    schema: AgentInputSchemas.househelpWatchCreate,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "househelp_watch_list",
    title: "List House Help watches",
    description: "Agent-safe: list local House Help slot watches.",
    manifestDescription: "List notify-only House Help slot watches.",
    cliFallback: "tranquilo househelp watch list --json --no-interactive",
    schema: AgentInputSchemas.empty,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "househelp_watch_show",
    title: "Show House Help watch",
    description: "Agent-safe: show one local House Help slot watch.",
    manifestDescription: "Show one House Help slot watch.",
    cliFallback:
      "tranquilo househelp watch show <watchId> --json --no-interactive",
    schema: AgentInputSchemas.idOnly,
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "househelp_watch_pause",
    title: "Pause House Help watch",
    description: "Agent-safe mutation: pause one local House Help watch.",
    manifestDescription: "Pause one House Help slot watch.",
    schema: AgentInputSchemas.idOnly,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "househelp_watch_resume",
    title: "Resume House Help watch",
    description: "Agent-safe mutation: resume one local House Help watch.",
    manifestDescription: "Resume one House Help slot watch.",
    schema: AgentInputSchemas.idOnly,
    annotations: {
      readOnlyHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: "househelp_watch_delete",
    title: "Delete House Help watch",
    description: "Agent-safe mutation: delete one local House Help watch.",
    manifestDescription: "Delete one House Help slot watch.",
    schema: AgentInputSchemas.idOnly,
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: "househelp_watch_run_now",
    title: "Run House Help watch now",
    description:
      "Agent-safe mutation: run one local House Help watch now. A found match is persisted and notified; checkout is never created automatically.",
    manifestDescription:
      "Run one House Help slot watch now without booking or opening payment UI.",
    schema: AgentInputSchemas.idOnly,
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
] as const satisfies readonly McpToolDefinition[];

export type McpToolName = (typeof MCP_TOOLS)[number]["name"];

const AGENT_SAFE_MCP_TOOLS = MCP_TOOLS.map((tool) => tool.name);

const AGENT_SAFE_CLI_COMMANDS = [
  {
    agentSafe: true,
    command: "tranquilo status --json --no-interactive",
    description: "Check local auth/config status.",
    mutates: false,
    readOnly: true,
    requiresJson: true,
    requiresNoInteractive: true,
  },
  ...MCP_TOOLS.flatMap((tool) => {
    const command = "cliFallback" in tool ? tool.cliFallback : undefined;
    return command
      ? [
          {
            agentSafe: true as const,
            command,
            description: tool.description,
            mutates: tool.annotations.readOnlyHint !== true,
            readOnly: tool.annotations.readOnlyHint === true,
            requiresJson: true as const,
            requiresNoInteractive: true as const,
          },
        ]
      : [];
  }),
  {
    agentSafe: true,
    command:
      "tranquilo househelp watch book <watchId> --json --no-interactive --no-pay",
    description:
      "Prepare a checkout handoff from a watch that has already found a slot.",
    mutates: true,
    readOnly: false,
    requiresJson: true,
    requiresNoInteractive: true,
  },
] as const;

const LOCAL_AGENT_CLI_COMMANDS = [
  {
    agentSafe: true,
    command:
      "tranquilo househelp book --pay --yes --upi-app <phonepe|googlepay|paytm>",
    description:
      "Local terminal booking path after user approval: prepare checkout, route payment through the user's selected UPI app, print QR immediately, poll payment, and finalize the booking.",
    pollsPayment: true,
    printsQr: true,
    requiresLocalTerminal: true,
    requiresUserApproval: true,
  },
  {
    agentSafe: true,
    command: "tranquilo checkout pay --upi-app <phonepe|googlepay|paytm>",
    description:
      "Local terminal agent path for an already prepared checkout order. Ask the user which UPI app to use if no remembered preference exists.",
    pollsPayment: true,
    printsQr: true,
    requiresLocalTerminal: true,
    requiresUserApproval: true,
  },
] as const;

const HUMAN_ONLY_CLI_COMMANDS = [
  {
    agentSafe: false,
    command: "tranquilo login",
    reason: "OTP entry belongs in the user's terminal, not in chat.",
  },
  {
    agentSafe: false,
    command: "tranquilo checkout pay --open-intent",
    reason: "Opens a local OS/app intent and must be user initiated.",
  },
] as const;

export const AGENT_CATALOG = {
  agentSafeCliCommands: AGENT_SAFE_CLI_COMMANDS,
  agentSafeMcpTools: AGENT_SAFE_MCP_TOOLS,
  humanOnlyCliCommands: HUMAN_ONLY_CLI_COMMANDS,
  localAgentCliCommands: LOCAL_AGENT_CLI_COMMANDS,
  loginHint: LOGIN_HINT,
  productLanguage: PRODUCT_LANGUAGE,
  validBookingHorizon: VALID_BOOKING_HORIZON,
} as const;

export function toolByName(name: McpToolName) {
  const tool = MCP_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  return tool;
}
