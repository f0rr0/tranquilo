import fs from "node:fs/promises";
import { configPath } from "./paths";
import type { RuntimeConfig } from "./types";

const LINE_SPLIT_RE = /\r?\n/;
const FLAT_TOML_STRING_RE = /^([A-Za-z0-9_-]+)\s*=\s*"(.*)"\s*$/;
const FILE_NAME_RE = /[/\\][^/\\]+$/;

const DEFAULT_CONFIG: RuntimeConfig = {
  baseUrl: "https://apiv2.withpronto.com",
  juspayBaseUrl: "https://public.releases.juspay.in",
  platform: "ios",
  appVersion: "1.4.5",
};

function parseFlatToml(text: string): Partial<RuntimeConfig> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(LINE_SPLIT_RE)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith("[")) {
      continue;
    }
    const match = FLAT_TOML_STRING_RE.exec(line);
    const key = match?.[1];
    const value = match?.[2];
    if (key && value !== undefined) {
      out[key] = value.replace(/\\"/g, '"');
    }
  }
  return out;
}

export async function loadConfig(): Promise<RuntimeConfig> {
  const envConfig = {
    baseUrl: process.env.TRANQUILO_BASE_URL,
    juspayBaseUrl: process.env.TRANQUILO_JUSPAY_BASE_URL,
    platform: process.env.TRANQUILO_PLATFORM,
    appVersion: process.env.TRANQUILO_APP_VERSION,
  };

  let fileConfig: Partial<RuntimeConfig> = {};
  try {
    fileConfig = parseFlatToml(await fs.readFile(configPath(), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return {
    baseUrl: envConfig.baseUrl || fileConfig.baseUrl || DEFAULT_CONFIG.baseUrl,
    juspayBaseUrl:
      envConfig.juspayBaseUrl ||
      fileConfig.juspayBaseUrl ||
      DEFAULT_CONFIG.juspayBaseUrl,
    platform:
      envConfig.platform || fileConfig.platform || DEFAULT_CONFIG.platform,
    appVersion:
      envConfig.appVersion ||
      fileConfig.appVersion ||
      DEFAULT_CONFIG.appVersion,
  };
}

export async function ensureConfig(): Promise<RuntimeConfig> {
  const cfg = await loadConfig();
  await fs.mkdir(configPath().replace(FILE_NAME_RE, ""), {
    recursive: true,
  });
  await fs.writeFile(
    configPath(),
    [
      `baseUrl = "${cfg.baseUrl.replace(/"/g, '\\"')}"`,
      `juspayBaseUrl = "${cfg.juspayBaseUrl.replace(/"/g, '\\"')}"`,
      `platform = "${cfg.platform.replace(/"/g, '\\"')}"`,
      `appVersion = "${cfg.appVersion.replace(/"/g, '\\"')}"`,
      "",
    ].join("\n"),
    { mode: 0o600 }
  );
  return cfg;
}
