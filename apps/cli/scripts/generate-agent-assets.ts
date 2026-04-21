import fs from "node:fs/promises";
import path from "node:path";
import { AGENT_CATALOG, MCP_TOOLS } from "@tranquilo/product/agent-catalog";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "@tranquilo/product/release-metadata";
import { z } from "zod/v4";

const { agentSafeCliCommands, localAgentCliCommands, productLanguage } =
  AGENT_CATALOG;

interface GeneratedFile {
  content: string;
  path: string;
}

const root = process.cwd();
const checkMode = process.argv.includes("--check");

function codeBlock(commands: readonly string[]): string {
  return ["```sh", ...commands, "```"].join("\n");
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function skillMarkdown(): string {
  const toolLines = MCP_TOOLS.map((tool) => `- \`${tool.name}\``);
  const fallbackCommands = agentSafeCliCommands.map(
    (command) => command.command
  );
  const localPaymentCommand = localAgentCliCommands[0]?.command;

  return `---
name: tranquilo
description: "Use when a user asks for a maid, house help, home cleaning help, domestic help, hourly cleaner, Tranquilo booking, saved address, slot search, payment handoff, full local QR payment, booking history, or a watch for future maid/househelp slots. Do not use for coupons, cancellation, rescheduling, or payment app opening."
---

# Tranquilo

${productLanguage}

Use the installed \`tranquilo\` MCP server first for auth, address, options, and slot inspection. For a local terminal user who says "book it" or confirms a booking, run the local CLI QR payment flow immediately because MCP tool results are not a good place to block before the QR is visible.

## Agent Rules

- Natural user phrases like "find a maid tomorrow", "book house help after work", "scan for slots", "keep looking for 1 hour slots", "need cleaning help this weekend", or "get me a 60 min maid slot" mean the House Help booking flow.
- Interpret terse booking language aggressively: "1 hour" means 60-minute House Help duration unless the user says "for the next hour"; "upcoming days" or "next few days" means \`preset=next-4-days\`; "after 6pm" means \`--time-window 18:00-22:00\`; "any you find" means the earliest ranked acceptable slot.
- Product language: ${productLanguage}
- For any Tranquilo request, call \`auth_status\` first. If credentials are missing, stop and tell the user exactly: \`Run tranquilo login in a local terminal, then retry.\` Do not continue to address/slot tools until authenticated.
- Never ask users to paste OTPs, access tokens, refresh tokens, UPI details, or payment data into chat.
- Treat user phrases like "book it", "book this", "yes book", or "book the 60 min one" as approval to create checkout and show the local QR payment flow for the selected slot. Do not ask a second "pay now?" question in local terminal agents.
- Before running a local QR payment flow, ask which UPI app to use if the user has not already said and no local preference exists. Allowed values are \`phonepe\`, \`googlepay\`, and \`paytm\`. Pass that value as \`--upi-app\`; the CLI remembers it for later payments.
- Treat "book any you find" or "book the first one" as approval to book the earliest matching slot only if it is available in the current interactive session. If no slot is available now and a background watch is needed, create a notify-only watch. When a notification arrives later, inspect the watch and book it locally after the user confirms.
- Treat follow-up corrections as authoritative. If the user says "check any day for 30 mins" after a 60-minute search, discard the old duration/date filters and run a fresh 30-minute search.
- Only run QR/payment polling commands in a local terminal agent after the user has selected or confirmed the exact slot/duration/address.
- Do not call OTP login, terminal confirmation, or OS-open flows from the agent session.
- Treat \`address_use\` as selecting the active delivery/cart address, not a profile-level default.
- Use House Help tools for the booking journey; generic cart, slot, and service-catalog tools are not exposed.
- Payment can be either a handoff or a full local terminal flow. Local terminal agents should use the full QR flow after booking approval; hosted/web chat agents should use handoff only.

## MCP Tools

Use these tools directly:

${toolLines.join("\n")}

Read-only tools are safe for inspection. Mutating tools such as \`address_use\`, \`househelp_prepare_booking\`, and watch create/pause/resume/delete/run-now need explicit user intent and structured arguments. Tool input schemas are generated in \`references/mcp-tools.json\`.

## CLI Fallback

Only use CLI fallback when MCP is not connected, and always request structured output:

${codeBlock(fallbackCommands)}

Prefer exact \`startTime\` values returned by \`househelp_find_slots\` when preparing a booking. CLI \`--rank\` is acceptable only as a fallback with explicit search filters because it re-checks live slots before checkout.

For full local booking after the user says "book it" or otherwise approves the selected slot, run the CLI in the local terminal so it prints QR immediately, waits for scan, polls payment, and finalizes. Do not return a payment command and wait for a second "pay now" message:

${codeBlock([`${localPaymentCommand ?? "tranquilo househelp book --pay --yes --upi-app <phonepe|googlepay|paytm>"} --duration 60 --rank 1 --preset next-4-days --window after-work --address-id <id> --save-qr /tmp/tranquilo-payment.png`])}

Do not use \`tranquilo checkout pay <orderId>\` as the normal local booking path after preparing checkout through MCP; Juspay may refuse to reopen old prepared orders. Use a fresh \`tranquilo househelp book ... --pay --yes --upi-app <app>\` command for local QR payment. The CLI prints a standard terminal QR and saves a PNG fallback; in Codex desktop, show the saved PNG path as a Markdown image if the terminal QR is hard to scan. Hosted/web chat agents should not run QR or polling flows; relay the returned payment command to the user instead. Never open a UPI app from the agent.

## Booking Flow

1. Interpret "maid", "cleaner", "house help", "domestic help", and "hourly cleaning" as Tranquilo House Help.
2. Check \`auth_status\`; if unauthenticated, stop and give the local login command.
3. Use \`addresses_list\` and prefer the active delivery/cart address. Ask only if there are multiple plausible addresses and the user did not imply one.
4. Use \`househelp_options\` to discover backend-supported durations and prices. Do not hardcode duration ids.
5. Convert normal date/time language into filters: "tomorrow" -> \`preset=tomorrow\`; "after work/evening" -> \`window=after-work\`; "before work/morning" -> \`window=before-work\`; "weekend" -> \`preset=weekend\` only if it falls inside the valid booking horizon; if duration is absent, show available options or use the best default only after user confirmation.
6. Use \`househelp_find_slots\` with the user's preferred duration, date flexibility, and window. Useful defaults are \`preset=next-4-days\` and \`window=smart\`. If fallback durations are returned, clearly label them as alternatives and do not book a fallback duration without explicit user confirmation.
7. For "scan", "keep looking", or "watch" requests, first do an immediate \`househelp_find_slots\` check. If a matching slot is available and the user said to book any/first match, book it locally with QR. If no slot is available, create \`househelp_watch_create\` as a notify-only watch. Watches must not prepare checkout automatically; when the watch later reports a found slot, inspect it and ask the user before running the local \`tranquilo househelp watch book <watchId> --pay\` flow.
8. Do not offer dates outside the valid booking horizon: today, tomorrow, and the next two days. If the user asks beyond that, explain that Tranquilo does not allow booking that date yet.
9. If an older checkout exists outside that horizon, or its amount/duration looks wrong, do not pay it. Restart slot search and create a fresh checkout inside the valid horizon.
10. If this is a local terminal agent and the user says to book the selected slot, run \`tranquilo househelp book ... --pay --yes --upi-app <app>\` with explicit \`duration\`, \`slot\` or \`rank\`, address context, and the user's selected or remembered UPI app. Tell the user to scan the QR and wait for confirmation.
11. If this is a hosted/web chat session, or the user explicitly asks only to prepare payment, call \`househelp_prepare_booking\` and return the \`payCommand\`, amount, selected slot, duration, and address/source.
12. If payment/confirmation fails and the user may need to inspect the mobile app, refer to the "Pronto app". Do not say "Tranquilo app".
13. Do not print a cryptic command as the primary response in local terminal sessions when the user asked to book; run the QR flow instead.

## Example Intents

- "Find a maid tomorrow" -> auth check, active address, options, \`househelp_find_slots\` with \`preset=tomorrow\` and \`window=smart\`.
- "Book a cleaner after work this week for 1 hour" -> duration 60, \`preset=next-4-days\`, \`window=after-work\`, ask before checkout/payment and ask for UPI app if no preference exists.
- "Scan for slots for 1 hour in upcoming days and book any you find after 6pm" -> duration 60, \`preset=next-4-days\`, \`timeWindow=["18:00-22:00"]\`, immediate search; if found now, ask for UPI app if needed and run fresh local \`househelp book --pay --yes --upi-app <app>\`; if not found now, create a notify-only watch and tell the user they can say \`book watch <id>\` when notified.
- "Need house help before 9am" -> use \`window=before-work\`.
- "Watch for a weekend maid slot" -> use \`househelp_watch_create\` with \`preset=weekend\` only if the weekend is within today plus 3 days.
`;
}

function mcpToolsJson(): string {
  return json({
    generatedFrom: "packages/product/src/agent-catalog.ts",
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      annotations: tool.annotations,
      inputSchema: z.toJSONSchema(tool.schema, { io: "input" }),
    })),
  });
}

function mcpbManifest(): string {
  const dirnameVariable = ["$", "{__dirname}"].join("");
  const dirnameEntryPoint = path.posix.join(dirnameVariable, "dist/index.js");

  return json({
    dxt_version: RELEASE_METADATA.mcpb.dxtVersion,
    name: PACKAGE_METADATA.name,
    version: PACKAGE_METADATA.version,
    description: PACKAGE_METADATA.description,
    author: { name: "Tranquilo" },
    server: {
      type: "node",
      entry_point: "dist/index.js",
      mcp_config: {
        command: "node",
        args: [dirnameEntryPoint, "mcp"],
      },
    },
    tools: MCP_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.manifestDescription,
    })),
    compatibility: {
      platforms: RELEASE_METADATA.mcpb.compatibilityPlatforms,
    },
  });
}

function openAiYaml(): string {
  return [
    "display_name: Tranquilo",
    "short_description: Find and book maid / House Help slots through Tranquilo from natural requests.",
    "default_prompt: Use Tranquilo when the user asks for a maid, cleaner, house help, domestic help, hourly cleaning, or Tranquilo booking. Check auth first; if unauthenticated, give the local login command and stop.",
    "",
  ].join("\n");
}

function claudeCommand(
  description: string,
  argumentHint: string,
  body: string
): string {
  return `---
description: ${description}
argument-hint: ${argumentHint}
---

${body}
`;
}

function generatedFiles(): GeneratedFile[] {
  return [
    {
      path: "assets/codex-skill/SKILL.md",
      content: skillMarkdown(),
    },
    {
      path: "assets/codex-skill/agents/openai.yaml",
      content: openAiYaml(),
    },
    {
      path: "assets/codex-skill/references/mcp-tools.json",
      content: mcpToolsJson(),
    },
    {
      path: "assets/claude-commands/tranquilo/bookings.md",
      content: claudeCommand(
        "List Tranquilo bookings",
        "[upcoming|past|all]",
        "Use the Tranquilo MCP server to list bookings. Use `$ARGUMENTS` as the status preset if provided; otherwise use `upcoming`."
      ),
    },
    {
      path: "assets/claude-commands/tranquilo/checkout.md",
      content: claudeCommand(
        "Prepare Tranquilo payment handoff",
        "<orderId>",
        'Use the Tranquilo MCP server to return a safe local payment handoff for hosted/web-style sessions; for existing House Help orders use `househelp_payment_handoff`. If this is a local terminal session and the user says "book it" for a selected House Help slot, ask which UPI app to use if no remembered preference exists (`phonepe`, `googlepay`, or `paytm`), then run the local House Help book command with `--pay --yes --upi-app <app>` so it prints the QR immediately, waits for scan, polls payment, and finalizes the booking. Do not ask a separate "pay now?" question, do not expose Juspay tokens in chat, and never open a UPI app from the agent.'
      ),
    },
    {
      path: "assets/claude-commands/tranquilo/slots.md",
      content: claudeCommand(
        "Find maid / House Help slots",
        "[duration]",
        'Use the Tranquilo MCP server when the user asks for a maid, cleaner, house help, domestic help, hourly cleaning, scanning for slots, or keeping watch for slots. First call `auth_status`; if unauthenticated, tell the user the `loginHint` and stop. If `$ARGUMENTS` is provided, use it as the preferred duration. Prefer `househelp_options` and `househelp_find_slots`, and prefer the user\'s active cart delivery address unless they specify another saved address. Map natural time language: tomorrow -> `preset=tomorrow`, upcoming days/next few days -> `preset=next-4-days`, after work/evening -> `window=after-work`, after 6pm -> `timeWindow=["18:00-22:00"]`, before work/morning -> `window=before-work`, weekend -> `preset=weekend` only if it is within today plus 3 days. Interpret "1 hour slots" as 60-minute House Help unless the user says "for the next hour". Never offer dates outside today, tomorrow, and the next two days. For watch requests, create notify-only watches; watches must not create checkout automatically. When a watch later finds a slot, inspect it and ask before booking the found watch locally.'
      ),
    },
    {
      path: "mcpb/manifest.json",
      content: mcpbManifest(),
    },
  ];
}

async function run(): Promise<void> {
  const stale: string[] = [];
  for (const file of generatedFiles()) {
    const absolute = path.join(root, file.path);
    if (checkMode) {
      const current = await fs.readFile(absolute, "utf8").catch(() => "");
      if (current !== file.content) {
        stale.push(file.path);
      }
      continue;
    }
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, file.content);
  }

  if (stale.length) {
    throw new Error(
      `Generated agent assets are stale. Run \`bun run agent-assets:generate\`.\n${stale.join("\n")}`
    );
  }
}

await run();
