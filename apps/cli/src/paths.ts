import os from "node:os";
import path from "node:path";

function homeDir(): string {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

function configDir(): string {
  if (process.env.TRANQUILO_CONFIG_DIR) {
    return process.env.TRANQUILO_CONFIG_DIR;
  }
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tranquilo");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.APPDATA || path.join(home, "AppData", "Roaming"),
      "Tranquilo"
    );
  }
  return path.join(
    process.env.XDG_CONFIG_HOME || path.join(home, ".config"),
    "tranquilo"
  );
}

export function dataDir(): string {
  if (process.env.TRANQUILO_DATA_DIR) {
    return process.env.TRANQUILO_DATA_DIR;
  }
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tranquilo");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "Tranquilo"
    );
  }
  return path.join(
    process.env.XDG_DATA_HOME || path.join(home, ".local", "share"),
    "tranquilo"
  );
}

export function stateDir(): string {
  if (process.env.TRANQUILO_STATE_DIR) {
    return process.env.TRANQUILO_STATE_DIR;
  }
  const home = homeDir();
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", "tranquilo");
  }
  if (process.platform === "win32") {
    return path.join(
      process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"),
      "Tranquilo"
    );
  }
  return path.join(
    process.env.XDG_STATE_HOME || path.join(home, ".local", "state"),
    "tranquilo"
  );
}

export function configPath(): string {
  return path.join(configDir(), "config.toml");
}

export function paymentPreferencesPath(): string {
  return path.join(configDir(), "payment-preferences.json");
}

export function fallbackSecretPath(): string {
  return path.join(stateDir(), "credentials.enc");
}

export function loginSessionsPath(): string {
  return path.join(stateDir(), "login-sessions.json");
}

export function telemetryStatePath(): string {
  return path.join(stateDir(), "telemetry.json");
}
