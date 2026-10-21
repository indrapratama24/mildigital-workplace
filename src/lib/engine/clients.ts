// Pure client-portfolio rules: collaboration period, status-on-date, counting and assignment validation.
// No database access here so the rules are unit-testable and reusable by the future Performance module.
import { addDays, type ISODate } from "../dates";

export type ClientStatusT = "ACTIVE" | "INACTIVE" | "FREEZE";
export type ClientRoleT = "CONSULTANT_PRIMARY" | "CONSULTANT_SECONDARY" | "CONSULTANT_ADDITIONAL" | "ADS_STRATEGIST";

export const MAX_ADS_STRATEGISTS = 3;
export const CLIENT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,29}$/;

export interface StatusPeriod {
  status: ClientStatusT;
  from: ISODate;
  to: ISODate | null;
}

export const clientCode = (n: number) => `MIL-CL-${String(n).padStart(4, "0")}`;

/** Calendar difference in whole years, months and remaining days (month ends clamp, e.g. 31 Jan + 1 month = 28 Feb). */
export function durationParts(from: ISODate, to: ISODate) {
  if (to < from) return { years: 0, months: 0, days: 0 };
  const [fy, fm, fd] = from.split("-").map(Number);
  const anchor = (m: number) => {
    const y = fy + Math.floor((fm - 1 + m) / 12);
    const mo = ((fm - 1 + m) % 12) + 1;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    return `${y}-${String(mo).padStart(2, "0")}-${String(Math.min(fd, last)).padStart(2, "0")}`;
  };
  const [ty, tm] = to.split("-").map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  while (months > 0 && anchor(months) > to) months--;
  const days = Math.round((Date.parse(to) - Date.parse(anchor(months))) / 86_400_000);
  return { years: Math.floor(months / 12), months: months % 12, days };
}

export function formatDuration(p: { years: number; months: number; days: number }, withDays = true) {
  const parts: string[] = [];
  if (p.years) parts.push(`${p.years} yr${p.years > 1 ? "s" : ""}`);
  if (p.months) parts.push(`${p.months} mo`);
  if (withDays && p.days && !p.years && !p.months) parts.push(`${p.days} day${p.days > 1 ? "s" : ""}`);
  return parts.length ? parts.join(" ") : withDays ? "0 days" : "< 1 mo";
}

const daysBetween = (a: ISODate, b: ISODate) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) + 1;

/** Number of days in `periods` with the given status, clipped to [from, to]. */
export function daysInStatus(periods: StatusPeriod[], status: ClientStatusT, from: ISODate, to: ISODate) {
  let total = 0;
  for (const p of periods) {
    if (p.status !== status) continue;
    const a = p.from > from ? p.from : from;
    const pEnd = p.to ?? to;
    const b = pEnd < to ? pEnd : to;
    if (b >= a) total += daysBetween(a, b);
  }
  return total;
}

/**
 * Collaboration period shown on the directory and detail pages.
 *  - Active: Date START → today
 *  - Inactive: Date START → Date OFF
 *  - Freeze: elapsed Date START → today, with the current suspension shown separately
 * Inactive/freeze gaps from earlier engagements are reported as `pausedDays` so reactivations stay visible.
 */
export function collaborationPeriod(
  c: { status: ClientStatusT; dateStart: ISODate; dateOff: ISODate | null; history: StatusPeriod[] },
  today: ISODate,
) {
  const end = c.status === "INACTIVE" && c.dateOff ? c.dateOff : today;
  const total = durationParts(c.dateStart, end);
  const activeDays = daysInStatus(c.history, "ACTIVE", c.dateStart, end);
  const frozenDays = daysInStatus(c.history, "FREEZE", c.dateStart, end);
  const inactiveDays = daysInStatus(c.history, "INACTIVE", c.dateStart, c.status === "INACTIVE" ? addDays(end, -1) : end);
  const open = c.history.find((h) => h.to === null);
  const freezeSince = c.status === "FREEZE" && open?.status === "FREEZE" ? open.from : null;
  return {
    end,
    total,
    label: c.dateStart > today ? "Starts soon" : formatDuration(total),
    activeDays,
    frozenDays,
    inactiveDays,
    freezeSince,
    freezeLabel: freezeSince ? formatDuration(durationParts(freezeSince, today)) : null,
    reactivated: c.history.filter((h) => h.status === "ACTIVE").length > 1,
  };
}

export function statusOn(history: StatusPeriod[], date: ISODate): ClientStatusT | null {
  const p = history.find((h) => h.from <= date && (h.to === null || h.to >= date));
  return p?.status ?? null;
}

/** A client is "new" in a period only when its first collaboration starts inside it (reactivations are not new). */
export const isNewIn = (dateStart: ISODate, from: ISODate, to: ISODate) => dateStart >= from && dateStart <= to;

export interface TeamInput {
  primary: string | null;
  secondary: string | null;
  additional: string[];
  adsStrategists: string[];
}

export function validateTeam(t: TeamInput, opts: { status: ClientStatusT; requirePrimary: boolean; waived: boolean }) {
  const errors: string[] = [];
  const all = [t.primary, t.secondary, ...t.additional, ...t.adsStrategists].filter((x): x is string => !!x);
  if (new Set(all).size !== all.length) errors.push("Each employee can hold only one role on a client.");
  if (t.adsStrategists.length > MAX_ADS_STRATEGISTS) errors.push(`A client can have at most ${MAX_ADS_STRATEGISTS} Ads Strategists.`);
  if (!t.primary && t.secondary) errors.push("Assign Consultant 1 before Consultant 2.");
  if (opts.status === "ACTIVE" && opts.requirePrimary && !t.primary && !opts.waived) errors.push("Active clients need Consultant 1 (or an approved exception).");
  return errors;
}

/** Flattens the form's team into role rows. */
export function teamRows(t: TeamInput): { employeeId: string; role: ClientRoleT }[] {
  return [
    ...(t.primary ? [{ employeeId: t.primary, role: "CONSULTANT_PRIMARY" as const }] : []),
    ...(t.secondary ? [{ employeeId: t.secondary, role: "CONSULTANT_SECONDARY" as const }] : []),
    ...t.additional.map((employeeId) => ({ employeeId, role: "CONSULTANT_ADDITIONAL" as const })),
    ...t.adsStrategists.map((employeeId) => ({ employeeId, role: "ADS_STRATEGIST" as const })),
  ];
}

export const CLIENT_ROLE_LABEL: Record<ClientRoleT, string> = {
  CONSULTANT_PRIMARY: "Consultant 1",
  CONSULTANT_SECONDARY: "Consultant 2",
  CONSULTANT_ADDITIONAL: "Additional Consultant",
  ADS_STRATEGIST: "Ads Strategist",
};

export const CLIENT_STATUS_LABEL: Record<ClientStatusT, string> = { ACTIVE: "Active", INACTIVE: "Inactive", FREEZE: "Freeze" };
