import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AsyncEntry } from "@napi-rs/keyring";
import { fallbackSecretPath } from "./paths";
import type { Credentials } from "./types";

const SERVICE = "tranquilo";
const ACCOUNT = "default";

function keyMaterial(): Buffer {
  const user = os.userInfo().username;
  const seed = `${SERVICE}:${user}:${os.hostname()}:${os.homedir()}`;
  return crypto.createHash("sha256").update(seed).digest();
}

async function readFallback(): Promise<Credentials | null> {
  try {
    const text = await fs.readFile(fallbackSecretPath(), "utf8");
    const payload = JSON.parse(text) as {
      iv: string;
      tag: string;
      data: string;
    };
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyMaterial(),
      Buffer.from(payload.iv, "base64")
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(plaintext) as Credentials;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    return null;
  }
}

async function writeFallback(credentials: Credentials): Promise<void> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyMaterial(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(credentials), "utf8"),
    cipher.final(),
  ]);
  const payload = {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: encrypted.toString("base64"),
  };
  const file = fallbackSecretPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

async function deleteFallback(): Promise<void> {
  try {
    await fs.rm(fallbackSecretPath(), { force: true });
  } catch {
    // best effort
  }
}

export async function loadCredentials(): Promise<Credentials | null> {
  if (process.env.TRANQUILO_TOKEN) {
    return {
      accessToken: process.env.TRANQUILO_TOKEN,
      refreshToken: process.env.TRANQUILO_REFRESH_TOKEN,
      savedAt: new Date().toISOString(),
    };
  }

  try {
    const value = await new AsyncEntry(SERVICE, ACCOUNT).getPassword();
    return value ? (JSON.parse(value) as Credentials) : null;
  } catch {
    return readFallback();
  }
}

export async function saveCredentials(
  credentials: Credentials
): Promise<"keyring" | "encrypted-file"> {
  const value = JSON.stringify(credentials);
  try {
    await new AsyncEntry(SERVICE, ACCOUNT).setPassword(value);
    await deleteFallback();
    return "keyring";
  } catch {
    await writeFallback(credentials);
    return "encrypted-file";
  }
}

export async function clearCredentials(): Promise<void> {
  try {
    await new AsyncEntry(SERVICE, ACCOUNT).deletePassword();
  } catch {
    // key may not exist or keyring may be unavailable
  }
  await deleteFallback();
}

export async function credentialStorageStatus(): Promise<{
  keyringAvailable: boolean;
  fallbackFileExists: boolean;
}> {
  let keyringAvailable = false;
  try {
    await new AsyncEntry(SERVICE, "__healthcheck__").getPassword();
    keyringAvailable = true;
  } catch (error) {
    keyringAvailable = String((error as Error).message).includes("NoEntry");
  }

  let fallbackFileExists = false;
  try {
    await fs.access(fallbackSecretPath());
    fallbackFileExists = true;
  } catch {
    fallbackFileExists = false;
  }
  return { keyringAvailable, fallbackFileExists };
}
