export type JsonObject = Record<string, unknown>;

export interface Credentials {
  accessToken: string;
  mobileNumber?: string | undefined;
  refreshToken?: string | undefined;
  savedAt: string;
  userId?: string | undefined;
}

export interface RuntimeConfig {
  appVersion: string;
  baseUrl: string;
  juspayBaseUrl: string;
  platform: string;
}

export interface LocationInput {
  addressId?: string | undefined;
  lat?: number | undefined;
  lng?: number | undefined;
}

export type LocationSource =
  | "active-cart-address"
  | "address"
  | "first-saved-address"
  | "flags"
  | "profile-default-address";

export interface ResolvedLocation {
  addressId?: string | undefined;
  label?: string | undefined;
  lat: number;
  lng: number;
  source: LocationSource;
}

export type BookingStatusPreset = "upcoming" | "past" | "all";

export type CartItemMap = Record<string, number>;

export class TranquiloError extends Error {
  readonly code: string;
  readonly status?: number | undefined;
  readonly details?: unknown | undefined;

  constructor(
    message: string,
    options: { code?: string; status?: number; details?: unknown } = {}
  ) {
    super(message);
    this.name = "TranquiloError";
    this.code = options.code ?? "TRANQUILO_ERROR";
    this.status = options.status;
    this.details = options.details;
  }
}
