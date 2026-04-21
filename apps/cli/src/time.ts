import { Temporal } from "@js-temporal/polyfill";

export function nowInstant(): Temporal.Instant {
  const override = process.env.TRANQUILO_NOW;
  return override ? Temporal.Instant.from(override) : Temporal.Now.instant();
}

export function systemTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function nowPlainDateTime(
  timezone: string = systemTimezone()
): Temporal.PlainDateTime {
  return nowInstant().toZonedDateTimeISO(timezone).toPlainDateTime();
}

export function todayPlainDate(
  timezone: string = systemTimezone()
): Temporal.PlainDate {
  return nowInstant().toZonedDateTimeISO(timezone).toPlainDate();
}
