// Loads everything the engine needs for an employee-month and returns the computed requirement,
// plans, overlays and attendance. Used by the planner, approvals, requests and compliance reports.
import type { AttendanceException, AttendanceRecord, MonthlySchedule, Request, RequestType, ScheduleDay, ScheduleRevision, ScheduleRevisionItem } from "@prisma/client";
import { db, type DbOrTx } from "../db";
import { eachDate, fromISO, isoWeekday, monthEnd, monthStart, toISO, type ISODate } from "@/lib/dates";
import { computeRequirement, isHolidayEffective, type HolidayInput, type LeaveDay, type ModeMap, type MonthRequirement } from "@/lib/engine/working-days";
import { resolvePolicy, toRules, type ResolvedPolicy } from "./policy";
import { getSettings, type AppSettings } from "./settings";

export type RequestWithType = Request & { requestType: RequestType };
export type RevisionWithItems = ScheduleRevision & { items: ScheduleRevisionItem[] };

export interface MonthContext {
  employeeId: string;
  year: number;
  month: number;
  policy: ResolvedPolicy | null;
  requirement: MonthRequirement | null;
  schedule: (MonthlySchedule & { days: ScheduleDay[] }) | null;
  plannedModes: ModeMap;
  approvedModes: ModeMap;
  records: AttendanceRecord[];
  requests: RequestWithType[];
  pendingRevisions: RevisionWithItems[];
  exceptions: AttendanceException[];
  holidays: HolidayInput[];
}

export async function getHolidays(tx: DbOrTx, from: ISODate, to: ISODate): Promise<HolidayInput[]> {
  const cal = await tx.holidayCalendar.findFirst({ where: { isDefault: true } });
  if (!cal) return [];
  const rows = await tx.holiday.findMany({ where: { calendarId: cal.id, date: { gte: fromISO(from), lte: fromISO(to) } }, orderBy: { date: "asc" } });
  return rows.map((h) => ({ date: toISO(h.date), name: h.name, type: h.type, isObserved: h.isObserved }));
}

export function portionOf(durationType: Request["durationType"]) {
  return durationType === "FULL_DAY" ? 1 : durationType === "HOURLY" ? 0 : 0.5;
}

/** Working days a request consumes (weekends and observed holidays excluded). */
export function countRequestDays(
  start: ISODate,
  end: ISODate,
  durationType: Request["durationType"],
  holidays: HolidayInput[],
  settings: Pick<AppSettings, "workingWeekdays" | "cutiBersamaIsHoliday">,
): { dates: ISODate[]; days: number } {
  const off = new Set(holidays.filter((h) => isHolidayEffective(h, settings.cutiBersamaIsHoliday)).map((h) => h.date));
  const dates = eachDate(start, end).filter((d) => settings.workingWeekdays.includes(isoWeekday(d)) && !off.has(d));
  return { dates, days: dates.length * portionOf(durationType) };
}

export function requestToLeaveDays(r: RequestWithType, from: ISODate, to: ISODate): LeaveDay[] {
  if (r.requestType.category !== "LEAVE" && r.requestType.category !== "PERMISSION") return [];
  const s = toISO(r.startDate) > from ? toISO(r.startDate) : from;
  const e = toISO(r.endDate) < to ? toISO(r.endDate) : to;
  if (s > e) return [];
  return eachDate(s, e).map((date) => ({
    date,
    portion: portionOf(r.durationType),
    category: r.requestType.category as "LEAVE" | "PERMISSION",
    label: r.requestType.name,
    typeCode: r.requestType.code,
  }));
}

export function requestOffsiteDates(r: RequestWithType, from: ISODate, to: ISODate): ISODate[] {
  if (r.requestType.category !== "OFFSITE" || r.durationType !== "FULL_DAY") return [];
  const s = toISO(r.startDate) > from ? toISO(r.startDate) : from;
  const e = toISO(r.endDate) < to ? toISO(r.endDate) : to;
  return s > e ? [] : eachDate(s, e);
}

export interface HypotheticalChanges {
  extraLeaves?: LeaveDay[];
  extraOffsite?: ISODate[];
  excludeRequestId?: string;
}

export async function loadMonthContexts(
  employeeIds: string[],
  year: number,
  month: number,
  tx: DbOrTx = db,
  hypothetical?: HypotheticalChanges,
): Promise<Map<string, MonthContext>> {
  const from = monthStart(year, month),
    to = monthEnd(year, month);
  const [settings, holidays, schedules, records, requests, revisions, exceptions] = await Promise.all([
    getSettings(tx),
    getHolidays(tx, from, to),
    tx.monthlySchedule.findMany({ where: { employeeId: { in: employeeIds }, year, month }, include: { days: true } }),
    tx.attendanceRecord.findMany({ where: { employeeId: { in: employeeIds }, date: { gte: fromISO(from), lte: fromISO(to) } } }),
    tx.request.findMany({
      where: { employeeId: { in: employeeIds }, status: { notIn: ["CANCELLED", "DRAFT"] }, startDate: { lte: fromISO(to) }, endDate: { gte: fromISO(from) } },
      include: { requestType: true },
      orderBy: { startDate: "asc" },
    }),
    tx.scheduleRevision.findMany({ where: { employeeId: { in: employeeIds }, status: "PENDING", schedule: { year, month } }, include: { items: true } }),
    tx.attendanceException.findMany({ where: { employeeId: { in: employeeIds }, year, month } }),
  ]);
  const out = new Map<string, MonthContext>();
  for (const employeeId of employeeIds) {
    const policy = await resolvePolicy(tx, employeeId, year, month);
    const schedule = schedules.find((s) => s.employeeId === employeeId) ?? null;
    const myRequests = requests.filter((r) => r.employeeId === employeeId);
    const approved = myRequests.filter((r) => r.status === "APPROVED" && r.id !== hypothetical?.excludeRequestId);
    const myExceptions = exceptions.filter((e) => e.employeeId === employeeId);
    const leaves = approved.flatMap((r) => requestToLeaveDays(r, from, to)).concat(hypothetical?.extraLeaves ?? []);
    const offsite = approved.flatMap((r) => requestOffsiteDates(r, from, to)).concat(hypothetical?.extraOffsite ?? []);
    const requirement = policy
      ? computeRequirement({
          year,
          month,
          workingWeekdays: settings.workingWeekdays,
          holidays,
          cutiBersamaIsHoliday: settings.cutiBersamaIsHoliday,
          policy: toRules(policy.version),
          leaves,
          offsiteDates: offsite,
          mandatoryWaiverDates: myExceptions.filter((e) => e.kind === "MANDATORY_DAY_WAIVER" && e.date).map((e) => toISO(e.date!)),
          wfoReductionDays: myExceptions.filter((e) => e.kind === "WFO_REDUCTION").reduce((s, e) => s + e.days, 0),
        })
      : null;
    const plannedModes: ModeMap = {};
    const approvedModes: ModeMap = {};
    for (const d of schedule?.days ?? []) {
      if (d.plannedMode) plannedModes[toISO(d.date)] = d.plannedMode;
      if (d.approvedMode) approvedModes[toISO(d.date)] = d.approvedMode;
    }
    out.set(employeeId, {
      employeeId,
      year,
      month,
      policy,
      requirement,
      schedule,
      plannedModes,
      approvedModes,
      records: records.filter((r) => r.employeeId === employeeId),
      requests: myRequests,
      pendingRevisions: revisions.filter((r) => r.employeeId === employeeId),
      exceptions: myExceptions,
      holidays,
    });
  }
  return out;
}

export async function loadMonthContext(employeeId: string, year: number, month: number, tx: DbOrTx = db, hypothetical?: HypotheticalChanges) {
  return (await loadMonthContexts([employeeId], year, month, tx, hypothetical)).get(employeeId)!;
}

/** Dates already covered by pending revisions (cannot be changed again until decided). */
export function pendingRevisionDates(ctx: MonthContext): ISODate[] {
  return ctx.pendingRevisions.flatMap((r) => r.items.map((i) => toISO(i.date)));
}
