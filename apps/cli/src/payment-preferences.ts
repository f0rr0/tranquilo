import fs from "node:fs/promises";
import path from "node:path";
import { paymentPreferencesPath } from "./paths";
import {
  parseUpiApp,
  type UpiApp,
  type UpiAppId,
  upiAppById,
} from "./upi-apps";

interface PaymentPreferences {
  updatedAt?: string | undefined;
  upiApp?: UpiAppId | undefined;
}

async function loadPaymentPreferences(): Promise<PaymentPreferences> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(paymentPreferencesPath(), "utf8")
    ) as PaymentPreferences;
    if (parsed.upiApp) {
      parseUpiApp(parsed.upiApp);
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    return {};
  }
}

export async function rememberedUpiApp(): Promise<UpiApp | undefined> {
  const preferences = await loadPaymentPreferences();
  return preferences.upiApp ? upiAppById(preferences.upiApp) : undefined;
}

export async function rememberUpiApp(app: UpiApp): Promise<void> {
  await fs.mkdir(path.dirname(paymentPreferencesPath()), { recursive: true });
  await fs.writeFile(
    paymentPreferencesPath(),
    `${JSON.stringify(
      { updatedAt: new Date().toISOString(), upiApp: app.id },
      null,
      2
    )}\n`,
    { mode: 0o600 }
  );
}
