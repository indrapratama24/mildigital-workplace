// Leave entitlement accrual. Pure, unit-tested.
import type { ISODate } from "../dates";

/**
 * Entitlement earned in `year` by `asOf`, accruing yearly/12 at the start of every month from the month
 * the employee became eligible (e.g. full-time since 15 Oct → Oct, Nov, Dec = 3 of 12).
 */
export function accruedEntitlement({ yearly, year, eligibleSince, asOf }: { yearly: number; year: number; eligibleSince: ISODate | null; asOf: ISODate }) {
  if (!eligibleSince || yearly <= 0) return 0;
  const yStart = `${year}-01-01`;
  const yEnd = `${year}-12-31`;
  if (eligibleSince > yEnd || asOf < yStart) return 0;
  const startMonth = eligibleSince < yStart ? 1 : Number(eligibleSince.slice(5, 7));
  const endMonth = asOf > yEnd ? 12 : Number(asOf.slice(5, 7));
  const months = Math.max(0, endMonth - startMonth + 1);
  return Math.min(yearly, Math.round(((months * yearly) / 12) * 100) / 100);
}

/** Days of a request not covered by the balance (taken as unpaid leave). */
export const unpaidDays = (remainingBefore: number, requested: number) => Math.max(0, requested - Math.max(0, remainingBefore));

// ───────────── Annual leave policy ─────────────

export interface AnnualLeaveRules {
  /** Once a year: one leave of up to this many working days. */
  tier1MaxDays: number;
  /** Once more: up to this many working days, at least `tier2GapDays` from the other longer leave. */
  tier2MaxDays: number;
  tier2GapDays: number;
  /** After both longer leaves: at most this many days per request. */
  laterMaxDays: number;
  /** Max consecutive calendar days off, including weekends inside the leave and adjoining public holidays. */
  maxOffDays: number;
  /** Max share of all employees on leave on the same date. */
  maxConcurrentPercent: number;
}

export const DEFAULT_ANNUAL_RULES: AnnualLeaveRules = { tier1MaxDays: 10, tier2MaxDays: 5, tier2GapDays: 30, laterMaxDays: 1, maxOffDays: 15, maxConcurrentPercent: 20 };

type Span = { start: ISODate; end: ISODate; days: number };
const dayNum = (d: ISODate) => Math.round(Date.parse(d) / 86_400_000);

/**
 * Usage tiers per year: one leave up to tier1 days, one more up to tier2 days (with a gap from the other),
 * then only short leaves (≤ laterMaxDays). Short leaves never use a tier. Order of booking doesn't matter.
 */
export function checkTiers(req: Span, others: Span[], r: AnnualLeaveRules): string | null {
  if (req.days > r.tier1MaxDays) return `Annual leave can be at most ${r.tier1MaxDays} working days at a time.`;
  const long = (x: Span) => x.days > r.laterMaxDays;
  if (!long(req)) return null;
  const prior = others.filter(long);
  if (prior.length === 0) return null;
  if (prior.length === 1) {
    const o = prior[0];
    if (Math.min(req.days, o.days) > r.tier2MaxDays)
      return `You already have a ${o.days}-day leave this year. Your second longer leave can be at most ${r.tier2MaxDays} working days.`;
    const gap = req.start > o.end ? dayNum(req.start) - dayNum(o.end) - 1 : dayNum(o.start) - dayNum(req.end) - 1;
    if (gap < r.tier2GapDays) return `Keep at least ${r.tier2GapDays} days (about a month) between your longer leaves — the other one is ${o.start} to ${o.end}.`;
    return null;
  }
  return `You've used both longer leaves this year (up to ${r.tier1MaxDays} and ${r.tier2MaxDays} days). Further annual leave is ${r.laterMaxDays} day at a time.`;
}

/**
 * Calendar days off in one stretch: the leave itself plus adjoining non-working days when that run
 * contains a public holiday (an ordinary weekend before/after doesn't extend it).
 */
export function offStretch(start: ISODate, end: ISODate, isOff: (d: ISODate) => boolean, isHoliday: (d: ISODate) => boolean, addDays: (d: ISODate, n: number) => ISODate) {
  let from = start;
  let to = end;
  const extend = (edge: ISODate, dir: -1 | 1) => {
    const run: ISODate[] = [];
    let d = addDays(edge, dir);
    while (isOff(d) && run.length < 31) {
      run.push(d);
      d = addDays(d, dir);
    }
    return run.some(isHoliday) ? run[run.length - 1] : null;
  };
  from = extend(start, -1) ?? from;
  to = extend(end, 1) ?? to;
  return { from, to, days: dayNum(to) - dayNum(from) + 1 };
}

/** How many people may be on leave on the same date. */
export const concurrencyCap = (headcount: number, percent: number) => Math.max(1, Math.floor((headcount * percent) / 100));
