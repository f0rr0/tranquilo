import {
  cliTelemetryEnabled,
  forwardCliTelemetry,
  parseCliTelemetryEnvelope,
} from "@tranquilo/site-model/cli-telemetry";

export const dynamic = "force-dynamic";

function telemetryEnv() {
  return {
    CLI_TELEMETRY_POSTHOG_API_KEY: process.env.CLI_TELEMETRY_POSTHOG_API_KEY,
    CLI_TELEMETRY_POSTHOG_HOST: process.env.CLI_TELEMETRY_POSTHOG_HOST,
    VERCEL_ENV: process.env.VERCEL_ENV,
  };
}

export async function POST(request: Request): Promise<Response> {
  let envelope: ReturnType<typeof parseCliTelemetryEnvelope>;
  try {
    envelope = parseCliTelemetryEnvelope(await request.json());
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Telemetry payload invalid.",
        ok: false,
      },
      { status: 400 }
    );
  }

  const env = telemetryEnv();
  const disabled = !cliTelemetryEnabled(env);
  if (disabled) {
    return Response.json({ disabled: true, ok: true }, { status: 202 });
  }

  try {
    await forwardCliTelemetry(envelope, {
      ...env,
      fetch,
    });
    return Response.json({ disabled: false, ok: true });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Telemetry forwarding failed.",
        ok: false,
      },
      { status: 502 }
    );
  }
}
