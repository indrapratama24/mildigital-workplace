// Compliance reporting: planning, attendance, mandatory-day and approval compliance are tracked
// separately. Planned days are never reported as verified attendance.
import { db } from "../db";
import { addDays, fromISO, todayJakarta, toISO } from "@/lib/dates";
import { evaluateAttendance, evaluatePlan, type ComplianceStatus } from "@/lib/engine/working-days";
import type { CurrentUser } from "../auth/session";
import { effectiveOn, visibleEmployeeIds } from "./org";
import { loadMonthContexts } from "./calendar";
import { attendanceInputs } from "./schedules";

export interface ComplianceFilters {
  teamId?: string;
  levelId?: string;
  leaderId?: string;
  status?: string;
  q?: string;
}

export interface ComplianceRow {
  employeeId: string;
  employeeCode: string;
  fullName: string;
  jobTitle: string;
  teamName: string | null;
  levelName: string | null;
  leaderName: string | null;
  policyName: string | null;
  scheduleStatus: string;
  minimumWfo: number | null;
  eligibleDays: number | null;
  plannedWfo: number | null;
  approvedWfh: number | null;
  actualWfo: number;
  unverifiedWfo: number;
  leaveDays: number;
  remainingWfo: number | null;
  replacementOutstanding: number;
  planningCompliant: boolean | null;
  mandatoryCompliant: boolean | null;
  approvalCompliant: boolean;
  attendanceStatus: ComplianceStatus | "NO_PLAN" | "NO_POLICY";
  unauthorizedAbsences: number;
  pendingRequests: number;
  plannedPercent: number | null;
  actualPercent: number | null;
}

export async function complianceRows(viewer: CurrentUser, year: number, month: number, filters: ComplianceFilters = {}): Promise<ComplianceRow[]> {
  const scope = await visibleEmployeeIds(viewer);
  const today = todayJakarta();
  const employees = await db.employee.findMany({
    where: {
      isActive: true,
      id: scope ? { in: scope } : undefined,
      fullName: filters.q ? { contains: filters.q, mode: "insensitive" } : undefined,
      memberships: filters.teamId ? { some: { teamId: filters.teamId, ...effectiveOn(today) } } : undefined,
      levelAssignments: filters.levelId ? { some: { levelId: filters.levelId, ...effectiveOn(today) } } : undefined,
      reportsTo: filters.leaderId ? { some: { leaderId: filters.leaderId, type: "PRIMARY", ...effectiveOn(today) } } : undefined,
    },
    include: {
      memberships: { where: { isPrimary: true, ...effectiveOn(today) }, include: { team: true } },
      reportsTo: { where: { type: "PRIMARY", ...effectiveOn(today) }, include: { leader: { select: { fullName: true } } } },
    },
    orderBy: { fullName: "asc" },
  });
  const ids = employees.map((e) => e.id);
  const [contexts, pendingCounts] = await Promise.all([
    loadMonthContexts(ids, year, month),
    db.approvalWorkflow.groupBy({ by: ["requesterId"], where: { requesterId: { in: ids }, status: "PENDING" }, _count: true }),
  ]);
  const rows: ComplianceRow[] = employees.map((e) => {
    const ctx = contexts.get(e.id)!;
    const req = ctx.requirement;
    const hasApproved = Object.keys(ctx.approvedModes).length > 0;
    const plan = req && hasApproved ? evaluatePlan(req, ctx.approvedModes) : null;
    const att = req && hasApproved ? evaluateAttendance(req, ctx.approvedModes, attendanceInputs(ctx), today) : null;
    // approval compliance: actual mode on a day must match the approved plan (or be authorised by an approved request)
    let deviations = 0;
    for (const r of ctx.records) {
      const d = toISO(r.date);
      const approved = ctx.approvedModes[d];
      if (approved && r.mode !== approved && r.verification !== "REJECTED") deviations++;
    }
    const status = ctx.schedule?.status ?? "NOT_STARTED";
    return {
      employeeId: e.id,
      employeeCode: e.employeeCode,
      fullName: e.fullName,
      jobTitle: e.jobTitle,
      teamName: e.memberships[0]?.team.name ?? null,
      levelName: ctx.policy?.levelName ?? null,
      leaderName: e.reportsTo[0]?.leader.fullName ?? null,
      policyName: ctx.policy ? `${ctx.policy.version.policy.name} v${ctx.policy.version.version}` : null,
      scheduleStatus: status,
      minimumWfo: req?.effectiveMinimumWfo ?? null,
      eligibleDays: req?.attendanceEligibleDays ?? null,
      plannedWfo: plan?.plannedWfo ?? null,
      approvedWfh: plan?.plannedWfh ?? null,
      actualWfo: (att?.actualWfoVerified ?? 0) + (att?.offsiteCreditToDate ?? 0),
      unverifiedWfo: att?.actualWfoUnverified ?? 0,
      leaveDays: req ? req.fullLeaveDays + req.halfLeaveDays * 0.5 : 0,
      remainingWfo: att?.remainingRequiredWfo ?? req?.effectiveMinimumWfo ?? null,
      replacementOutstanding: plan?.shortfall ?? 0,
      planningCompliant: plan ? plan.compliant : null,
      mandatoryCompliant: att ? att.mandatoryMissed.length === 0 : plan ? plan.missingMandatoryDates.length === 0 : null,
      approvalCompliant: deviations === 0 && (hasApproved || ctx.records.length === 0),
      attendanceStatus: !req ? "NO_POLICY" : !hasApproved ? "NO_PLAN" : att!.status,
      unauthorizedAbsences: att?.unauthorizedAbsences.length ?? 0,
      pendingRequests: pendingCounts.find((p) => p.requesterId === e.id)?._count ?? 0,
      plannedPercent: plan?.plannedPercent ?? null,
      actualPercent: att ? att.attendancePercent : null,
    };
  });
  return filters.status ? rows.filter((r) => r.attendanceStatus === filters.status || r.scheduleStatus === filters.status) : rows;
}

export async function companyOverview(viewer: CurrentUser, year: number, month: number) {
  const rows = await complianceRows(viewer, year, month);
  const today = todayJakarta();
  const scope = await visibleEmployeeIds(viewer);
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
  };
  const [pendingApprovals, upcomingLeave] = await Promise.all([
    db.approvalWorkflow.count({ where: { status: "PENDING", requesterId: scope ? { in: scope } : undefined } }),
    db.request.findMany({
      where: {
        status: "APPROVED",
        employeeId: scope ? { in: scope } : undefined,
        requestType: { category: { in: ["LEAVE", "PERMISSION"] } },
        endDate: { gte: fromISO(today) },
        startDate: { lte: fromISO(addDays(today, 14)) },
      },
      include: { employee: { select: { fullName: true } }, requestType: { select: { name: true, isSensitive: true } } },
      orderBy: { startDate: "asc" },
      take: 10,
    }),
  ]);
  return {
    rows,
    totalActive: rows.length,
    submitted: rows.filter((r) => !["NOT_STARTED", "DRAFT"].includes(r.scheduleStatus)).length,
    approved: rows.filter((r) => ["APPROVED", "REVISION_PENDING"].includes(r.scheduleStatus)).length,
    pendingApprovals,
    avgPlannedPercent: avg(rows.map((r) => r.plannedPercent)),
    avgActualPercent: avg(rows.map((r) => r.actualPercent)),
    belowTarget: rows.filter((r) => ["NON_COMPLIANT", "PROJECTED_SHORTFALL", "AT_RISK"].includes(r.attendanceStatus) || r.planningCompliant === false).length,
    outstandingReplacement: rows.reduce((s, r) => s + r.replacementOutstanding, 0),
    upcomingLeave: upcomingLeave.map((l) => ({
      id: l.id,
      name: l.employee.fullName,
      // sensitive leave types are shown as generic "Leave" in overviews
      type: l.requestType.isSensitive ? "Leave" : l.requestType.name,
      start: toISO(l.startDate),
      end: toISO(l.endDate),
    })),
  };
}

const CSV_COLUMNS: [keyof ComplianceRow, string][] = [
  ["employeeCode", "Employee ID"],
  ["fullName", "Name"],
  ["teamName", "Team"],
  ["levelName", "Level"],
  ["leaderName", "Leader"],
  ["policyName", "Policy"],
  ["scheduleStatus", "Schedule status"],
  ["eligibleDays", "Attendance-eligible days"],
  ["minimumWfo", "Minimum WFO"],
  ["plannedWfo", "Planned WFO (approved)"],
  ["approvedWfh", "Approved WFH"],
  ["actualWfo", "Actual WFO (verified)"],
  ["unverifiedWfo", "Unverified WFO"],
  ["leaveDays", "Leave days"],
  ["remainingWfo", "Remaining WFO"],
  ["replacementOutstanding", "Replacement WFO outstanding"],
  ["planningCompliant", "Planning compliant"],
  ["mandatoryCompliant", "Mandatory-day compliant"],
  ["approvalCompliant", "Approval compliant"],
  ["attendanceStatus", "Attendance status"],
  ["unauthorizedAbsences", "Missing WFO check-ins"],
  ["pendingRequests", "Pending approvals"],
];

export function toCsv(rows: ComplianceRow[]) {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    // neutralise spreadsheet formula injection
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [CSV_COLUMNS.map(([, h]) => h).join(","), ...rows.map((r) => CSV_COLUMNS.map(([k]) => esc(r[k])).join(","))].join("\n");
}

/** Monthly attendance % trend for one employee (last n months). */
export async function complianceTrend(employeeId: string, year: number, month: number, n = 6) {
  const out: { label: string; year: number; month: number; planned: number | null; actual: number | null; minimum: number | null }[] = [];
  const today = todayJakarta();
  for (let i = n - 1; i >= 0; i--) {
    const idx = year * 12 + (month - 1) - i;
    const y = Math.floor(idx / 12),
      m = (idx % 12) + 1;
    const ctx = (await loadMonthContexts([employeeId], y, m)).get(employeeId)!;
    const req = ctx.requirement;
    const has = Object.keys(ctx.approvedModes).length > 0;
    out.push({
      label: `${String(m).padStart(2, "0")}/${String(y).slice(2)}`,
      year: y,
      month: m,
      planned: req && has ? evaluatePlan(req, ctx.approvedModes).plannedPercent : null,
      actual: req && has ? evaluateAttendance(req, ctx.approvedModes, attendanceInputs(ctx), today).attendancePercent : null,
      minimum: req?.effectiveWfoPercent ?? null,
    });
  }
  return out;
}
