import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PACKAGE_METADATA } from "@tranquilo/cli-model/release-metadata";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function updateResponse(updateAvailable: boolean): Response {
  return new Response(
    JSON.stringify({
      currentVersion: PACKAGE_METADATA.version,
      docsUrl: "https://tranquilo-ai.vercel.app/docs",
      installCommand: "exit 12",
      latestVersion: PACKAGE_METADATA.version,
      releaseNotesUrl: "https://github.com/example/releases/v0.1.1",
      updateAvailable,
    }),
    {
      headers: { "content-type": "application/json" },
      status: 200,
    }
  );
}

describe("CLI updates", () => {
  let originalEnv: NodeJS.ProcessEnv;
  let originalFetch: typeof fetch;
  let tempDir: string;

  beforeEach(async () => {
    originalEnv = { ...process.env };
    originalFetch = globalThis.fetch;
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "tranquilo-update-"));
    process.env.TRANQUILO_STATE_DIR = tempDir;
    process.env.TRANQUILO_UPDATE_URL =
      "https://updates.example.test/api/cli/update";
  });

  afterEach(async () => {
    process.env = originalEnv;
    globalThis.fetch = originalFetch;
    await fsp.rm(tempDir, { force: true, recursive: true });
  });

  it("does not run the installer when the installed version is current", async () => {
    globalThis.fetch = vi.fn(() => Promise.resolve(updateResponse(false)));
    const { updateAction } = await import("../src/update");

    await expect(updateAction()).resolves.toBe(
      `Tranquilo ${PACKAGE_METADATA.version} is up to date.\n`
    );

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
