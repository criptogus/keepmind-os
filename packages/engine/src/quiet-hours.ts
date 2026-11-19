import { zonedParts, zonedTimeForward } from "./cron";

/**
 * Quiet hours (Tucano-style): a window of the workspace's day, in `organization_settings.timezone`, when scheduled
 * routines hold their slots and fire once the window ends. `start`/`end` are "HH:MM" (24h); `end` before `start`
 * crosses midnight (`22:00`–`07:00`). Equal ends mean no window.
 */
export interface QuietHours {
  start: string;
  end: string;
}

export const QUIET_HOURS_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The stored value as quiet hours, or null when unset or malformed (older rows, hand-edited ones). */
export function quietHoursOf(value: unknown): QuietHours | null {
  if (!value || typeof value !== "object") return null;
  const { start, end } = value as Record<string, unknown>;
  if (typeof start !== "string" || typeof end !== "string") return null;
  if (!QUIET_HOURS_TIME.test(start) || !QUIET_HOURS_TIME.test(end) || start === end) return null;
  return { start, end };
}

const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));

/** Whether the instant falls inside the window, on the wall clock of `timeZone`. */
export function inQuietHours(instant: Date, timeZone: string, quiet: QuietHours): boolean {
  const p = zonedParts(instant, timeZone);
  const m = p.hour * 60 + p.minute;
  const s = minutesOf(quiet.start);
  const e = minutesOf(quiet.end);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

/**
 * The instant the window holding `instant` ends: the next local `end` after it (today's, or tomorrow's when the
 * window crossed midnight and today's already passed). Null only if the zone has no such minute left.
 */
export function quietHoursEnd(instant: Date, timeZone: string, quiet: QuietHours): Date | null {
  const p = zonedParts(instant, timeZone);
  const [eh, em] = [Number(quiet.end.slice(0, 2)), Number(quiet.end.slice(3))];
  let at = zonedTimeForward(p.year, p.month, p.day, eh, em, timeZone);
  if (!at || at.getTime() <= instant.getTime()) {
    const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    at = zonedTimeForward(
      tomorrow.getUTCFullYear(),
      tomorrow.getUTCMonth() + 1,
      tomorrow.getUTCDate(),
      eh,
      em,
      timeZone,
    );
  }
  return at;
}
