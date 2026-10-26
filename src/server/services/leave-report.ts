// Leave & permission report: request history plus totals by type, team, person and month for HR,
// Super Admin (whole company) and leaders (their direct reports). Drafts are never included.
// A request belongs to the period in which it starts; days and hours count approved requests only.
import type { Prisma, RequestCategory, RequestStatus } from "@prisma/client";
import { db } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden } from "../errors";
import { effectiveOn, visibleEmployeeIds } from "./org";
import { fromISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";

export const REPORT_CATEGORIES: RequestCategory[] = ["LEAVE", "PERMISSION", "OFFSITE"];
export const REPORT_STATUSES: RequestStatus[] = ["PENDING_DELEGATE", "PENDING_LEADER", "APPROVED", "REJECTED", "CHANGES_REQUESTED", "CANCELLED"];
const PENDING: RequestStatus[] = ["PENDING_DELEGATE", "PENDING_LEADER", "CHANGES_REQUESTED"];

export interface LeaveReportFilters {
  from: ISODate;
  to: ISODate;
  teamId?: string;
  levelId?: string;
  employeeId?: string;
  q?: string;
  typeId?: string;
  category?: RequestCategory;
  status?: RequestStatus;
}

export interface LeaveReportRow {
  id: string;
  employeeId: string;
  employeeCode: string;
  fullName: string;
  teamName: string | null;
  typeName: string;
  category: RequestCategory;
  startDate: ISODate;
  endDate: ISODate;
  durationType: string;
  startTime: string | null;
  endTime: string | null;
  days: number;
  hours: number;
  status: RequestStatus;
  submittedAt: Date | null;
  decidedAt: Date | null;
}

export const canViewLeaveReport = (u: CurrentUser) => can(u, "company.view") || can(u, "team.view");

/** Hours of an hourly request ("09:00"–"11:30" → 2.5). */
export function hoursOf(start: string | null, end: string | null) {
  if (!start || !end) return 0;
  const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return Math.max(0, m(end) - m(start)) / 60;
}

const round = (n: number) => Math.round(n * 100) / 100;

export async function leaveReportRows(viewer: CurrentUser, f: LeaveReportFilters): Promise<LeaveReportRow[]> {
  if (!canViewLeaveReport(viewer)) throw forbidden();
  const scope = await visibleEmployeeIds(viewer);
  const today = todayJakarta();
  const employee: Prisma.EmployeeWhereInput = {
    id: f.employeeId ? (scope && !scope.includes(f.employeeId) ? { in: [] } : f.employeeId) : scope ? { in: scope } : undefined,
    fullName: f.q ? { contains: f.q, mode: "insensitive" } : undefined,
    memberships: f.teamId ? { some: { teamId: f.teamId, ...effectiveOn(today) } } : undefined,
    levelAssignments: f.levelId ? { some: { levelId: f.levelId, ...effectiveOn(today) } } : undefined,
  };
  const requests = await db.request.findMany({
    where: {
      status: f.status ?? { in: REPORT_STATUSES },
      startDate: { gte: fromISO(f.from), lte: fromISO(f.to) },
      requestTypeId: f.typeId || undefined,
      requestType: { category: f.category ?? { in: REPORT_CATEGORIES } },
      employee,
    },
    include: {
      requestType: { select: { name: true, category: true } },
      employee: { select: { id: true, fullName: true, employeeCode: true, memberships: { where: { isPrimary: true, ...effectiveOn(today) }, include: { team: { select: { name: true } } } } } },
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
  });
  return requests.map((r) => ({
    id: r.id,
    employeeId: r.employee.id,
    employeeCode: r.employee.employeeCode,
    fullName: r.employee.fullName,
    teamName: r.employee.memberships[0]?.team.name ?? null,
    typeName: r.requestType.name,
    category: r.requestType.category,
    startDate: toISO(r.startDate),
    endDate: toISO(r.endDate),
    durationType: r.durationType,
    startTime: r.startTime,
    endTime: r.endTime,
    days: r.durationType === "HOURLY" ? 0 : r.workingDays,
    hours: r.durationType === "HOURLY" ? hoursOf(r.startTime, r.endTime) : 0,
    status: r.status,
    submittedAt: r.submittedAt,
    decidedAt: r.decidedAt,
  }));
}

type Bucket = { requests: number; approved: number; days: number; hours: number };
const bucket = (): Bucket => ({ requests: 0, approved: 0, days: 0, hours: 0 });
function add(b: Bucket, r: LeaveReportRow) {
  b.requests++;
  if (r.status !== "APPROVED") return;
  b.approved++;
  b.days += r.days;
  b.hours += r.hours;
}
const tidy = <T extends Bucket>(b: T): T => ({ ...b, days: round(b.days), hours: round(b.hours) });

export function summarizeLeave(rows: LeaveReportRow[]) {
  const totals = { ...bucket(), pending: 0, rejected: 0, cancelled: 0, people: new Set<string>() };
  const byType = new Map<string, Bucket & { name: string; category: RequestCategory }>();
  const byTeam = new Map<string, Bucket & { name: string; people: Set<string> }>();
  const byPerson = new Map<string, Bucket & { employeeId: string; name: string; teamName: string | null; byCategory: Partial<Record<RequestCategory, number>> }>();
  const byMonth = new Map<string, Partial<Record<RequestCategory, number>>>();
  for (const r of rows) {
    add(totals, r);
    totals.people.add(r.employeeId);
    if (PENDING.includes(r.status)) totals.pending++;
    if (r.status === "REJECTED") totals.rejected++;
    if (r.status === "CANCELLED") totals.cancelled++;

    const t = byType.get(r.typeName) ?? { ...bucket(), name: r.typeName, category: r.category };
    add(t, r);
    byType.set(r.typeName, t);

    const teamKey = r.teamName ?? "No team";
    const tm = byTeam.get(teamKey) ?? { ...bucket(), name: teamKey, people: new Set<string>() };
    add(tm, r);
    tm.people.add(r.employeeId);
    byTeam.set(teamKey, tm);

    const p = byPerson.get(r.employeeId) ?? { ...bucket(), employeeId: r.employeeId, name: r.fullName, teamName: r.teamName, byCategory: {} };
    add(p, r);
    if (r.status === "APPROVED") p.byCategory[r.category] = (p.byCategory[r.category] ?? 0) + 1;
    byPerson.set(r.employeeId, p);

    if (r.status === "APPROVED") {
      const m = byMonth.get(r.startDate.slice(0, 7)) ?? {};
      m[r.category] = round((m[r.category] ?? 0) + r.days + r.hours / 8);
      byMonth.set(r.startDate.slice(0, 7), m);
    }
  }
  const byDays = (a: Bucket, b: Bucket) => b.days - a.days || b.hours - a.hours || b.requests - a.requests;
  const people = [...byPerson.values()].map(tidy);
  return {
    totals: { ...tidy(totals), people: totals.people.size },
    byType: [...byType.values()].map(tidy).sort(byDays),
    byTeam: [...byTeam.values()].map((t) => ({ ...tidy(t), people: t.people.size })).sort(byDays),
    topDays: people.filter((p) => p.days > 0).sort(byDays).slice(0, 8),
    topPermissions: people
      .filter((p) => (p.byCategory.PERMISSION ?? 0) > 0)
      .sort((a, b) => (b.byCategory.PERMISSION ?? 0) - (a.byCategory.PERMISSION ?? 0) || b.hours - a.hours)
      .slice(0, 8),
    byMonth: [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v })),
  };
}

export const LEAVE_CSV_COLUMNS: [keyof LeaveReportRow, string][] = [
  ["employeeCode", "Employee ID"],
  ["fullName", "Name"],
  ["teamName", "Team"],
  ["typeName", "Request type"],
  ["category", "Category"],
  ["startDate", "Start"],
  ["endDate", "End"],
  ["durationType", "Duration"],
  ["startTime", "From"],
  ["endTime", "To"],
  ["days", "Working days"],
  ["hours", "Hours"],
  ["status", "Status"],
  ["submittedAt", "Submitted"],
  ["decidedAt", "Decided"],
];

export function leaveCsv(rows: LeaveReportRow[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [LEAVE_CSV_COLUMNS.map(([, h]) => h).join(","), ...rows.map((r) => LEAVE_CSV_COLUMNS.map(([k]) => esc(r[k])).join(","))].join("\n");
}

// ── Query string ⇄ filters (shared by the page and the CSV export) ──

export const PERIODS = [
  ["month", "This month"],
  ["last-month", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
  ["last-year", "Last year"],
  ["custom", "Custom range"],
] as const;

export function resolvePeriod(period: string | undefined, from: string | undefined, to: string | undefined, today: ISODate = todayJakarta()) {
  const y = Number(today.slice(0, 4)),
    m = Number(today.slice(5, 7));
  const pad = (n: number) => String(n).padStart(2, "0");
  const end = (yy: number, mm: number) => toISO(new Date(Date.UTC(yy, mm, 0)));
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  switch (period) {
    case "month":
      return { period, from: `${y}-${pad(m)}-01`, to: end(y, m) };
    case "last-month": {
      const [yy, mm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { period, from: `${yy}-${pad(mm)}-01`, to: end(yy, mm) };
    }
    case "quarter": {
      const q = Math.floor((m - 1) / 3) * 3 + 1;
      return { period, from: `${y}-${pad(q)}-01`, to: end(y, q + 2) };
    }
    case "last-year":
      return { period, from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
    case "custom":
      if (from && to && iso.test(from) && iso.test(to) && from <= to) return { period, from, to };
    // fall through to the default when the custom range is incomplete
    default:
      return { period: period === "custom" ? "custom" : "year", from: from && iso.test(from) ? from : `${y}-01-01`, to: to && iso.test(to) ? to : `${y}-12-31` };
  }
}

export function filtersFromParams(get: (k: string) => string | undefined): LeaveReportFilters & { period: string } {
  const p = resolvePeriod(get("period"), get("from"), get("to"));
  const category = get("category") as RequestCategory | undefined;
  const status = get("status") as RequestStatus | undefined;
  return {
    ...p,
    teamId: get("team") || undefined,
    levelId: get("level") || undefined,
    employeeId: get("employee") || undefined,
    q: get("q") || undefined,
    typeId: get("type") || undefined,
    category: category && REPORT_CATEGORIES.includes(category) ? category : undefined,
    status: status && REPORT_STATUSES.includes(status) ? status : undefined,
  };
}
