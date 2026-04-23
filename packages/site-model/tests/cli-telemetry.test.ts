import { PACKAGE_METADATA } from "@tranquilo/cli-model/release-metadata";
import { describe, expect, it, vi } from "vitest";
import {
  cliTelemetryEnabled,
  forwardCliTelemetry,
  parseCliTelemetryEnvelope,
} from "../src/cli-telemetry";

const CLI_VERSION = PACKAGE_METADATA.version;
const NOT_ALLOWED_RE = /not allowed/u;

describe("cli telemetry", () => {
  it("accepts the supported event shapes", () => {
    expect(
      parseCliTelemetryEnvelope({
        events: [
          {
            anonymousId: "anon_123",
            event: "install_succeeded",
            properties: {
              agentTarget: "auto",
              arch: "arm64",
              cliVersion: CLI_VERSION,
              os: "darwin",
              transport: "install_sh",
            },
            queuedAt: "2026-04-23T10:00:00.000Z",
          },
          {
            anonymousId: "anon_123",
            event: "booking_confirmed",
            properties: {
              arch: "arm64",
              cliVersion: CLI_VERSION,
              durationMinutes: 60,
              os: "darwin",
            },
            queuedAt: "2026-04-23T10:05:00.000Z",
          },
        ],
      })
    ).toEqual({
      events: [
        {
          anonymousId: "anon_123",
          event: "install_succeeded",
          properties: {
            agentTarget: "auto",
            arch: "arm64",
            cliVersion: CLI_VERSION,
            os: "darwin",
            transport: "install_sh",
          },
          queuedAt: "2026-04-23T10:00:00.000Z",
        },
        {
          anonymousId: "anon_123",
          event: "booking_confirmed",
          properties: {
            arch: "arm64",
            cliVersion: CLI_VERSION,
            durationMinutes: 60,
            os: "darwin",
          },
          queuedAt: "2026-04-23T10:05:00.000Z",
        },
      ],
    });
  });

  it("rejects unexpected properties", () => {
    expect(() =>
      parseCliTelemetryEnvelope({
        events: [
          {
            anonymousId: "anon_123",
            event: "booking_confirmed",
            properties: {
              arch: "arm64",
              cliVersion: CLI_VERSION,
              orderId: "secret-order",
              os: "darwin",
            },
            queuedAt: "2026-04-23T10:05:00.000Z",
          },
        ],
      })
    ).toThrow(NOT_ALLOWED_RE);
  });

  it("forwards validated events to PostHog without person profiles", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response(null, { status: 200 }))
    );
    await forwardCliTelemetry(
      parseCliTelemetryEnvelope({
        events: [
          {
            anonymousId: "anon_123",
            event: "booking_confirmed",
            properties: {
              arch: "arm64",
              cliVersion: CLI_VERSION,
              durationMinutes: 60,
              os: "darwin",
            },
            queuedAt: "2026-04-23T10:05:00.000Z",
          },
        ],
      }),
      {
        CLI_TELEMETRY_POSTHOG_API_KEY: "project-token",
        fetch: fetchMock,
      }
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls.at(0) as
      | [string, RequestInit]
      | undefined;
    if (!call) {
      throw new Error("expected telemetry capture request");
    }
    const [url, options] = call;
    expect(url).toBe("https://us.i.posthog.com/i/v0/e/");
    expect(options).toMatchObject({
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(JSON.parse(String(options.body ?? ""))).toEqual({
      api_key: "project-token",
      distinct_id: "anon_123",
      event: "booking_confirmed",
      properties: {
        $process_person_profile: false,
        arch: "arm64",
        cliVersion: CLI_VERSION,
        durationMinutes: 60,
        os: "darwin",
        source: "tranquilo-cli",
        telemetryQueuedAt: "2026-04-23T10:05:00.000Z",
      },
    });
  });

  it("only enables forwarding in production", () => {
    expect(
      cliTelemetryEnabled({
        CLI_TELEMETRY_POSTHOG_API_KEY: "project-token",
        VERCEL_ENV: "production",
      })
    ).toBe(true);

    expect(
      cliTelemetryEnabled({
        CLI_TELEMETRY_POSTHOG_API_KEY: "project-token",
        VERCEL_ENV: "preview",
      })
    ).toBe(false);

    expect(
      cliTelemetryEnabled({
        CLI_TELEMETRY_POSTHOG_API_KEY: "project-token",
      })
    ).toBe(false);
  });
});
