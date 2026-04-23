import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadTelemetryWithSpawnMock() {
  const spawn = vi.fn(() => ({ unref: vi.fn() }));
  vi.doMock("node:child_process", () => ({ spawn }));
  const telemetry = await import("../src/telemetry");
  return { spawn, telemetry };
}

describe("telemetry background flush", () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;
  let tempDir: string;

  beforeEach(async () => {
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tranquilo-telemetry-"));
    process.argv = [process.execPath, "src/index.ts"];
    process.env.TRANQUILO_STATE_DIR = tempDir;
    delete process.env.CI;
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.resetModules();
    process.argv = originalArgv;
    process.env = originalEnv;
    await fsp.rm(tempDir, { force: true, recursive: true });
  });

  it("starts background flushes for JSON no-interactive commands", async () => {
    const { spawn, telemetry } = await loadTelemetryWithSpawnMock();

    await telemetry.enableTelemetry();
    await telemetry.recordBookingConfirmed({
      durationMinutes: 60,
      orderId: "order-1",
    });
    spawn.mockClear();

    await telemetry.maybeStartBackgroundTelemetryFlush([
      "househelp",
      "find",
      "--json",
      "--no-interactive",
    ]);

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith(
      process.execPath,
      ["src/index.ts", "telemetry", "flush"],
      expect.objectContaining({
        detached: true,
        env: expect.objectContaining({
          TRANQUILO_NO_UPDATE_CHECK: "1",
          TRANQUILO_TELEMETRY_FLUSHING: "1",
        }),
        stdio: "ignore",
      })
    );
  });

  it("allows MCP flows to trigger a background flush helper", async () => {
    const { spawn, telemetry } = await loadTelemetryWithSpawnMock();

    await telemetry.enableTelemetry();
    await telemetry.recordBookingConfirmed({
      durationMinutes: 60,
      orderId: "order-1",
    });
    spawn.mockClear();

    await telemetry.maybeStartBackgroundTelemetryFlush(["mcp"]);

    expect(spawn).toHaveBeenCalledTimes(1);
  });
});
