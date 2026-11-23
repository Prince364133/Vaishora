// India Standard Time helpers. India has no daylight saving, so IST is a fixed
// UTC+05:30 offset; all instants are stored as UTC timestamptz and converted here.

export const IST_OFFSET_MINUTES = 330;
const OFFSET_MS = IST_OFFSET_MINUTES * 60_000;

/** "YYYY-MM-DD" of the IST calendar day containing `d`. */
export function istDateString(d: Date = new Date()): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** UTC instant for an IST wall-clock date + minutes after midnight. */
export function istToUtc(date: string, minutes: number): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid date");
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0) + minutes * 60_000 - OFFSET_MS);
}

/** Day of week (0 = Sunday) for an IST date string. */
export function istWeekday(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Minutes after IST midnight for an instant. */
export function istMinutes(d: Date): number {
  const shifted = new Date(d.getTime() + OFFSET_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

export function formatMinutes(min: number): string {
  const h24 = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${h24 < 12 ? "AM" : "PM"}`;
}

export function formatIstTime(d: Date | string): string {
  return formatMinutes(istMinutes(new Date(d)));
}

const DAY_FMT = new Intl.DateTimeFormat("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
const LONG_FMT = new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

export function formatIstDate(d: Date | string, long = false): string {
  return (long ? LONG_FMT : DAY_FMT).format(new Date(d));
}

export function formatIstDateString(date: string, long = false): string {
  return formatIstDate(istToUtc(date, 12 * 60), long);
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m} min`;
  if (!m) return `${h} hr`;
  return `${h} hr ${m} min`;
}
