import { TranquiloError } from "./types";

export const UPI_APPS = [
  {
    aliases: ["phonepe", "phone-pe"],
    id: "phonepe",
    label: "PhonePe",
    packageName: "phonepe://pay",
  },
  {
    aliases: ["googlepay", "google-pay", "gpay", "google"],
    id: "googlepay",
    label: "Google Pay",
    packageName: "tez://upi/pay",
  },
  {
    aliases: ["paytm"],
    id: "paytm",
    label: "Paytm",
    packageName: "paytmmp://upi/pay",
  },
] as const;

export type UpiAppId = (typeof UPI_APPS)[number]["id"];

export interface UpiApp {
  id: UpiAppId;
  label: string;
  packageName: string;
}

function allowedUpiAppIds(): UpiAppId[] {
  return UPI_APPS.map((app) => app.id);
}

export function allowedUpiAppText(): string {
  return allowedUpiAppIds().join("|");
}

export function upiAppById(id: UpiAppId): UpiApp {
  const app = UPI_APPS.find((candidate) => candidate.id === id);
  if (!app) {
    throw new TranquiloError(`Unknown UPI app: ${id}`, {
      code: "UPI_APP_UNSUPPORTED",
      details: { allowed: allowedUpiAppIds() },
    });
  }
  return app;
}

export function parseUpiApp(value: string): UpiApp {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  const app = UPI_APPS.find(
    (candidate) =>
      candidate.id === normalized ||
      candidate.aliases.some((alias) => alias === normalized) ||
      candidate.packageName === value.trim()
  );
  if (!app) {
    throw new TranquiloError(
      `--upi-app must be one of ${allowedUpiAppText()}.`,
      {
        code: "UPI_APP_UNSUPPORTED",
        details: { allowed: allowedUpiAppIds() },
      }
    );
  }
  return app;
}
