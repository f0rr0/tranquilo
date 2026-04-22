import { saveCredentials } from "./storage";
import type { Credentials, JsonObject } from "./types";
import { TranquiloError } from "./types";

export function tokenFromLoginStart(payload: JsonObject): string {
  const startData = payload.data as JsonObject | undefined;
  const token = startData?.token;
  if (typeof token !== "string" || !token) {
    throw new TranquiloError("Login start did not return an OTP token.", {
      code: "LOGIN_START_FAILED",
      details: payload,
    });
  }
  return token;
}

function credentialsFromVerify(
  payload: JsonObject,
  mobileNumber: string
): Credentials {
  const topData = payload.data as JsonObject | undefined;
  const verifyData = topData?.data as JsonObject | undefined;
  const token = verifyData?.token;
  if (typeof token !== "string" || !token) {
    throw new TranquiloError("Login verification did not return a token.", {
      code: "LOGIN_VERIFY_FAILED",
      details: payload,
    });
  }
  const userData = verifyData?.userData as JsonObject | undefined;
  return {
    accessToken: token,
    refreshToken:
      typeof verifyData?.refreshToken === "string"
        ? verifyData.refreshToken
        : undefined,
    userId: typeof userData?.id === "string" ? userData.id : undefined,
    mobileNumber,
    savedAt: new Date().toISOString(),
  };
}

export async function saveVerifiedLogin(
  payload: JsonObject,
  mobileNumber: string
): Promise<{ credentials: Credentials; storage: "encrypted-file" }> {
  const credentials = credentialsFromVerify(payload, mobileNumber);
  const storage = await saveCredentials(credentials);
  return { credentials, storage };
}
