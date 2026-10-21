// Recurrence expansion for internal events. Pure functions; occurrences are Jakarta calendar dates.
import { addDays, daysInMonth, eachDate, formatDate, isoDate, isoWeekday, weekKey, WEEKDAY_LABELS, type ISODate } from "../dates";

export type Freq = "NONE" | "DAILY" | "WEEKLY" | "MONTHLY" | "CUSTOM";

export interface RecurrenceRule {
  freq: Freq;
  /** every N days (DAILY), weeks (WEEKLY/CUSTOM) or months (MONTHLY) */
  interval: number;
  /** ISO weekdays (1 = Mon). DAILY: optional filter (e.g. weekdays only). WEEKLY/CUSTOM: days of the week. */
  byWeekdays: number[];
  untilDate: ISODate;
}

export const MAX_OCCURRENCES = 200;
export const MAX_SPAN_DAYS = 366;

export function validateRule(start: ISODate, r: RecurrenceRule): string | null {
  if (r.freq === "NONE") return null;
  if (!Number.isInteger(r.interval) || r.interval < 1 || r.interval > 12) return "Repeat interval must be between 1 and 12.";
  if (r.untilDate < start) return "The recurrence end date must be on or after the first occurrence.";
  if (eachDate(start, r.untilDate).length > MAX_SPAN_DAYS) return "Recurring events can span at most one year — create a new series after that.";
  if ((r.freq === "WEEKLY" || r.freq === "CUSTOM") && r.byWeekdays.some((d) => d < 1 || d > 7)) return "Invalid weekday.";
  return null;
}

/** All occurrence dates from `start` (inclusive) until the rule's end date (inclusive). */
export function expandOccurrences(start: ISODate, r: RecurrenceRule): ISODate[] {
  if (r.freq === "NONE") return [start];
  const out: ISODate[] = [];
  const push = (d: ISODate) => {
    if (d >= start && d <= r.untilDate && out.length < MAX_OCCURRENCES) out.push(d);
  };
  if (r.freq === "DAILY") {
    for (let d = start, i = 0; d <= r.untilDate && out.length < MAX_OCCURRENCES; d = addDays(d, 1), i++) {
      if (i % r.interval !== 0) continue;
      if (r.byWeekdays.length && !r.byWeekdays.includes(isoWeekday(d))) continue;
      push(d);
    }
  } else if (r.freq === "WEEKLY" || r.freq === "CUSTOM") {
    const days = r.byWeekdays.length ? [...new Set(r.byWeekdays)].sort() : [isoWeekday(start)];
    const firstWeek = weekKey(start);
    for (let wk = firstWeek, i = 0; wk <= r.untilDate && out.length < MAX_OCCURRENCES; wk = addDays(wk, 7), i++) {
      if (i % r.interval !== 0) continue;
      for (const wd of days) push(addDays(wk, wd - 1));
    }
  } else if (r.freq === "MONTHLY") {
    const day = Number(start.slice(8, 10));
    let y = Number(start.slice(0, 4)),
      m = Number(start.slice(5, 7));
    while (isoDate(y, m, 1) <= r.untilDate && out.length < MAX_OCCURRENCES) {
      if (day <= daysInMonth(y, m)) push(isoDate(y, m, day)); // months without that day are skipped
      m += r.interval;
      while (m > 12) {
        m -= 12;
        y++;
      }
    }
  }
  return out;
}

const PLURAL = (n: number, w: string) => (n === 1 ? w : `${n} ${w}s`);

export function describeRule(start: ISODate, r: RecurrenceRule): string {
  if (r.freq === "NONE") return "Does not repeat";
  const until = ` until ${formatDate(r.untilDate)}`;
  const days = (r.byWeekdays.length ? r.byWeekdays : [isoWeekday(start)]).map((d) => WEEKDAY_LABELS[d]).join(", ");
  switch (r.freq) {
    case "DAILY":
      return `Every ${PLURAL(r.interval, "day")}${r.byWeekdays.length ? ` (${days})` : ""}${until}`;
    case "WEEKLY":
    case "CUSTOM":
      return `Every ${r.interval === 1 ? "week" : `${r.interval} weeks`} on ${days}${until}`;
    case "MONTHLY":
      return `Every ${PLURAL(r.interval, "month")} on day ${Number(start.slice(8, 10))}${until}`;
  }
}
