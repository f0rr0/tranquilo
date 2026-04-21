import { PACKAGE_METADATA } from "@tranquilo/product/release-metadata";
import {
  type ArgsDef,
  type CommandDef,
  defineCommand,
  renderUsage,
  runCommand,
} from "citty";
import {
  addressesListAction,
  addressShowAction,
  addressUseAction,
  bookingsListAction,
  checkoutPayAction,
  checkoutStatusAction,
  doctorAction,
  househelpBookAction,
  househelpFindAction,
  househelpOptionsAction,
  househelpPaymentHandoffAction,
  househelpWatchBookAction,
  househelpWatchCreateAction,
  installAgentAction,
  loginAction,
  logoutAction,
  slotWatchDeleteAction,
  slotWatchListAction,
  slotWatchPauseAction,
  slotWatchResumeAction,
  slotWatchRunDueAction,
  slotWatchRunNowAction,
  slotWatchSchedulerAction,
  slotWatchShowAction,
  statusAction,
  whoamiAction,
} from "./cli-actions";
import { errorToJson } from "./context";
import { TranquiloError } from "./types";
import {
  maybePrintUpdateNotice,
  updateAction,
  updateCheckAction,
} from "./update";

function textArg(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    return value.at(-1) === undefined ? undefined : String(value.at(-1));
  }
  return value === undefined ? undefined : String(value);
}

function numberArg(value: unknown): number | undefined {
  const text = textArg(value);
  if (text === undefined || text === "") {
    return;
  }
  return Number(text);
}

function listArg(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => splitListValue(String(item)));
  }
  return value === undefined ? [] : splitListValue(String(value));
}

function splitListValue(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function noInteractiveValue(
  args: Record<string, unknown>
): boolean | undefined {
  return args.noInteractive === true ||
    args["no-interactive"] === true ||
    args.interactive === false
    ? true
    : undefined;
}

function repeatedFlagArg(flag: string, value: unknown): string[] {
  const values: string[] = [];
  const argv = process.argv.slice(2);
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item) {
      continue;
    }
    if (item === `--${flag}`) {
      const next = argv[index + 1];
      if (next && !next.startsWith("--")) {
        values.push(next);
        index += 1;
      }
      continue;
    }
    if (item.startsWith(`--${flag}=`)) {
      values.push(item.slice(flag.length + 3));
    }
  }
  return values.length ? listArg(values) : listArg(value);
}

async function writeResult(result: Promise<string>): Promise<void> {
  const output = await result;
  if (output) {
    process.stdout.write(output);
  }
}

const noInteractiveArg = {
  "no-interactive": {
    type: "boolean",
    description: "Never prompt; fail if more input is required",
  },
} satisfies ArgsDef;

const locationArgs = {
  "address-id": {
    type: "string",
    description: "Saved address id",
    valueHint: "id",
  },
  lat: {
    type: "string",
    description: "Latitude",
    valueHint: "lat",
  },
  lng: {
    type: "string",
    description: "Longitude",
    valueHint: "lng",
  },
} satisfies ArgsDef;

const addressesCommand = defineCommand({
  meta: { name: "addresses", description: "Manage saved addresses" },
  subCommands: {
    list: defineCommand({
      meta: { name: "list", description: "List saved addresses" },
      args: {
        json: { type: "boolean", description: "Print normalized JSON" },
        ...noInteractiveArg,
        active: {
          type: "boolean",
          default: true,
          description: "Include active delivery address lookup",
          negativeDescription: "Skip active delivery address lookup",
        },
      },
      run: ({ args }) =>
        writeResult(
          addressesListAction({
            active: args.active as boolean | undefined,
            json: args.json as boolean | undefined,
          })
        ),
    }),
    show: defineCommand({
      meta: { name: "show", description: "Show one saved address" },
      args: {
        "address-id": {
          type: "positional",
          description: "Saved address id",
          required: true,
        },
        json: { type: "boolean", description: "Print normalized JSON" },
        ...noInteractiveArg,
        active: {
          type: "boolean",
          default: true,
          description: "Include active delivery address lookup",
          negativeDescription: "Skip active delivery address lookup",
        },
      },
      run: ({ args }) =>
        writeResult(
          addressShowAction(String(args.addressId), {
            active: args.active as boolean | undefined,
            json: args.json as boolean | undefined,
          })
        ),
    }),
    use: defineCommand({
      meta: {
        name: "use",
        description: "Set the active delivery/cart address",
      },
      args: {
        "address-id": {
          type: "positional",
          description: "Saved address id",
          required: true,
        },
        json: { type: "boolean", description: "Print normalized JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          addressUseAction(String(args.addressId), {
            json: args.json as boolean | undefined,
          })
        ),
    }),
  },
});

const checkoutCommand = defineCommand({
  meta: { name: "checkout", description: "Pay and inspect checkout orders" },
  subCommands: {
    pay: defineCommand({
      meta: { name: "pay", description: "Render QR and watch payment status" },
      args: {
        "order-id": {
          type: "positional",
          description: "Checkout order id",
          required: true,
        },
        "copy-link": {
          type: "boolean",
          description: "Copy the UPI URI to clipboard",
        },
        "save-qr": {
          type: "string",
          description: "Save QR image to path",
          valueHint: "path",
        },
        "open-intent": {
          type: "boolean",
          description: "Best-effort OS open of the UPI intent",
        },
        "qr-size": {
          type: "enum",
          description: "Terminal QR size",
          options: ["compact", "small", "normal"],
          default: "compact",
          valueHint: "size",
        },
        "upi-app": {
          type: "enum",
          description:
            "UPI app to route payment through; required until a local preference is saved",
          options: ["phonepe", "googlepay", "paytm"],
          valueHint: "app",
        },
        watch: {
          type: "boolean",
          default: true,
          description: "Poll payment status and finalize booking",
          negativeDescription: "Only render payment instructions",
        },
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          checkoutPayAction(String(args.orderId), {
            copyLink: args.copyLink as boolean | undefined,
            json: args.json as boolean | undefined,
            noInteractive: noInteractiveValue(args),
            openIntent: args.openIntent as boolean | undefined,
            qrSize: textArg(args.qrSize) as
              | "compact"
              | "normal"
              | "small"
              | undefined,
            saveQr: textArg(args.saveQr),
            upiApp: textArg(args.upiApp),
            watch: args.watch as boolean | undefined,
          })
        ),
    }),
    status: defineCommand({
      meta: { name: "status", description: "Check checkout payment status" },
      args: {
        "order-id": {
          type: "positional",
          description: "Checkout order id",
          required: true,
        },
        watch: {
          type: "boolean",
          description: "Poll until final status or timeout",
        },
        json: { type: "boolean", description: "Print JSON" },
      },
      run: ({ args }) =>
        writeResult(
          checkoutStatusAction(String(args.orderId), {
            json: args.json as boolean | undefined,
            watch: args.watch as boolean | undefined,
          })
        ),
    }),
  },
});

const househelpFindArgs = {
  ...locationArgs,
  duration: {
    type: "string",
    description: "Preferred duration such as 60, 90m, or 1.5h",
    valueHint: "duration",
  },
  "duration-order": {
    type: "string",
    description: "Explicit duration fallback order, comma-separated",
    valueHint: "60,90,120,30",
  },
  "exact-duration": {
    type: "boolean",
    description: "Only search the requested duration",
  },
  date: {
    type: "string",
    description: "Single target date",
    valueHint: "YYYY-MM-DD",
  },
  "exact-date": {
    type: "string",
    description: "Exact target date with no date fallback",
    valueHint: "YYYY-MM-DD",
  },
  around: {
    type: "string",
    description: "Preferred date center for flexible date search",
    valueHint: "YYYY-MM-DD",
  },
  "flex-days": {
    type: "string",
    description: "Days before/after --around",
    valueHint: "n",
  },
  "from-date": {
    type: "string",
    description: "Target date range start",
    valueHint: "YYYY-MM-DD",
  },
  "to-date": {
    type: "string",
    description: "Target date range end",
    valueHint: "YYYY-MM-DD",
  },
  preset: {
    type: "enum",
    description: "Date preset",
    options: ["today", "tomorrow", "next-4-days", "weekend"],
    valueHint: "preset",
  },
  window: {
    type: "enum",
    description: "Time window preset",
    options: ["smart", "before-work", "after-work", "weekend", "any", "custom"],
    valueHint: "window",
  },
  "time-window": {
    type: "string",
    description: "Preferred time window; repeatable",
    valueHint: "HH:mm-HH:mm",
  },
  "exact-time": {
    type: "string",
    description: "Exact start time",
    valueHint: "HH:mm",
  },
  "exact-slot": {
    type: "string",
    description: "Exact slot start time",
    valueHint: "iso",
  },
} satisfies ArgsDef;

function househelpFindOptions(args: Record<string, unknown>) {
  return {
    addressId: textArg(args.addressId),
    around: textArg(args.around),
    date: textArg(args.date),
    duration: textArg(args.duration),
    durationOrder: repeatedFlagArg("duration-order", args.durationOrder),
    exactDate: textArg(args.exactDate),
    exactDuration: args.exactDuration as boolean | undefined,
    exactSlot: textArg(args.exactSlot),
    exactTime: textArg(args.exactTime),
    flexDays: numberArg(args.flexDays),
    fromDate: textArg(args.fromDate),
    lat: numberArg(args.lat),
    lng: numberArg(args.lng),
    preset: textArg(args.preset) as
      | "next-4-days"
      | "next-7-days"
      | "next-weekend"
      | "today"
      | "tomorrow"
      | "weekend"
      | undefined,
    timeWindow: repeatedFlagArg("time-window", args.timeWindow),
    toDate: textArg(args.toDate),
    window: textArg(args.window) as
      | "after-work"
      | "any"
      | "before-work"
      | "custom"
      | "smart"
      | "weekend"
      | undefined,
  };
}

const househelpCommand = defineCommand({
  meta: { name: "househelp", description: "Find and book House Help slots" },
  subCommands: {
    options: defineCommand({
      meta: { name: "options", description: "List House Help options" },
      args: {
        ...locationArgs,
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          househelpOptionsAction({
            addressId: textArg(args.addressId),
            json: args.json as boolean | undefined,
            lat: numberArg(args.lat),
            lng: numberArg(args.lng),
          })
        ),
    }),
    find: defineCommand({
      meta: { name: "find", description: "Find ranked House Help slots" },
      args: {
        ...househelpFindArgs,
        limit: {
          type: "string",
          description: "Maximum slots to return",
          valueHint: "n",
        },
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          househelpFindAction({
            ...househelpFindOptions(args),
            json: args.json as boolean | undefined,
            limit: numberArg(args.limit),
            noInteractive: noInteractiveValue(args),
          })
        ),
    }),
    book: defineCommand({
      meta: {
        name: "book",
        description: "Book House Help and show QR payment in local terminals",
      },
      args: {
        ...househelpFindArgs,
        duration: {
          type: "string",
          description: "Duration to book such as 60, 90m, or 1.5h",
          required: true,
          valueHint: "duration",
        },
        slot: {
          type: "string",
          description:
            'Selected slot start time, e.g. "today 6pm" or 2026-04-23T18:00',
          valueHint: "time",
        },
        rank: {
          type: "string",
          description:
            "Book the nth ranked live result for the same search filters",
          valueHint: "n",
        },
        yes: {
          type: "boolean",
          description: "Skip terminal confirmation",
        },
        pay: {
          type: "boolean",
          description:
            "Print QR and poll until payment finalizes; default for interactive terminal use",
        },
        handoff: {
          type: "boolean",
          description:
            "Prepare checkout only and print the local payment command instead of QR",
        },
        "copy-link": {
          type: "boolean",
          description: "Copy the UPI URI to clipboard during payment",
        },
        "save-qr": {
          type: "string",
          description: "Save payment QR image to path",
          valueHint: "path",
        },
        "qr-size": {
          type: "enum",
          description: "Terminal QR size for --pay",
          options: ["compact", "small", "normal"],
          default: "compact",
          valueHint: "size",
        },
        "upi-app": {
          type: "enum",
          description:
            "UPI app to route payment through; required for --pay until a local preference is saved",
          options: ["phonepe", "googlepay", "paytm"],
          valueHint: "app",
        },
        "interval-ms": {
          type: "string",
          description: "Payment poll interval for --pay",
          valueHint: "ms",
        },
        "timeout-ms": {
          type: "string",
          description: "Payment poll timeout for --pay",
          valueHint: "ms",
        },
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          househelpBookAction({
            ...househelpFindOptions(args),
            copyLink: args.copyLink as boolean | undefined,
            duration: textArg(args.duration),
            handoff: args.handoff as boolean | undefined,
            intervalMs: numberArg(args.intervalMs),
            json: args.json as boolean | undefined,
            noInteractive: noInteractiveValue(args),
            pay: args.pay as boolean | undefined,
            qrSize: textArg(args.qrSize) as
              | "compact"
              | "normal"
              | "small"
              | undefined,
            rank: numberArg(args.rank),
            saveQr: textArg(args.saveQr),
            slot: textArg(args.slot),
            timeoutMs: numberArg(args.timeoutMs),
            upiApp: textArg(args.upiApp),
            yes: args.yes as boolean | undefined,
          })
        ),
    }),
    "payment-handoff": defineCommand({
      meta: {
        name: "payment-handoff",
        description: "Return local payment command for a checkout",
      },
      args: {
        "order-id": {
          type: "positional",
          description: "Checkout order id",
          required: true,
        },
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          househelpPaymentHandoffAction(String(args.orderId), {
            json: args.json as boolean | undefined,
          })
        ),
    }),
    watch: defineCommand({
      meta: {
        name: "watch",
        description: "Notify-only House Help slot watches",
      },
      subCommands: {
        create: defineCommand({
          meta: { name: "create", description: "Create House Help watch" },
          args: {
            ...househelpFindArgs,
            name: {
              type: "string",
              description: "Human label for the watch",
              valueHint: "name",
            },
            "slack-webhook": {
              type: "string",
              description:
                "Slack incoming webhook URL for slot-found notifications",
              valueHint: "url",
            },
            "desktop-notify": {
              type: "boolean",
              default: true,
              description: "Send desktop notifications",
              negativeDescription: "Disable desktop notifications",
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              househelpWatchCreateAction({
                ...househelpFindOptions(args),
                desktopNotify: args.desktopNotify as boolean | undefined,
                json: args.json as boolean | undefined,
                name: textArg(args.name),
                slackWebhookUrl: textArg(args.slackWebhook),
              })
            ),
        }),
        book: defineCommand({
          meta: {
            name: "book",
            description: "Book the found slot for a House Help watch",
          },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            pay: {
              type: "boolean",
              default: true,
              description: "Show QR payment UI",
              negativeDescription: "Only create checkout order",
            },
            "copy-link": {
              type: "boolean",
              description: "Copy the UPI URI to clipboard during payment",
            },
            "save-qr": {
              type: "string",
              description: "Save payment QR image to path",
              valueHint: "path",
            },
            "qr-size": {
              type: "enum",
              description: "Terminal QR size for --pay",
              options: ["compact", "small", "normal"],
              default: "compact",
              valueHint: "size",
            },
            "upi-app": {
              type: "enum",
              description:
                "UPI app to route payment through; required for --pay until a local preference is saved",
              options: ["phonepe", "googlepay", "paytm"],
              valueHint: "app",
            },
            "interval-ms": {
              type: "string",
              description: "Payment poll interval for --pay",
              valueHint: "ms",
            },
            "timeout-ms": {
              type: "string",
              description: "Payment poll timeout for --pay",
              valueHint: "ms",
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              househelpWatchBookAction(String(args.id), {
                copyLink: args.copyLink as boolean | undefined,
                intervalMs: numberArg(args.intervalMs),
                json: args.json as boolean | undefined,
                noInteractive: noInteractiveValue(args),
                pay: args.pay as boolean | undefined,
                qrSize: textArg(args.qrSize) as
                  | "compact"
                  | "normal"
                  | "small"
                  | undefined,
                saveQr: textArg(args.saveQr),
                timeoutMs: numberArg(args.timeoutMs),
                upiApp: textArg(args.upiApp),
              })
            ),
        }),
        list: defineCommand({
          meta: { name: "list", description: "List House Help watches" },
          args: {
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchListAction({ json: args.json as boolean | undefined })
            ),
        }),
        show: defineCommand({
          meta: { name: "show", description: "Show House Help watch" },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchShowAction(String(args.id), {
                json: args.json as boolean | undefined,
              })
            ),
        }),
        pause: defineCommand({
          meta: { name: "pause", description: "Pause House Help watch" },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchPauseAction(String(args.id), {
                json: args.json as boolean | undefined,
              })
            ),
        }),
        resume: defineCommand({
          meta: { name: "resume", description: "Resume House Help watch" },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchResumeAction(String(args.id), {
                json: args.json as boolean | undefined,
              })
            ),
        }),
        delete: defineCommand({
          meta: { name: "delete", description: "Delete House Help watch" },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchDeleteAction(String(args.id), {
                json: args.json as boolean | undefined,
              })
            ),
        }),
        "run-now": defineCommand({
          meta: { name: "run-now", description: "Run House Help watch now" },
          args: {
            id: {
              type: "positional",
              description: "Slot watch id",
              required: true,
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchRunNowAction(String(args.id), {
                json: args.json as boolean | undefined,
              })
            ),
        }),
        "run-due": defineCommand({
          meta: { name: "run-due", description: "Run due House Help watches" },
          args: {
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              slotWatchRunDueAction({
                json: args.json as boolean | undefined,
              })
            ),
        }),
        scheduler: defineCommand({
          meta: {
            name: "scheduler",
            description: "Manage the House Help watch OS timer",
          },
          subCommands: {
            install: defineCommand({
              meta: { name: "install", description: "Install OS timer" },
              run: () => writeResult(slotWatchSchedulerAction("install")),
            }),
            uninstall: defineCommand({
              meta: { name: "uninstall", description: "Uninstall OS timer" },
              run: () => writeResult(slotWatchSchedulerAction("uninstall")),
            }),
            status: defineCommand({
              meta: { name: "status", description: "Show OS timer status" },
              run: () => writeResult(slotWatchSchedulerAction("status")),
            }),
          },
        }),
      },
    }),
  },
});

export const mainCommand = defineCommand({
  meta: {
    name: "tranquilo",
    version: PACKAGE_METADATA.version,
    description: "Tranquilo CLI and local MCP server",
  },
  subCommands: {
    login: defineCommand({
      meta: {
        name: "login",
        description: "Start phone OTP login and store credentials",
      },
      args: {
        phone: {
          type: "string",
          description: "Mobile number",
          valueHint: "number",
        },
        otp: {
          type: "string",
          description: "OTP code; prefer interactive prompt for normal use",
          valueHint: "code",
        },
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: ({ args }) =>
        writeResult(
          loginAction({
            noInteractive: noInteractiveValue(args),
            otp: textArg(args.otp),
            phone: textArg(args.phone),
          })
        ),
    }),
    logout: defineCommand({
      meta: { name: "logout", description: "Clear stored credentials" },
      run: () => writeResult(logoutAction()),
    }),
    status: defineCommand({
      meta: { name: "status", description: "Show auth and config status" },
      args: {
        json: { type: "boolean", description: "Print JSON" },
        ...noInteractiveArg,
      },
      run: () => writeResult(statusAction()),
    }),
    whoami: defineCommand({
      meta: { name: "whoami", description: "Show current user profile" },
      run: () => writeResult(whoamiAction()),
    }),
    addresses: addressesCommand,
    checkout: checkoutCommand,
    househelp: househelpCommand,
    bookings: defineCommand({
      meta: { name: "bookings", description: "Inspect booking history" },
      subCommands: {
        list: defineCommand({
          meta: {
            name: "list",
            description: "List bookings using captured status/type presets",
          },
          args: {
            status: {
              type: "enum",
              description: "Status preset",
              options: ["upcoming", "past", "all"],
              default: "upcoming",
              valueHint: "status",
            },
            page: {
              type: "string",
              description: "Page number",
              default: "1",
              valueHint: "n",
            },
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(
              bookingsListAction({
                page: Number(args.page ?? 1),
                status:
                  (args.status as "all" | "past" | "upcoming" | undefined) ??
                  "upcoming",
              })
            ),
        }),
      },
    }),
    doctor: defineCommand({
      meta: { name: "doctor", description: "Check local setup" },
      args: {
        secrets: {
          type: "boolean",
          description: "Also check credential storage and auth state",
        },
      },
      run: ({ args }) =>
        writeResult(doctorAction({ secrets: args.secrets === true })),
    }),
    mcp: defineCommand({
      meta: { name: "mcp", description: "Run the local stdio MCP server" },
      run: async () => {
        const { runMcpServer } = await import("./mcp");
        await runMcpServer();
      },
    }),
    "install-agent": defineCommand({
      meta: {
        name: "install-agent",
        description: "Install MCP/skill integration for local AI clients",
      },
      args: {
        target: {
          type: "positional",
          description: "auto, codex, claude-code, claude-desktop, or all",
          required: true,
        },
      },
      run: ({ args }) => writeResult(installAgentAction(String(args.target))),
    }),
    update: defineCommand({
      meta: { name: "update", description: "Update the local CLI binary" },
      args: {
        json: { type: "boolean", description: "Print JSON for update check" },
        ...noInteractiveArg,
      },
      subCommands: {
        check: defineCommand({
          meta: { name: "check", description: "Check for CLI updates" },
          args: {
            json: { type: "boolean", description: "Print JSON" },
            ...noInteractiveArg,
          },
          run: ({ args }) =>
            writeResult(updateCheckAction({ json: args.json === true })),
        }),
      },
      run: () => {
        if (process.argv.slice(2)[1] === "check") {
          return;
        }
        return writeResult(updateAction());
      },
    }),
  },
});

function resolveHelpCommand(rawArgs: string[]): {
  command: CommandDef;
  parent?: CommandDef | undefined;
} {
  const path = rawArgs.filter((arg) => arg !== "--help" && arg !== "-h");
  let command: CommandDef = mainCommand;
  let parent: CommandDef | undefined;
  const names = ["tranquilo"];

  for (const token of path) {
    if (token.startsWith("-")) {
      continue;
    }
    const subCommands = command.subCommands as
      | Record<string, CommandDef>
      | undefined;
    const next = subCommands?.[token];
    if (!next) {
      break;
    }
    parent = command;
    command = next;
    names.push(token);
  }

  if (names.length > 2) {
    parent = defineCommand({
      meta: { name: names.slice(0, -1).join(" ") },
    });
  }

  return { command, parent };
}

async function printHelp(rawArgs: string[]): Promise<void> {
  const { command, parent } = resolveHelpCommand(rawArgs);
  process.stdout.write(`${await renderUsage(command, parent)}\n`);
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  const rawArgs = argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    await printHelp(rawArgs);
    return;
  }
  const firstArg = rawArgs[0];
  if (
    rawArgs.length === 1 &&
    firstArg &&
    ["--version", "-v"].includes(firstArg)
  ) {
    process.stdout.write(`${PACKAGE_METADATA.version}\n`);
    return;
  }

  try {
    await maybePrintUpdateNotice(rawArgs);
    await runCommand(mainCommand, { rawArgs });
  } catch (error) {
    process.stderr.write(`${JSON.stringify(errorToJson(error), null, 2)}\n`);
    process.exitCode =
      error instanceof TranquiloError && error.code === "NOT_AUTHENTICATED"
        ? 3
        : 1;
  }
}
