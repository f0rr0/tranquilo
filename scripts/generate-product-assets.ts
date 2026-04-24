import { spawn } from "node:child_process";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { mainCommand } from "../apps/cli/src/cli";
import {
  AGENT_CATALOG,
  MCP_TOOLS,
} from "../packages/cli-model/src/agent-catalog";
import {
  PACKAGE_METADATA,
  RELEASE_METADATA,
} from "../packages/cli-model/src/release-metadata";

interface GeneratedFile {
  content: string;
  path: string;
}

interface ReleaseJson {
  assets: string[];
  channel: "local" | "release";
  docsUrl: string;
  exactInstallCommand: string;
  installCommand: string;
  releasedAt: string | null;
  releaseNotesUrl: string;
  supportedPlatforms: Array<{ arch: string; os: string }>;
  version: string;
}

const root = path.resolve(new URL("..", import.meta.url).pathname);
const PROTOCOL_RE = /^https?:\/\//u;
const TRAILING_SLASH_RE = /\/+$/u;

function urlWithProtocol(value: string): string {
  return PROTOCOL_RE.test(value) ? value : `https://${value}`;
}

function trimTrailingSlash(value: string): string {
  return value.replace(TRAILING_SLASH_RE, "");
}

function deploymentBaseUrl(): string {
  const value =
    process.env.PUBLIC_INSTALL_BASE_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    PACKAGE_METADATA.publicBaseUrl;
  return trimTrailingSlash(urlWithProtocol(value));
}

function repositorySlug(): string {
  if (process.env.GITHUB_REPOSITORY) {
    return process.env.GITHUB_REPOSITORY;
  }
  if (process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG) {
    return `${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}`;
  }
  return "f0rr0/tranquilo";
}

const baseUrl = deploymentBaseUrl();
const repository = repositorySlug();
const VERSION_DIR_RE = /^v\d+\.\d+\.\d+$/;
const VERSION_PREFIX_RE = /^v/u;
const LOCAL_RELEASE_LABEL = "local development build";
const LATEST_DOCS_RELEASE_RE =
  /(?:Latest )?CLI version: `(?<version>[^`]+)`[\s\S]*?Released: (?<releasedAt>[^\n]+)/u;
const DOC_PAGE_PATHS = [
  "index",
  "install",
  "auth",
  "househelp/index",
  "househelp/options",
  "househelp/find",
  "househelp/book",
  "househelp/watches",
  "manage/index",
  "manage/addresses",
  "manage/payments",
  "manage/bookings",
  "agents/index",
  "agents/codex",
  "agents/claude",
  "agents/mcp/index",
  "agents/mcp/tools",
] as const;

async function command(command: string, args: string[]): Promise<void> {
  const executable = command === "bun" ? process.execPath : command;
  const child = spawn(executable, args, {
    cwd: root,
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  const code = await new Promise<number | null>((resolve) => {
    child.on("close", resolve);
  });
  if (code !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with exit ${code}`);
  }
}

function tag(version = PACKAGE_METADATA.version): string {
  return version.startsWith("v") ? version : `v${version}`;
}

function versionParts(version: string): [number, number, number] {
  const parts = version.replace(VERSION_PREFIX_RE, "").split(".").map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function compareVersionTags(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  for (let index = 0; index < 3; index += 1) {
    const diff = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function existingReleasedAtForVersion(version: string): string | null {
  const candidates = [
    path.join(
      root,
      "packages/docs-content/versions",
      tag(version),
      "index.mdx"
    ),
  ];
  for (const candidate of candidates) {
    try {
      const text = fsSync.readFileSync(candidate, "utf8");
      const match = text.match(LATEST_DOCS_RELEASE_RE);
      const releasedAt = match?.groups?.releasedAt?.trim();
      if (
        match?.groups?.version === version &&
        releasedAt &&
        releasedAt !== LOCAL_RELEASE_LABEL
      ) {
        return releasedAt;
      }
    } catch {
      // This file does not exist during first-time generation.
    }
  }
  return null;
}

function releaseJson(): ReleaseJson {
  const tagName = tag();
  const releasedAt =
    process.env.TRANQUILO_RELEASED_AT ??
    existingReleasedAtForVersion(PACKAGE_METADATA.version);
  const channel = releasedAt ? "release" : "local";
  const docsPath = `/docs/versions/${tagName}`;

  return {
    assets: [
      ...RELEASE_METADATA.releaseAssetNames(RELEASE_METADATA.releaseTargets),
      "checksums.txt",
    ],
    channel,
    docsUrl: `${baseUrl}${docsPath}`,
    exactInstallCommand: `curl -fsSL ${baseUrl}/releases/${tagName}/install.sh | sh`,
    installCommand: `curl -fsSL ${baseUrl}/install.sh | sh`,
    releaseNotesUrl: `https://github.com/${repository}/releases/tag/${tagName}`,
    releasedAt,
    supportedPlatforms: RELEASE_METADATA.releaseTargets.map((target) => ({
      arch: target.arch,
      os: target.os,
    })),
    version: PACKAGE_METADATA.version,
  };
}

function yaml(value: string): string {
  return JSON.stringify(value);
}

function frontmatter({
  description,
  icon,
  sidebarTitle,
  title,
}: {
  description: string;
  icon: string;
  sidebarTitle?: string;
  title: string;
}): string {
  const lines = [
    "---",
    `title: ${yaml(title)}`,
    `description: ${yaml(description)}`,
    `icon: ${yaml(icon)}`,
  ];
  if (sidebarTitle) {
    lines.push(`sidebarTitle: ${yaml(sidebarTitle)}`);
  }
  return `${lines.join("\n")}\n---\n\n`;
}

const MAX_META_LINE_LENGTH = 80;

export function metaJson(
  value: Record<string, boolean | string | string[]>
): string {
  const entries = Object.entries(value);
  const lines = entries.map(([key, entry], index) => {
    const suffix = index === entries.length - 1 ? "" : ",";
    const prefix = `  ${JSON.stringify(key)}: `;
    if (!Array.isArray(entry)) {
      return `${prefix}${JSON.stringify(entry)}${suffix}`;
    }

    const inline = `[${entry.map((item) => JSON.stringify(item)).join(", ")}]`;
    if (`${prefix}${inline}${suffix}`.length <= MAX_META_LINE_LENGTH) {
      return `${prefix}${inline}${suffix}`;
    }

    const values = entry.map((item, itemIndex) => {
      const itemSuffix = itemIndex === entry.length - 1 ? "" : ",";
      return `    ${JSON.stringify(item)}${itemSuffix}`;
    });
    return [`${prefix}[`, ...values, `  ]${suffix}`].join("\n");
  });
  return `{\n${lines.join("\n")}\n}\n`;
}

function docsHref(pathName: string): string {
  return `/docs/versions/${tag()}/${pathName}`;
}

function sh(commandText: string): string {
  return `\`\`\`sh\n${commandText}\n\`\`\``;
}

function code(commandText: string): string {
  return `\`${commandText}\``;
}

function tableCell(value: string): string {
  return value.replaceAll("\n", " ").replaceAll("|", "\\|");
}

interface CliArgDoc {
  default?: unknown;
  description?: string;
  negativeDescription?: string;
  options?: readonly string[];
  required?: boolean;
  type?: string;
  valueHint?: string;
}

interface CliCommandDocNode {
  args?: Record<string, CliArgDoc>;
  meta?: {
    description?: string;
    name?: string;
  };
  subCommands?: Record<string, CliCommandDocNode>;
}

const cliRoot = mainCommand as CliCommandDocNode;

function cliCommandAt(pathParts: readonly string[]): CliCommandDocNode {
  let command: CliCommandDocNode = cliRoot;
  for (const part of pathParts) {
    const next = command.subCommands?.[part];
    if (!next) {
      throw new Error(`Unknown CLI command path: ${pathParts.join(" ")}`);
    }
    command = next;
  }
  return command;
}

function positionalArgs(command: CliCommandDocNode): string[] {
  return Object.entries(command.args ?? {})
    .filter(([, arg]) => arg.type === "positional")
    .map(([name]) => `<${name}>`);
}

function cliCommandLabel(pathParts: readonly string[]): string {
  const command = cliCommandAt(pathParts);
  return ["tranquilo", ...pathParts, ...positionalArgs(command)].join(" ");
}

function commandRows(paths: readonly (readonly string[])[]): string {
  const rows = paths
    .map((pathParts) => {
      const command = cliCommandAt(pathParts);
      return `| ${code(cliCommandLabel(pathParts))} | ${tableCell(command.meta?.description ?? "")} |`;
    })
    .join("\n");
  return `| Command | Description |\n| --- | --- |\n${rows}`;
}

function subcommandRows(pathParts: readonly string[]): string {
  const command = cliCommandAt(pathParts);
  const entries = Object.entries(command.subCommands ?? {});
  if (!entries.length) {
    return "This command has no subcommands.";
  }
  const rows = entries
    .map(([name, subcommand]) => {
      const childPath = [...pathParts, name];
      return `| ${code(cliCommandLabel(childPath))} | ${tableCell(subcommand.meta?.description ?? "")} |`;
    })
    .join("\n");
  return `| Subcommand | Description |\n| --- | --- |\n${rows}`;
}

function cliFlagName(name: string, arg: CliArgDoc): string {
  if (arg.type === "positional") {
    return `<${name}>`;
  }
  if (arg.type === "boolean") {
    const base = `--${name}`;
    return arg.default === true && arg.negativeDescription
      ? `${base} / --no-${name}`
      : base;
  }
  const hint = arg.valueHint ?? (arg.type === "enum" ? "value" : name);
  return `--${name} <${hint}>`;
}

function cliFlagDescription(arg: CliArgDoc): string {
  const details = [arg.description ?? ""];
  if (arg.negativeDescription) {
    details.push(`Negated form: ${arg.negativeDescription}.`);
  }
  if (arg.options?.length) {
    details.push(
      `Allowed values: ${arg.options.map((option) => code(option)).join(", ")}.`
    );
  }
  if (arg.default !== undefined) {
    details.push(`Default: ${code(String(arg.default))}.`);
  }
  return details.filter(Boolean).join(" ");
}

function flagRows(
  pathParts: readonly string[],
  options: { includePositional?: boolean } = {}
): string {
  const command = cliCommandAt(pathParts);
  const args = Object.entries(command.args ?? {}).filter(
    ([, arg]) => options.includePositional || arg.type !== "positional"
  );
  if (!args.length) {
    return "This command has no documented flags.";
  }
  const rows = args
    .map(
      ([name, arg]) =>
        `| ${code(cliFlagName(name, arg))} | ${arg.required ? "Yes" : "No"} | ${tableCell(cliFlagDescription(arg))} |`
    )
    .join("\n");
  return `| Flag | Required | Description |\n| --- | --- | --- |\n${rows}`;
}

function mcpReference(): string {
  const rows = MCP_TOOLS.map((tool) => {
    const cliFallback = "cliFallback" in tool ? tool.cliFallback : undefined;
    return `| ${code(tool.name)} | ${
      tool.annotations.readOnlyHint ? "Read-only" : "Mutating"
    } | ${cliFallback ? code(cliFallback) : "MCP only"} | ${tableCell(tool.description)} |`;
  }).join("\n");
  return `${frontmatter({
    description: "Agent-callable MCP tools exposed by tranquilo mcp.",
    icon: "plug",
    title: "MCP tools",
  })}
Agents should prefer MCP tools over shelling out to the CLI. Mutating tools require explicit user intent and structured arguments.

| Tool | Safety | CLI fallback | Description |
| --- | --- | --- | --- |
${rows}
`;
}

function installPage(metadata: ReleaseJson): string {
  return `${frontmatter({
    description:
      "Install Tranquilo, verify it, and configure local AI integrations.",
    icon: "download",
    title: "Install",
  })}
CLI version: ${code(metadata.version)}

${sh(metadata.installCommand)}

<Steps>
  <Step title="Install">
    Paste the installer into a local terminal. It detects macOS, Linux, or bash-on-Windows, verifies checksums, installs the binary, and configures supported local AI integrations when available.
  </Step>
  <Step title="Login">
    Run ${code("tranquilo login")} in your terminal, or ask a local agent to log in and provide the phone number and Pronto OTP when prompted.
  </Step>
  <Step title="Verify">
    Run ${code("tranquilo doctor")} and ${code("tranquilo status")} to confirm local setup.
  </Step>
</Steps>

## Exact version

Use the exact-version installer when you need reproducible docs and binary behavior.

${sh(metadata.exactInstallCommand)}

## Update

${sh("tranquilo update check\ntranquilo update")}

## Agent setup and updates

${commandRows([["install-agent"], ["update"], ["update", "check"]])}

### Install-agent arguments

${flagRows(["install-agent"], { includePositional: true })}
`;
}

function indexPage(metadata: ReleaseJson): string {
  const released = metadata.releasedAt ?? LOCAL_RELEASE_LABEL;
  return `${frontmatter({
    description:
      "Local CLI and MCP wrapper for Pronto House Help booking flows.",
    icon: "sparkles",
    title: "Tranquilo",
  })}
Tranquilo is the local CLI and MCP wrapper around Pronto House Help booking flows. It is built for terminal-native users and agents that need to find transient maid / house help slots, prepare bookings, and hand payment back to the user locally.

<Note>
  There is no user-facing Tranquilo app. When referring to the mobile app, say Pronto app.
</Note>

CLI version: ${code(metadata.version)}

Released: ${released}

${sh(metadata.installCommand)}

<Cards>
  <Card title="Install" icon="download" href="${docsHref("install")}">
    Install the CLI and configure local AI integrations.
  </Card>
  <Card title="Book House Help" icon="calendar-check" href="${docsHref("househelp")}">
    Find slots by duration, dates, and working-hour preferences.
  </Card>
  <Card title="Use with agents" icon="bot" href="${docsHref("agents")}">
    Learn the safe MCP and CLI surfaces for Codex and Claude.
  </Card>
  <Card title="MCP tools" icon="plug" href="${docsHref("agents/mcp/tools")}">
    See the structured tools agents should call.
  </Card>
</Cards>
`;
}

function authPage(): string {
  return `${frontmatter({
    description: "Login, credential storage, and local status commands.",
    icon: "key-round",
    title: "Auth",
  })}
Tranquilo authenticates with Pronto using the phone OTP flow captured from the app. Credentials are stored in an encrypted local file under Tranquilo's state directory, with non-secret config in the local app config directory.

<Warning>
  OTP is allowed only for the Tranquilo login flow. Agents may ask for your phone number and Pronto OTP, then call ${code("auth_login_start")} and ${code("auth_login_verify")}. Never paste access tokens, refresh tokens, UPI details, or payment data into chat.
</Warning>

## Local commands

${commandRows([["login"], ["logout"], ["status"], ["whoami"], ["doctor"]])}

### Login flags

${flagRows(["login"])}

### Login subcommands

${subcommandRows(["login"])}

### Login start flags

${flagRows(["login", "start"])}

### Login verify flags

${flagRows(["login", "verify"])}

### Status flags

${flagRows(["status"])}

### Doctor flags

${flagRows(["doctor"])}

Use ${code("tranquilo status --json --no-interactive")} only as a CLI fallback for agents when MCP is unavailable.
`;
}

function househelpIndexPage(): string {
  return `${frontmatter({
    description:
      "End-to-end flow for finding and booking Pronto House Help slots.",
    icon: "calendar-search",
    title: "Book House Help",
  })}
House Help is the primary Tranquilo workflow. The CLI discovers the durations and listing IDs currently exposed by the backend, ranks live slots, then creates checkout only after a specific slot and duration are selected.

<Steps>
  <Step title="Choose a location">
    Use ${code("tranquilo addresses list")} to see saved addresses and ${code("tranquilo addresses use <address-id>")} to set the active delivery/cart address.
  </Step>
  <Step title="Find available options">
    Use ${code("tranquilo househelp options")} to inspect backend-supported durations and prices for that location.
  </Step>
  <Step title="Search slots">
    Use ${code("tranquilo househelp find")} with duration, date, and window preferences. Slots are transient and should be rechecked immediately before checkout.
  </Step>
  <Step title="Book and pay">
    Use ${code("tranquilo househelp book --pay --open-qr --upi-app phonepe")} in a local terminal after confirming the exact slot. The QR flow is local and user-facing, and the selected UPI app is remembered.
  </Step>
</Steps>

<Tip>
  For busy employees, start with ${code("--window after-work")} or ${code("--time-window 18:00-22:00")}. Use ${code("--duration-order")} when a shorter fallback is acceptable.
</Tip>

## House Help subcommands

${subcommandRows(["househelp"])}
`;
}

function househelpOptionsPage(): string {
  return `${frontmatter({
    description: "Discover backend-supported House Help durations and prices.",
    icon: "list-checks",
    title: "Options",
  })}
Options are not hardcoded. Tranquilo reads the current Pronto listing response for the selected location and uses those listing IDs when searching slots and preparing checkout.

${sh("tranquilo househelp options\ntranquilo househelp options --address-id 990330 --json --no-interactive")}

## Flags

${flagRows(["househelp", "options"])}

## Output

The JSON response includes duration, listing id, listing item id, effective price, savings, serviceability, and location source.
`;
}

function househelpFindPage(): string {
  return `${frontmatter({
    description:
      "Find live House Help slots with flexible dates, durations, and time windows.",
    icon: "search",
    title: "Find slots",
  })}
Slot search is read-only. It does not mutate the cart and does not create checkout.

<Tabs items={["After work", "Exact time", "Fallback durations"]}>
  <Tab value="After work">
${sh("tranquilo househelp find --duration 60 --preset next-4-days --window after-work")}
  </Tab>
  <Tab value="Exact time">
${sh("tranquilo househelp find --duration 60 --exact-date 2026-04-23 --exact-time 13:00 --exact-duration")}
  </Tab>
  <Tab value="Fallback durations">
${sh("tranquilo househelp find --duration-order 60,90,30 --preset next-4-days --time-window 18:00-22:00")}
  </Tab>
</Tabs>

## Flags

${flagRows(["househelp", "find"])}

## Booking horizon

${AGENT_CATALOG.validBookingHorizon} Searches reject past times and dates outside that horizon.

## Location precedence

1. Explicit ${code("--lat")} and ${code("--lng")}.
2. Explicit ${code("--address-id")}.
3. Active cart delivery address.
4. Saved profile default or first saved address as fallback.
`;
}

function househelpBookPage(): string {
  return `${frontmatter({
    description: "Create checkout, render QR payment, and finalize booking.",
    icon: "badge-check",
    title: "Book",
  })}
Booking is a mutating local-terminal flow. Tranquilo rechecks the selected slot, sets the correct cart item, creates checkout, prints a QR/payment page handoff when available, polls payment, and finalizes the Pronto booking.

${sh('tranquilo househelp book --duration 60 --slot "tomorrow 6pm" --address-id 990330 --pay --open-qr --upi-app phonepe')}

<Warning>
  Slots are highly transient. A slot found earlier is not reliable later; Tranquilo revalidates before checkout and stops if the backend reports the slot is stale or overbooked.
</Warning>

## Flags

${flagRows(["househelp", "book"])}

## Agent behavior

Local terminal agents may run this command after the user says to book and confirms any ambiguity. In Codex CLI, include ${code("--open-qr")} so the saved PNG opens in the local image viewer instead of depending on expanded terminal output. If no UPI preference exists, ask the user whether to use PhonePe, Google Pay, or Paytm and pass the answer as ${code("--upi-app")}. Hosted or web agents should use MCP to prepare a handoff and tell the user to complete payment locally.
`;
}

function watchesPage(): string {
  return `${frontmatter({
    description: "Notify-only slot watches for transient House Help slots.",
    icon: "bell",
    title: "Watches",
  })}
Watches poll for slots without keeping a resident JavaScript daemon in memory. Tranquilo installs one per-user OS timer and runs short-lived checks.

<Note>
  Watches are notify-only. They do not create checkout and do not pay automatically.
</Note>

Watch creation persists the House Help filters you pass. ${code("--date")} and ${code("--exact-date")} create one-day watches, ${code("--exact-time")} and ${code("--exact-slot")} create exact start-time windows, and ${code("--around")} with ${code("--flex-days")} becomes a concrete date range. A watch can store one custom ${code("--time-window")}; create separate watches for multiple custom windows.

${sh("tranquilo househelp watch create --duration 60 --preset next-4-days --time-window 18:00-22:00 --address-id 990330\ntranquilo househelp watch scheduler install")}

## Watch subcommands

${subcommandRows(["househelp", "watch"])}

## Create flags

${flagRows(["househelp", "watch", "create"])}

## Book found watch

${flagRows(["househelp", "watch", "book"], { includePositional: true })}

## Scheduler subcommands

${subcommandRows(["househelp", "watch", "scheduler"])}

## Notifications

Desktop notifications are best-effort. Slack notifications are available with ${code("--slack-webhook <url>")}. Use ${code("tranquilo househelp watch show <watch-id>")} to inspect persisted matches if a notification is missed.
`;
}

function managePage(): string {
  return `${frontmatter({
    description:
      "Manage saved addresses, payment handoffs, and Pronto booking history.",
    icon: "settings",
    title: "Manage",
  })}
Use this section for the Pronto context around House Help booking: saved addresses, checkout payment state, and booking history.

<Cards>
  <Card title="Addresses" icon="map-pin" href="${docsHref("manage/addresses")}">
    List saved addresses and choose the active delivery/cart address used for slot search and booking.
  </Card>
  <Card title="Payments" icon="qr-code" href="${docsHref("manage/payments")}">
    Render local QR payment flows and inspect prepared checkout orders.
  </Card>
  <Card title="Bookings" icon="calendar-days" href="${docsHref("manage/bookings")}">
    Inspect upcoming, past, or all Pronto bookings.
  </Card>
</Cards>
`;
}

function addressesPage(): string {
  return `${frontmatter({
    description:
      "Saved addresses and the active delivery/cart address used by bookings.",
    icon: "map-pin",
    title: "Addresses",
  })}
Pronto address selection for booking is a cart mutation. ${code("tranquilo addresses use <address-id>")} sets the active delivery/cart address; it does not change a profile-level default.

${sh("tranquilo addresses list\ntranquilo addresses use 990330\ntranquilo addresses show 990330")}

## Subcommands

${subcommandRows(["addresses"])}

## List flags

${flagRows(["addresses", "list"])}

## Show flags

${flagRows(["addresses", "show"], { includePositional: true })}

## Use flags

${flagRows(["addresses", "use"], { includePositional: true })}

## Agent-safe fallback

Agents should prefer MCP tools. If MCP is unavailable, use structured CLI output:

${sh("tranquilo addresses list --json --no-interactive\ntranquilo addresses show <address-id> --json --no-interactive\ntranquilo addresses use <address-id> --json --no-interactive")}
`;
}

function paymentsPage(): string {
  return `${frontmatter({
    description: "QR-first local payment flow for prepared checkout orders.",
    icon: "qr-code",
    title: "Payments",
  })}
Payment is user-local. Tranquilo routes direct UPI payment through a user-selected UPI app, renders a QR/link from Juspay, then polls payment status and calls Pronto finalization after a successful charge.

${sh("tranquilo checkout pay <order-id> --open-qr --upi-app phonepe")}

Allowed UPI apps are ${code("phonepe")}, ${code("googlepay")}, and ${code("paytm")}. The first selection is stored locally and reused for later payments; pass ${code("--upi-app")} again to change it.

Use ${code("--open-qr")} in terminal agents such as Codex CLI. Tranquilo still prints the terminal QR and saved PNG path, but opening the PNG is the most reliable way to make the QR visible when long command output is collapsed.

<Warning>
  Do not run ${code("--open-intent")} from an agent unless the user explicitly asks for local OS/app opening. It is intentionally not part of the default agent-safe flow.
</Warning>

## Checkout subcommands

${subcommandRows(["checkout"])}

## Pay flags

${flagRows(["checkout", "pay"], { includePositional: true })}

## Status flags

${flagRows(["checkout", "status"], { includePositional: true })}
`;
}

function bookingsPage(): string {
  return `${frontmatter({
    description: "Inspect upcoming, past, or all Pronto bookings.",
    icon: "calendar-days",
    title: "Bookings",
  })}
Use booking history for inspection. Cancellation and rescheduling are intentionally not shipped until their API contracts are captured and validated.

${sh("tranquilo bookings list --status upcoming\ntranquilo bookings list --status all --page 2 --json --no-interactive")}

## Flags

${flagRows(["bookings", "list"])}
`;
}

function agentsIndexPage(): string {
  return `${frontmatter({
    description: "Safe Tranquilo usage from Codex, Claude, and MCP clients.",
    icon: "bot",
    title: "Agents",
  })}
${AGENT_CATALOG.productLanguage}

Agents should use MCP first. CLI JSON fallback is available when MCP is unavailable.

<Steps>
  <Step title="Check auth">
    Call ${code("auth_status")} first. If unauthenticated, ask for the user's phone number, call ${code("auth_login_start")}, ask for the Pronto OTP, then call ${code("auth_login_verify")}.
  </Step>
  <Step title="Resolve address">
    List addresses and use the active delivery/cart address unless the user asks for another saved address.
  </Step>
  <Step title="Find slots">
    Use ${code("househelp_find_slots")} for natural requests like "find a maid tomorrow after 6pm".
  </Step>
  <Step title="Ask before booking">
    Confirm duration, slot, and UPI app before creating checkout. Payment QR rendering is local-terminal behavior.
  </Step>
</Steps>

## Boundaries

- OTP is allowed only for Tranquilo login after ${code("auth_login_start")}. Do not ask users to paste access tokens, refresh tokens, UPI details, or payment details into chat.
- Do not call payment app opening flows unless the user explicitly asks from a local terminal.
- Do not claim there is a Tranquilo mobile app; say Pronto app.
`;
}

function codexPage(): string {
  return `${frontmatter({
    description: "Install and use the Codex skill plus local MCP server.",
    icon: "code",
    title: "Codex",
  })}
Install agent support with:

${sh("tranquilo install-agent codex")}

The installer writes the Tranquilo skill and configures the local MCP server when Codex is available. In chat, users should be able to say things like "find a maid for tomorrow after 6pm" rather than naming commands.
`;
}

function claudePage(): string {
  return `${frontmatter({
    description:
      "Install and use Tranquilo with Claude Code or Claude Desktop.",
    icon: "message-square",
    title: "Claude",
  })}
Install agent support with:

${sh("tranquilo install-agent claude-code\ntranquilo install-agent claude-desktop")}

Claude Code uses user-scoped MCP configuration and optional slash commands. Claude Desktop uses the MCPB bundle for local extension install.
`;
}

function mcpPage(): string {
  return `${frontmatter({
    description: "Run and inspect the local Tranquilo MCP server.",
    icon: "plug",
    title: "MCP",
  })}
The local MCP server exposes structured tools for agents. It is the preferred AI integration surface because schemas, annotations, and read-only/mutating hints are explicit.

${sh("tranquilo mcp")}

See [MCP tools](${docsHref("agents/mcp/tools")}) for the generated tool list.
`;
}

function llmsText(metadata: ReleaseJson): string {
  const docsPath = metadata.docsUrl.startsWith(baseUrl)
    ? metadata.docsUrl.slice(baseUrl.length)
    : `/docs/versions/${tag()}`;
  const page = (pathName: string) => `${docsPath}/${pathName}`;
  const lines = [
    "# Tranquilo",
    "",
    `Latest version: ${metadata.version}`,
    `Install: ${baseUrl}/install.sh`,
    `Docs: ${metadata.docsUrl}`,
    `Skill: ${baseUrl}/docs/skill.md`,
    "",
    "## Pages",
    "",
    `- Overview: ${docsPath}`,
    `- Install: ${page("install")}`,
    `- Auth: ${page("auth")}`,
    `- Book House Help: ${page("househelp")}`,
    `- Find slots: ${page("househelp/find")}`,
    `- Watches: ${page("househelp/watches")}`,
    `- Manage: ${page("manage")}`,
    `- Addresses: ${page("manage/addresses")}`,
    `- Payments: ${page("manage/payments")}`,
    `- Agent usage: ${page("agents")}`,
    `- MCP tools: ${page("agents/mcp/tools")}`,
    "",
  ];
  return lines.join("\n");
}

async function versionHasDocs(version: string): Promise<boolean> {
  const checks = DOC_PAGE_PATHS.map((page) =>
    fs
      .access(
        path.join(
          root,
          "packages/docs-content/versions",
          version,
          `${page}.mdx`
        )
      )
      .then(() => true)
      .catch(() => false)
  );
  return (await Promise.all(checks)).every(Boolean);
}

async function existingVersionTags(): Promise<string[]> {
  const versionsDir = path.join(root, "packages/docs-content/versions");
  const allVersions = new Set(
    (await fs.readdir(versionsDir).catch(() => [] as string[])).filter(
      (entry) => VERSION_DIR_RE.test(entry)
    )
  );
  allVersions.add(tag());
  const sortedVersions = [...allVersions].sort(compareVersionTags).reverse();
  const versionTags: string[] = [];
  for (const version of sortedVersions) {
    if (version === tag() || (await versionHasDocs(version))) {
      versionTags.push(version);
    }
  }
  return versionTags;
}

function docsRootMeta(): string {
  return metaJson({
    title: "Tranquilo Docs",
    pages: ["versions"],
  });
}

async function versionsMeta(): Promise<string> {
  return metaJson({
    title: "Versions",
    pages: await existingVersionTags(),
  });
}

function versionRootMeta(title: string): string {
  return metaJson({
    title,
    root: true,
    defaultOpen: true,
    pages: ["index", "install", "auth", "househelp", "manage", "agents"],
  });
}

function househelpMeta(): string {
  return metaJson({
    title: "Book House Help",
    icon: "calendar-search",
    defaultOpen: true,
    pages: ["options", "find", "book", "watches"],
  });
}

function manageMeta(): string {
  return metaJson({
    title: "Manage",
    icon: "settings",
    defaultOpen: true,
    pages: ["addresses", "payments", "bookings"],
  });
}

function agentsMeta(): string {
  return metaJson({
    title: "AI agents",
    icon: "bot",
    defaultOpen: true,
    pages: ["codex", "claude", "mcp"],
  });
}

function mcpMeta(): string {
  return metaJson({
    title: "MCP",
    icon: "plug",
    defaultOpen: true,
    pages: ["tools"],
  });
}

async function existingVersionMetaFiles(): Promise<GeneratedFile[]> {
  const files: GeneratedFile[] = [
    {
      path: "packages/docs-content/versions/meta.json",
      content: await versionsMeta(),
    },
  ];
  for (const version of await existingVersionTags()) {
    files.push(
      {
        path: `packages/docs-content/versions/${version}/meta.json`,
        content: versionRootMeta(version),
      },
      {
        path: `packages/docs-content/versions/${version}/househelp/meta.json`,
        content: househelpMeta(),
      },
      {
        path: `packages/docs-content/versions/${version}/manage/meta.json`,
        content: manageMeta(),
      },
      {
        path: `packages/docs-content/versions/${version}/agents/meta.json`,
        content: agentsMeta(),
      },
      {
        path: `packages/docs-content/versions/${version}/agents/mcp/meta.json`,
        content: mcpMeta(),
      }
    );
  }
  return files;
}

async function generatedFiles(): Promise<GeneratedFile[]> {
  const metadata = releaseJson();
  const currentDocsDir = `packages/docs-content/versions/${tag()}`;
  const skill = await fs
    .readFile(path.join(root, "apps/cli/assets/codex-skill/SKILL.md"), "utf8")
    .catch(() => "");

  return [
    {
      path: "apps/site/generated/release.json",
      content: `${JSON.stringify(metadata, null, 2)}\n`,
    },
    {
      path: "apps/site/generated/skill.ts",
      content: `export const skillMarkdown = ${JSON.stringify(skill)};\n`,
    },
    {
      path: "packages/docs-content/meta.json",
      content: docsRootMeta(),
    },
    {
      path: `${currentDocsDir}/meta.json`,
      content: versionRootMeta(tag()),
    },
    {
      path: `${currentDocsDir}/index.mdx`,
      content: indexPage(metadata),
    },
    {
      path: `${currentDocsDir}/install.mdx`,
      content: installPage(metadata),
    },
    {
      path: `${currentDocsDir}/auth.mdx`,
      content: authPage(),
    },
    {
      path: `${currentDocsDir}/househelp/index.mdx`,
      content: househelpIndexPage(),
    },
    {
      path: `${currentDocsDir}/househelp/meta.json`,
      content: househelpMeta(),
    },
    {
      path: `${currentDocsDir}/househelp/options.mdx`,
      content: househelpOptionsPage(),
    },
    {
      path: `${currentDocsDir}/househelp/find.mdx`,
      content: househelpFindPage(),
    },
    {
      path: `${currentDocsDir}/househelp/book.mdx`,
      content: househelpBookPage(),
    },
    {
      path: `${currentDocsDir}/househelp/watches.mdx`,
      content: watchesPage(),
    },
    {
      path: `${currentDocsDir}/manage/index.mdx`,
      content: managePage(),
    },
    {
      path: `${currentDocsDir}/manage/meta.json`,
      content: manageMeta(),
    },
    {
      path: `${currentDocsDir}/manage/addresses.mdx`,
      content: addressesPage(),
    },
    {
      path: `${currentDocsDir}/manage/payments.mdx`,
      content: paymentsPage(),
    },
    {
      path: `${currentDocsDir}/manage/bookings.mdx`,
      content: bookingsPage(),
    },
    {
      path: `${currentDocsDir}/agents/index.mdx`,
      content: agentsIndexPage(),
    },
    {
      path: `${currentDocsDir}/agents/meta.json`,
      content: agentsMeta(),
    },
    {
      path: `${currentDocsDir}/agents/codex.mdx`,
      content: codexPage(),
    },
    {
      path: `${currentDocsDir}/agents/claude.mdx`,
      content: claudePage(),
    },
    {
      path: `${currentDocsDir}/agents/mcp/index.mdx`,
      content: mcpPage(),
    },
    {
      path: `${currentDocsDir}/agents/mcp/meta.json`,
      content: mcpMeta(),
    },
    {
      path: `${currentDocsDir}/agents/mcp/tools.mdx`,
      content: mcpReference(),
    },
    {
      path: "packages/docs-content/skill.md",
      content: skill,
    },
    {
      path: "packages/docs-content/llms.txt",
      content: llmsText(metadata),
    },
    ...(await existingVersionMetaFiles()),
  ];
}

async function writeGenerated(file: GeneratedFile): Promise<void> {
  const absolute = path.join(root, file.path);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, file.content);
}

async function run(): Promise<void> {
  await command("bun", ["--filter=tranquilo", "run", "agent-assets:generate"]);

  for (const file of await generatedFiles()) {
    await writeGenerated(file);
  }
}

if (import.meta.main) {
  await run();
}
