import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { loginSessionsPath } from "./paths";
import { TranquiloError } from "./types";

const LOGIN_SESSION_TTL_MS = 10 * 60 * 1000;

interface LoginSession {
  expiresAt: string;
  mobileNumber: string;
  token: string;
}

interface LoginSessionStore {
  sessions?: Record<string, LoginSession>;
}

interface PublicLoginSession {
  expiresAt: string;
  loginSessionId: string;
  mobileNumber: string;
}

async function readSessions(): Promise<Record<string, LoginSession>> {
  let payload: LoginSessionStore;
  try {
    payload = JSON.parse(
      await fs.readFile(loginSessionsPath(), "utf8")
    ) as LoginSessionStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw new TranquiloError("Could not read pending login sessions.", {
      code: "LOGIN_SESSION_STORE_ERROR",
      details: error,
    });
  }

  const now = Date.now();
  const sessions = payload.sessions ?? {};
  return Object.fromEntries(
    Object.entries(sessions).filter(([, session]) => {
      const expiresAt = Date.parse(session.expiresAt);
      return Number.isFinite(expiresAt) && expiresAt > now;
    })
  );
}

async function writeSessions(
  sessions: Record<string, LoginSession>
): Promise<void> {
  const file = loginSessionsPath();
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ sessions }, null, 2), {
    mode: 0o600,
  });
}

export async function createLoginSession(args: {
  mobileNumber: string;
  token: string;
}): Promise<PublicLoginSession> {
  const sessions = await readSessions();
  const loginSessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + LOGIN_SESSION_TTL_MS).toISOString();
  sessions[loginSessionId] = {
    expiresAt,
    mobileNumber: args.mobileNumber,
    token: args.token,
  };
  await writeSessions(sessions);
  return { expiresAt, loginSessionId, mobileNumber: args.mobileNumber };
}

export async function getLoginSession(
  loginSessionId: string
): Promise<LoginSession> {
  const sessions = await readSessions();
  const session = sessions[loginSessionId];
  if (!session) {
    throw new TranquiloError(
      "Login session was not found or has expired. Start login again.",
      { code: "LOGIN_SESSION_EXPIRED" }
    );
  }
  return session;
}

export async function deleteLoginSession(
  loginSessionId: string
): Promise<void> {
  const sessions = await readSessions();
  delete sessions[loginSessionId];
  await writeSessions(sessions);
}
