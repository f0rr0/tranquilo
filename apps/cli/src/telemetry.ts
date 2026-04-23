import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_METADATA } from "@tranquilo/cli-model/release-metadata";
import { telemetryStatePath } from "./paths";

type TelemetryEventName = "booking_confirmed" | "install_succeeded";
type TelemetryPreferenceSource = "command" | "notice";

interface PendingTelemetryEvent {
  event: TelemetryEventName;
  key: string;
  properties: Record<string, boolean | number | string>;
  queuedAt: string;
}

interface TelemetryState {
  anonymousId?: string | undefined;
  confirmedBookingOrders: Record<string, string>;
  disabledAt?: string | undefined;
  enabled?: boolean | undefined;
  enabledAt?: string | undefined;
  installRecordedAt?: string | undefined;
  noticeShownAt?: string | undefined;
  pending: PendingTelemetryEvent[];
  version: 1;
}

interface TelemetryEnvelope {
  anonymousId: string;
  event: TelemetryEventName;
  properties: Record<string, boolean | number | string>;
  queuedAt: string;
}

interface TelemetryStatus {
  anonymousId?: string | undefined;
  debug: boolean;
  disabledByEnv: boolean;
  effectiveEnabled: boolean;
  enabled: boolean | undefined;
  noticeShownAt?: string | undefined;
  pendingEvents: number;
}

const STATE_VERSION = 1;
const MAX_PENDING_EVENTS = 32;
const MAX_RECORDED_BOOKINGS = 256;
const BOOKING_RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 1200;
const SCRIPT_ENTRY_RE = /\.(c|m)?[jt]s$/u;

function telemetryUrl(): string {
  return (
    process.env.TRANQUILO_TELEMETRY_URL ??
    `${PACKAGE_METADATA.publicBaseUrl}/api/cli/telemetry`
  );
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeBooleanEnv(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true";
}

function telemetryDisabledByEnv(): boolean {
  return (
    Boolean(process.env.CI) ||
    normalizeBooleanEnv(process.env.TRANQUILO_NO_TELEMETRY) ||
    normalizeBooleanEnv(process.env.TRANQUILO_TELEMETRY_DISABLED) ||
    normalizeBooleanEnv(process.env.DO_NOT_TRACK) ||
    normalizeBooleanEnv(process.env.DNT)
  );
}

function telemetryDebugEnabled(): boolean {
  return normalizeBooleanEnv(process.env.TRANQUILO_TELEMETRY_DEBUG);
}

function emptyState(): TelemetryState {
  return {
    confirmedBookingOrders: {},
    pending: [],
    version: STATE_VERSION,
  };
}

function telemetryState(value: unknown): TelemetryState {
  const state = value && typeof value === "object" ? value : {};
  const pending = Array.isArray((state as { pending?: unknown }).pending)
    ? ((state as { pending?: PendingTelemetryEvent[] }).pending ?? [])
    : [];
  const confirmedBookingOrders =
    (state as { confirmedBookingOrders?: Record<string, string> })
      .confirmedBookingOrders ?? {};
  return pruneState({
    anonymousId:
      typeof (state as { anonymousId?: unknown }).anonymousId === "string"
        ? (state as { anonymousId: string }).anonymousId
        : undefined,
    confirmedBookingOrders,
    disabledAt:
      typeof (state as { disabledAt?: unknown }).disabledAt === "string"
        ? (state as { disabledAt: string }).disabledAt
        : undefined,
    enabled:
      typeof (state as { enabled?: unknown }).enabled === "boolean"
        ? (state as { enabled: boolean }).enabled
        : undefined,
    enabledAt:
      typeof (state as { enabledAt?: unknown }).enabledAt === "string"
        ? (state as { enabledAt: string }).enabledAt
        : undefined,
    installRecordedAt:
      typeof (state as { installRecordedAt?: unknown }).installRecordedAt ===
      "string"
        ? (state as { installRecordedAt: string }).installRecordedAt
        : undefined,
    noticeShownAt:
      typeof (state as { noticeShownAt?: unknown }).noticeShownAt === "string"
        ? (state as { noticeShownAt: string }).noticeShownAt
        : undefined,
    pending: pending.filter(isPendingTelemetryEvent),
    version: STATE_VERSION,
  });
}

function isPendingTelemetryEvent(
  value: unknown
): value is PendingTelemetryEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = (value as { event?: unknown }).event;
  const key = (value as { key?: unknown }).key;
  const queuedAt = (value as { queuedAt?: unknown }).queuedAt;
  const properties = (value as { properties?: unknown }).properties;
  return (
    (event === "booking_confirmed" || event === "install_succeeded") &&
    typeof key === "string" &&
    typeof queuedAt === "string" &&
    properties !== null &&
    typeof properties === "object" &&
    !Array.isArray(properties)
  );
}

function pruneState(state: TelemetryState): TelemetryState {
  const cutoff = Date.now() - BOOKING_RETENTION_MS;
  const confirmedBookingOrders = Object.fromEntries(
    Object.entries(state.confirmedBookingOrders)
      .filter(([, sentAt]) => {
        const timestamp = Date.parse(sentAt);
        return Number.isFinite(timestamp) && timestamp >= cutoff;
      })
      .slice(-MAX_RECORDED_BOOKINGS)
  );
  return {
    ...state,
    confirmedBookingOrders,
    pending: state.pending.slice(-MAX_PENDING_EVENTS),
    version: STATE_VERSION,
  };
}

async function loadTelemetryState(): Promise<TelemetryState> {
  try {
    return telemetryState(
      JSON.parse(await fs.readFile(telemetryStatePath(), "utf8"))
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return emptyState();
    }
    return emptyState();
  }
}

async function saveTelemetryState(state: TelemetryState): Promise<void> {
  const file = telemetryStatePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(pruneState(state), null, 2)}\n`, {
    mode: 0o600,
  });
}

function ensureAnonymousId(state: TelemetryState): string {
  if (!state.anonymousId) {
    state.anonymousId = `anon_${crypto.randomUUID()}`;
  }
  return state.anonymousId;
}

function baseProperties(): Record<string, boolean | number | string> {
  return {
    arch: process.arch,
    cliVersion: PACKAGE_METADATA.version,
    os: process.platform,
  };
}

function noticeEligible(rawArgs: string[]): boolean {
  if (telemetryDisabledByEnv()) {
    return false;
  }
  if (!(process.stdout.isTTY && process.stderr.isTTY)) {
    return false;
  }
  if (rawArgs.includes("--json") || rawArgs.includes("--no-interactive")) {
    return false;
  }
  const [first, second] = rawArgs;
  if (!first) {
    return false;
  }
  if (["install-agent", "mcp", "telemetry"].includes(first)) {
    return false;
  }
  if (first === "checkout" && second === "pay") {
    return false;
  }
  return true;
}

function autoFlushEligible(rawArgs: string[]): boolean {
  if (telemetryDisabledByEnv() || telemetryDebugEnabled()) {
    return false;
  }
  if (process.env.TRANQUILO_TELEMETRY_FLUSHING === "1") {
    return false;
  }
  const [first] = rawArgs;
  if (first === "telemetry") {
    return false;
  }
  return true;
}

function telemetryCommand(): { args: string[]; command: string } {
  const entry = process.argv[1];
  if (entry && SCRIPT_ENTRY_RE.test(entry)) {
    return { args: [entry], command: process.argv[0] ?? process.execPath };
  }
  return {
    args: [],
    command: process.execPath || process.argv[0] || "tranquilo",
  };
}

function telemetryNotice(): string {
  return [
    "Tranquilo can send anonymized usage telemetry to improve the CLI.",
    "Collected events are limited to successful installs and confirmed bookings, and use a random local installation ID.",
    "Included fields are limited to CLI version, OS, CPU architecture, and booking duration.",
    "Tranquilo never sends addresses, booking IDs, order IDs, slot times, payment URIs, auth tokens, file paths, or command arguments.",
    "Disable: `tranquilo telemetry disable` or `TRANQUILO_NO_TELEMETRY=1`.",
    "Preview without sending: `TRANQUILO_TELEMETRY_DEBUG=1`.",
    "",
  ].join("\n");
}

function eventKey(event: TelemetryEventName, discriminator?: string): string {
  return discriminator ? `${event}:${discriminator}` : event;
}

function canQueue(state: TelemetryState, key: string): boolean {
  if (state.pending.some((pending) => pending.key === key)) {
    return false;
  }
  if (key === "install_succeeded" && state.installRecordedAt) {
    return false;
  }
  if (key.startsWith("booking_confirmed:")) {
    const [, orderId] = key.split(":", 2);
    return Boolean(orderId && !state.confirmedBookingOrders[orderId]);
  }
  return true;
}

async function queueEvent(
  event: TelemetryEventName,
  key: string,
  properties: Record<string, boolean | number | string>
): Promise<void> {
  if (telemetryDisabledByEnv()) {
    return;
  }
  const state = await loadTelemetryState();
  if (state.enabled === false) {
    return;
  }
  if (!canQueue(state, key)) {
    return;
  }
  ensureAnonymousId(state);
  state.pending.push({
    event,
    key,
    properties: { ...baseProperties(), ...properties },
    queuedAt: nowIso(),
  });
  await saveTelemetryState(state);
}

export async function recordInstallSuccess(
  options: { agentTarget?: string | undefined } = {}
): Promise<void> {
  await queueEvent("install_succeeded", eventKey("install_succeeded"), {
    ...(options.agentTarget ? { agentTarget: options.agentTarget } : {}),
    transport: "install_sh",
  });
}

export async function recordBookingConfirmed(options: {
  durationMinutes?: number | undefined;
  orderId: string;
}): Promise<void> {
  await queueEvent(
    "booking_confirmed",
    eventKey("booking_confirmed", options.orderId),
    {
      ...(typeof options.durationMinutes === "number"
        ? { durationMinutes: options.durationMinutes }
        : {}),
    }
  );
}

async function setEnabled(
  enabled: boolean,
  source: TelemetryPreferenceSource
): Promise<TelemetryStatus> {
  const state = await loadTelemetryState();
  state.enabled = enabled;
  if (enabled) {
    ensureAnonymousId(state);
    state.disabledAt = undefined;
    state.enabledAt = nowIso();
    if (source === "notice") {
      state.noticeShownAt = state.noticeShownAt ?? state.enabledAt;
    }
  } else {
    state.disabledAt = nowIso();
    state.pending = [];
  }
  await saveTelemetryState(state);
  return telemetryStatusFromState(state);
}

function telemetryStatusFromState(state: TelemetryState): TelemetryStatus {
  const disabledByEnv = telemetryDisabledByEnv();
  return {
    anonymousId: state.anonymousId,
    debug: telemetryDebugEnabled(),
    disabledByEnv,
    effectiveEnabled: !disabledByEnv && state.enabled === true,
    enabled: state.enabled,
    noticeShownAt: state.noticeShownAt,
    pendingEvents: state.pending.length,
  };
}

export async function telemetryStatus(): Promise<TelemetryStatus> {
  return telemetryStatusFromState(await loadTelemetryState());
}

export function enableTelemetry(): Promise<TelemetryStatus> {
  return setEnabled(true, "command");
}

export function disableTelemetry(): Promise<TelemetryStatus> {
  return setEnabled(false, "command");
}

export async function maybeShowTelemetryNotice(rawArgs: string[]): Promise<{
  justEnabled: boolean;
}> {
  if (!noticeEligible(rawArgs)) {
    return { justEnabled: false };
  }
  const state = await loadTelemetryState();
  if (state.enabled !== undefined || state.noticeShownAt) {
    return { justEnabled: false };
  }
  process.stderr.write(telemetryNotice());
  await setEnabled(true, "notice");
  return { justEnabled: true };
}

export async function maybeStartBackgroundTelemetryFlush(
  rawArgs: string[]
): Promise<void> {
  if (!autoFlushEligible(rawArgs)) {
    return;
  }
  const state = await loadTelemetryState();
  if (!(state.enabled === true && state.pending.length > 0)) {
    return;
  }
  try {
    const { args, command } = telemetryCommand();
    const child = spawn(command, [...args, "telemetry", "flush"], {
      detached: true,
      env: {
        ...process.env,
        TRANQUILO_NO_UPDATE_CHECK: "1",
        TRANQUILO_TELEMETRY_FLUSHING: "1",
      },
      stdio: "ignore",
    });
    child.unref();
  } catch {
    // best effort
  }
}

function debugOutput(events: TelemetryEnvelope[]): void {
  for (const event of events) {
    process.stderr.write(
      `[telemetry] ${JSON.stringify(
        {
          anonymousId: event.anonymousId,
          event: event.event,
          properties: event.properties,
          queuedAt: event.queuedAt,
        },
        null,
        2
      )}\n`
    );
  }
}

export async function maybeFlushTelemetry(
  options: { allowDebugOutput?: boolean | undefined } = {}
): Promise<void> {
  const state = await loadTelemetryState();
  if (!(state.enabled === true && state.pending.length > 0)) {
    return;
  }
  if (telemetryDisabledByEnv()) {
    return;
  }

  const anonymousId = ensureAnonymousId(state);
  const events: TelemetryEnvelope[] = state.pending.map((event) => ({
    anonymousId,
    event: event.event,
    properties: event.properties,
    queuedAt: event.queuedAt,
  }));

  if (telemetryDebugEnabled()) {
    if (options.allowDebugOutput !== false) {
      debugOutput(events);
    }
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const response = await fetch(telemetryUrl(), {
      body: JSON.stringify({ events }),
      headers: {
        "content-type": "application/json",
        "user-agent": `tranquilo/${PACKAGE_METADATA.version}`,
      },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      return;
    }
  } catch {
    return;
  } finally {
    clearTimeout(timeout);
  }

  const sentAt = nowIso();
  for (const pending of state.pending) {
    if (pending.key === "install_succeeded") {
      state.installRecordedAt = sentAt;
      continue;
    }
    if (pending.key.startsWith("booking_confirmed:")) {
      const [, orderId] = pending.key.split(":", 2);
      if (orderId) {
        state.confirmedBookingOrders[orderId] = sentAt;
      }
    }
  }
  state.pending = [];
  await saveTelemetryState(state);
}
