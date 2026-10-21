// Date-only helpers. Calendar dates are handled as ISO strings ("YYYY-MM-DD") everywhere in
// business logic so that no timezone shift can move a day. "Today" is always Asia/Jakarta.

export const APP_TIMEZONE = "Asia/Jakarta";
export type ISODate = string;

const pad = (n: number) => String(n).padStart(2, "0");

export function isoDate(year: number, month: number, day: number): ISODate {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Convert a Prisma @db.Date value (UTC midnight) to ISO date string. */
export function toISO(d: Date): ISODate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Convert an ISO date string into a Date suitable for a Prisma @db.Date column. */
export function fromISO(s: ISODate): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`Invalid date: ${s}`);
  const d = new Date(`${s}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime()) || toISO(d) !== s) throw new Error(`Invalid date: ${s}`);
  return d;
}

export function isValidISO(s: string): boolean {
  try {
    fromISO(s);
    return true;
  } catch {
    return false;
  }
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function monthDates(year: number, month: number): ISODate[] {
  return Array.from({ length: daysInMonth(year, month) }, (_, i) => isoDate(year, month, i + 1));
}

export function monthStart(year: number, month: number): ISODate {
  return isoDate(year, month, 1);
}

export function monthEnd(year: number, month: number): ISODate {
  return isoDate(year, month, daysInMonth(year, month));
}

/** ISO weekday: Monday = 1 … Sunday = 7 */
export function isoWeekday(s: ISODate): number {
  const d = fromISO(s).getUTCDay();
  return d === 0 ? 7 : d;
}

export function addDays(s: ISODate, n: number): ISODate {
  const d = fromISO(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

export function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function eachDate(start: ISODate, end: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Monday of the ISO week containing `s` — used to group days into weeks. */
export function weekKey(s: ISODate): ISODate {
  return addDays(s, 1 - isoWeekday(s));
}

export function rangesOverlap(aStart: ISODate, aEnd: ISODate, bStart: ISODate, bEnd: ISODate): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export function parseMonthParam(param: string | undefined, fallback: { year: number; month: number }) {
  const m = /^(\d{4})-(\d{2})$/.exec(param ?? "");
  if (!m) return fallback;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12 || year < 2000 || year > 2100) return fallback;
  return { year, month };
}

export function monthParam(year: number, month: number) {
  return `${year}-${pad(month)}`;
}

// ── "now" in Jakarta ──

export function todayJakarta(now: Date = new Date()): ISODate {
  // en-CA renders YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentMonthJakarta(now: Date = new Date()) {
  const [y, m] = todayJakarta(now).split("-").map(Number);
  return { year: y, month: m };
}

// ── Indonesian display formats ──

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("id-ID", { timeZone: "UTC", ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** 20 Okt 2026 */
export function formatDate(s: ISODate | Date | null | undefined): string {
  if (!s) return "—";
  const d = typeof s === "string" ? fromISO(s) : fromISO(toISO(s));
  return fmt("short", { day: "numeric", month: "short", year: "numeric" }).format(d);
}

/** Selasa, 20 Oktober 2026 */
export function formatDateLong(s: ISODate): string {
  return fmt("long", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(fromISO(s));
}

/** Oktober 2026 */
export function formatMonth(year: number, month: number): string {
  return fmt("month", { month: "long", year: "numeric" }).format(fromISO(monthStart(year, month)));
}

/** Sel */
export function formatWeekdayShort(s: ISODate): string {
  return fmt("wd", { weekday: "short" }).format(fromISO(s));
}

export function formatDateRange(a: ISODate, b: ISODate): string {
  return a === b ? formatDate(a) : `${formatDate(a)} – ${formatDate(b)}`;
}

/** 20 Okt 2026, 08.42 (Jakarta) */
export function formatDateTime(d: Date | null | undefined): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export const WEEKDAY_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};
export const WEEKDAY_SHORT: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };

// ── Date-time in Jakarta (UTC+7, no daylight saving) ──
const JKT_OFFSET_MS = 7 * 3600_000;

/** "2026-10-26" + "09:00" in Asia/Jakarta → UTC Date */
export function jakartaToUtc(date: ISODate, time: string): Date {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(`Invalid time: ${time}`);
  fromISO(date);
  return new Date(`${date}T${time}:00+07:00`);
}

/** UTC Date → Jakarta { date, time } */
export function utcToJakarta(d: Date): { date: ISODate; time: string } {
  const j = new Date(d.getTime() + JKT_OFFSET_MS).toISOString();
  return { date: j.slice(0, 10), time: j.slice(11, 16) };
}

/** 09.00–10.30 (Jakarta) */
export function formatTimeRange(start: Date, end: Date): string {
  const a = utcToJakarta(start),
    b = utcToJakarta(end);
  const t = (x: string) => x.replace(":", ".");
  return a.date === b.date ? `${t(a.time)}–${t(b.time)}` : `${t(a.time)} – ${formatDate(b.date)} ${t(b.time)}`;
}
