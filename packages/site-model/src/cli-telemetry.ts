type CliTelemetryEventName = "booking_confirmed" | "install_succeeded";

type CliTelemetryPropertyValue = boolean | number | string;

interface CliTelemetryEvent {
  anonymousId: string;
  event: CliTelemetryEventName;
  properties: Record<string, CliTelemetryPropertyValue>;
  queuedAt: string;
}

interface CliTelemetryEnvelope {
  events: CliTelemetryEvent[];
}

interface CliTelemetryEnv {
  CLI_TELEMETRY_POSTHOG_API_KEY?: string | undefined;
  CLI_TELEMETRY_POSTHOG_HOST?: string | undefined;
  fetch?: typeof fetch | undefined;
  VERCEL_ENV?: string | undefined;
}

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const EVENT_NAMES = new Set<CliTelemetryEventName>([
  "booking_confirmed",
  "install_succeeded",
]);
const COMMON_PROPERTIES = new Set(["arch", "cliVersion", "os"]);
const INSTALL_PROPERTIES = new Set(["agentTarget", "transport"]);
const BOOKING_PROPERTIES = new Set(["durationMinutes"]);
const TRAILING_SLASH_RE = /\/+$/u;

function isObject(
  value: unknown
): value is Record<string, boolean | number | string | unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return;
  }
  const text = value.trim();
  return text || undefined;
}

function propertyValue(value: unknown): CliTelemetryPropertyValue | undefined {
  if (
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  return;
}

function validateProperties(
  event: CliTelemetryEventName,
  value: unknown
): Record<string, CliTelemetryPropertyValue> {
  if (!isObject(value)) {
    throw new Error("Telemetry properties must be an object.");
  }
  const allowed = new Set(COMMON_PROPERTIES);
  const eventSpecific =
    event === "install_succeeded" ? INSTALL_PROPERTIES : BOOKING_PROPERTIES;
  for (const key of eventSpecific) {
    allowed.add(key);
  }

  const properties: Record<string, CliTelemetryPropertyValue> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (!allowed.has(key)) {
      throw new Error(`Telemetry property ${key} is not allowed.`);
    }
    const normalized = propertyValue(rawValue);
    if (normalized === undefined) {
      throw new Error(`Telemetry property ${key} has an invalid value.`);
    }
    properties[key] = normalized;
  }
  for (const key of COMMON_PROPERTIES) {
    if (!(key in properties)) {
      throw new Error(`Telemetry property ${key} is required.`);
    }
  }
  return properties;
}

function validateEvent(value: unknown): CliTelemetryEvent {
  if (!isObject(value)) {
    throw new Error("Telemetry event must be an object.");
  }
  const event = value.event;
  if (!EVENT_NAMES.has(event as CliTelemetryEventName)) {
    throw new Error("Telemetry event name is invalid.");
  }
  const anonymousId = stringValue(value.anonymousId);
  if (!anonymousId || anonymousId.length > 128) {
    throw new Error("Telemetry anonymousId is invalid.");
  }
  const queuedAt = stringValue(value.queuedAt);
  if (!queuedAt) {
    throw new Error("Telemetry queuedAt is required.");
  }
  return {
    anonymousId,
    event: event as CliTelemetryEventName,
    properties: validateProperties(
      event as CliTelemetryEventName,
      value.properties
    ),
    queuedAt,
  };
}

export function parseCliTelemetryEnvelope(
  value: unknown
): CliTelemetryEnvelope {
  if (
    !(isObject(value) && Array.isArray(value.events) && value.events.length)
  ) {
    throw new Error("Telemetry request must include at least one event.");
  }
  return { events: value.events.map(validateEvent) };
}

export function cliTelemetryEnabled(env: CliTelemetryEnv): boolean {
  return Boolean(
    stringValue(env.CLI_TELEMETRY_POSTHOG_API_KEY) &&
      env.VERCEL_ENV === "production"
  );
}

export async function forwardCliTelemetry(
  envelope: CliTelemetryEnvelope,
  env: CliTelemetryEnv
): Promise<void> {
  const apiKey = stringValue(env.CLI_TELEMETRY_POSTHOG_API_KEY);
  if (!apiKey) {
    return;
  }
  const client = env.fetch ?? fetch;
  const host = (
    stringValue(env.CLI_TELEMETRY_POSTHOG_HOST) ?? DEFAULT_POSTHOG_HOST
  ).replace(TRAILING_SLASH_RE, "");

  await Promise.all(
    envelope.events.map((event) =>
      client(`${host}/i/v0/e/`, {
        body: JSON.stringify({
          api_key: apiKey,
          distinct_id: event.anonymousId,
          event: event.event,
          properties: {
            ...event.properties,
            $process_person_profile: false,
            source: "tranquilo-cli",
            telemetryQueuedAt: event.queuedAt,
          },
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }).then((response) => {
        if (!response.ok) {
          throw new Error(
            `PostHog capture failed with HTTP ${response.status}.`
          );
        }
      })
    )
  );
}
