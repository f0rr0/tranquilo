import fs from "node:fs/promises";
import path from "node:path";
import { PACKAGE_METADATA } from "@tranquilo/product/release-metadata";
import { execa } from "execa";
import { stateDir } from "./paths";

interface UpdateResponse {
  currentVersion: string;
  docsUrl: string;
  installCommand: string;
  latestVersion: string;
  releaseNotesUrl: string;
  updateAvailable: boolean;
}

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const UPDATE_URL =
  process.env.TRANQUILO_UPDATE_URL ??
  "https://tranquilo-ai.vercel.app/api/cli/update";

function cachePath(): string {
  return path.join(stateDir(), "update-check.json");
}

function shouldSkipUpdateCheck(args: string[]): boolean {
  if (process.env.CI || process.env.TRANQUILO_NO_UPDATE_CHECK === "1") {
    return true;
  }
  if (args.includes("--json") || args.includes("--no-interactive")) {
    return true;
  }
  const [first, second] = args;
  if (!first || ["mcp", "update"].includes(first)) {
    return true;
  }
  if (first === "checkout" && second === "pay") {
    return true;
  }
  if (args.includes("--pay")) {
    return true;
  }
  return false;
}

async function readCache(): Promise<
  | {
      checkedAt: number;
      response: UpdateResponse;
    }
  | undefined
> {
  try {
    return JSON.parse(await fs.readFile(cachePath(), "utf8")) as {
      checkedAt: number;
      response: UpdateResponse;
    };
  } catch {
    return;
  }
}

async function writeCache(response: UpdateResponse): Promise<void> {
  const file = cachePath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(
    file,
    `${JSON.stringify({ checkedAt: Date.now(), response }, null, 2)}\n`
  );
}

async function fetchUpdate(): Promise<UpdateResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);
  try {
    const url = new URL(UPDATE_URL);
    url.searchParams.set("version", PACKAGE_METADATA.version);
    url.searchParams.set("os", process.platform);
    url.searchParams.set("arch", process.arch);
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Update check failed with HTTP ${response.status}`);
    }
    return (await response.json()) as UpdateResponse;
  } finally {
    clearTimeout(timeout);
  }
}

async function checkForUpdate(options?: {
  force?: boolean | undefined;
}): Promise<UpdateResponse | undefined> {
  const cached = await readCache();
  if (
    !options?.force &&
    cached &&
    cached.response.currentVersion === PACKAGE_METADATA.version &&
    Date.now() - cached.checkedAt < CHECK_INTERVAL_MS
  ) {
    return cached.response;
  }
  try {
    const response = await fetchUpdate();
    await writeCache(response);
    return response;
  } catch {
    return cached?.response;
  }
}

export async function maybePrintUpdateNotice(args: string[]): Promise<void> {
  if (shouldSkipUpdateCheck(args)) {
    return;
  }
  const update = await checkForUpdate();
  if (!update?.updateAvailable) {
    return;
  }
  process.stderr.write(
    [
      `Tranquilo ${update.latestVersion} is available; current is ${update.currentVersion}.`,
      "Update: tranquilo update",
      `Docs: ${update.docsUrl}`,
      "",
    ].join("\n")
  );
}

export async function updateCheckAction(options: {
  json?: boolean | undefined;
}): Promise<string> {
  const update = await checkForUpdate({ force: true });
  if (options.json) {
    return `${JSON.stringify({ ok: true, data: update ?? null }, null, 2)}\n`;
  }
  if (!update) {
    return "Could not check for updates.\n";
  }
  if (!update.updateAvailable) {
    return `Tranquilo ${PACKAGE_METADATA.version} is up to date.\n`;
  }
  return [
    `Tranquilo ${update.latestVersion} is available.`,
    `Current: ${update.currentVersion}`,
    `Install: ${update.installCommand}`,
    `Release notes: ${update.releaseNotesUrl}`,
    "",
  ].join("\n");
}

export async function updateAction(): Promise<string> {
  const update = await checkForUpdate({ force: true });
  const command =
    update?.installCommand ??
    "curl -fsSL https://tranquilo-ai.vercel.app/install.sh | sh";
  await execa("sh", ["-c", command], { stdio: "inherit" });
  return "";
}
