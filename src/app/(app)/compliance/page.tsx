import Link from "next/link";
import { ChevronLeft, ChevronRight, Download, ShieldCheck } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { complianceRows, complianceTrend } from "@/server/services/compliance";
import { correctionHistory, recordsToVerify } from "@/server/services/attendance";
import { visibleEmployeeIds } from "@/server/services/org";
import { addMonths, currentMonthJakarta, formatDate, formatDateTime, formatMonth, monthParam, parseMonthParam, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat, Table } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { TrendChart } from "@/components/app/trend-chart";
import { VerifyQueue, CorrectionForm } from "./attendance-tools";

export const metadata = { title: "Attendance & Compliance" };

const yes = (v: boolean | null) => (v === null ? <span className="text-subtle">—</span> : v ? <span className="text-success">Yes</span> : <span className="font-medium text-danger">No</span>);

export default async function CompliancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const { year, month } = parseMonthParam(sp.month, currentMonthJakarta());
  const isManager = can(me, "team.view");
  const filters = { teamId: sp.team || undefined, levelId: sp.level || undefined, leaderId: sp.leader || undefined, status: sp.status || undefined, q: sp.q || undefined };
  const [mine] = await complianceRows({ ...me, role: "EMPLOYEE" }, year, month);
  const [trend, rows, teams, levels, leaders, toVerify, corrections, employees] = await Promise.all([
    complianceTrend(me.employeeId, year, month),
    isManager ? complianceRows(me, year, month, filters) : Promise.resolve([]),
    isManager ? db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }) : [],
    isManager ? db.employeeLevel.findMany({ orderBy: { rank: "asc" } }) : [],
    isManager ? db.employee.findMany({ where: { isActive: true, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : [],
    can(me, "attendance.verify") ? recordsToVerify(me, await visibleEmployeeIds(me)) : [],
    can(me, "attendance.correct") ? correctionHistory(15) : [],
    can(me, "attendance.correct") ? db.employee.findMany({ where: { isActive: true, id: { not: me.employeeId } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }) : [],
  ]);
  const prev = addMonths(year, month, -1),
    next = addMonths(year, month, 1);
  const qs = (m: { year: number; month: number }) => {
    const p = new URLSearchParams(Object.entries({ ...sp, month: monthParam(m.year, m.month) }).filter(([, v]) => v) as [string, string][]);
    return `/compliance?${p}`;
  };
  const exportQs = new URLSearchParams(Object.entries({ month: monthParam(year, month), team: sp.team, level: sp.level, leader: sp.leader, status: sp.status, q: sp.q }).filter(([, v]) => v) as [string, string][]);
  const counts = {
    onTrack: rows.filter((r) => ["ON_TRACK", "COMPLIANT"].includes(r.attendanceStatus)).length,
    risk: rows.filter((r) => ["AT_RISK", "PENDING_VERIFICATION"].includes(r.attendanceStatus)).length,
    short: rows.filter((r) => ["PROJECTED_SHORTFALL", "NON_COMPLIANT"].includes(r.attendanceStatus)).length,
    noPlan: rows.filter((r) => ["NO_PLAN", "NO_POLICY"].includes(r.attendanceStatus)).length,
  };

  return (
    <>
      <PageHeader
        eyebrow="Attendance & Compliance"
        title={formatMonth(year, month)}
        description="Planning, attendance, mandatory-day and approval compliance are measured separately. Only verified check-ins count as actual attendance."
        actions={
          <div className="flex items-center rounded-full border border-line bg-white p-1">
            <Link href={qs(prev)} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="px-2 text-[13px] font-medium">{formatMonth(year, month)}</span>
            <Link href={qs(next)} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader title="My compliance" action={mine && <StatusBadge status={mine.attendanceStatus} />} />
          <CardBody>
            {mine ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Planning" value={yes(mine.planningCompliant)} />
                <Mini label="Mandatory days" value={yes(mine.mandatoryCompliant)} />
                <Mini label="Approvals" value={yes(mine.approvalCompliant)} />
                <Mini label="Verified WFO" value={`${mine.actualWfo}/${mine.minimumWfo ?? "—"}`} />
                <Mini label="Unverified" value={mine.unverifiedWfo} />
                <Mini label="Missing check-ins" value={mine.unauthorizedAbsences} />
                <Mini label="Leave days" value={mine.leaveDays} />
                <Mini label="Replacement owed" value={mine.replacementOutstanding} />
              </div>
            ) : (
              <p className="text-sm text-muted">No data.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="My trend" description="Last 6 months" />
          <CardBody>
            {trend.some((t) => t.actual !== null) ? <TrendChart data={trend} /> : <p className="py-10 text-center text-[13px] text-muted">No approved plans in the last 6 months yet.</p>}
          </CardBody>
        </Card>
      </div>

      {isManager && (
        <section className="mt-8 space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="On track / compliant" value={counts.onTrack} tone="success" />
            <Stat label="At risk / unverified" value={counts.risk} tone="warning" />
            <Stat label="Shortfall / non-compliant" value={counts.short} tone="danger" />
            <Stat label="No approved plan" value={counts.noPlan} />
          </div>
          <Card>
            <CardHeader
              title={can(me, "company.view") ? "Company & team compliance" : "Team compliance"}
              description="Current month shows On track / At risk / Projected shortfall — final status is set after the month ends."
              action={
                <a href={`/api/export/compliance?${exportQs}`} className={buttonClass("secondary", "sm")}>
                  <Download className="h-4 w-4" /> Export CSV
                </a>
              }
            />
            <form className="flex flex-wrap gap-2 px-5 pt-4" method="get">
              <input type="hidden" name="month" value={monthParam(year, month)} />
              <Input name="q" defaultValue={sp.q} placeholder="Search name" className="h-9 w-[180px]" />
              <Select name="team" defaultValue={sp.team ?? ""} className="h-9 w-auto">
                <option value="">All teams</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </Select>
              <Select name="level" defaultValue={sp.level ?? ""} className="h-9 w-auto">
                <option value="">All levels</option>
                {levels.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </Select>
              <Select name="leader" defaultValue={sp.leader ?? ""} className="h-9 w-auto">
                <option value="">All leaders</option>
                {leaders.map((l) => (
                  <option key={l.id} value={l.id}>{l.fullName}</option>
                ))}
              </Select>
              <Select name="status" defaultValue={sp.status ?? ""} className="h-9 w-auto">
                <option value="">All statuses</option>
                {["ON_TRACK", "AT_RISK", "PROJECTED_SHORTFALL", "COMPLIANT", "NON_COMPLIANT", "PENDING_VERIFICATION", "NO_PLAN", "PENDING_LEADER_APPROVAL", "DRAFT"].map((s) => (
                  <option key={s} value={s}>{s.replace(/_/g, " ").toLowerCase()}</option>
                ))}
              </Select>
              <button className={buttonClass("primary", "sm", "h-9")}>Apply</button>
              <Link href={`/compliance?month=${monthParam(year, month)}`} className={buttonClass("ghost", "sm", "h-9")}>Reset</Link>
            </form>
            <div className="px-2 pb-3 pt-3">
              {rows.length === 0 ? (
                <EmptyState icon={ShieldCheck} title="No employees match these filters" className="m-3" />
              ) : (
                <Table className="min-w-[1240px] [&_td]:whitespace-nowrap">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Team / level</th>
                      <th>Plan</th>
                      <th className="text-right">Min</th>
                      <th className="text-right">Planned</th>
                      <th className="text-right">WFH</th>
                      <th className="text-right">Verified</th>
                      <th className="text-right">Leave</th>
                      <th className="text-right">Remaining</th>
                      <th>Planning</th>
                      <th>Mandatory</th>
                      <th>Approval</th>
                      <th>Attendance</th>
                      <th className="text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.employeeId} className="hover:bg-canvas/50">
                        <td>
                          <Link href={`/calendar?month=${monthParam(year, month)}&employee=${r.employeeId}`} className="font-medium text-ink hover:text-brand-700">{r.fullName}</Link>
                          <div className="text-[11.5px] text-muted">{r.leaderName ? `Leader: ${r.leaderName}` : r.jobTitle}</div>
                        </td>
                        <td>
                          <div>{r.teamName ?? "—"}</div>
                          <div className="text-[11.5px] text-muted">{r.levelName ?? "—"}</div>
                        </td>
                        <td><StatusBadge status={r.scheduleStatus} /></td>
                        <td className="text-right tabular">{r.minimumWfo ?? "—"}</td>
                        <td className="text-right tabular">{r.plannedWfo ?? "—"}</td>
                        <td className="text-right tabular">{r.approvedWfh ?? "—"}</td>
                        <td className="text-right tabular">{r.actualWfo}{r.unverifiedWfo ? <span className="text-warning"> +{r.unverifiedWfo}</span> : null}</td>
                        <td className="text-right tabular">{r.leaveDays}</td>
                        <td className="text-right tabular">{r.remainingWfo ?? "—"}</td>
                        <td>{yes(r.planningCompliant)}</td>
                        <td>{yes(r.mandatoryCompliant)}</td>
                        <td>{yes(r.approvalCompliant)}</td>
                        <td><StatusBadge status={r.attendanceStatus} /></td>
                        <td className="text-right tabular">{r.pendingRequests || ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </div>
          </Card>
        </section>
      )}

      {(toVerify.length > 0 || can(me, "attendance.verify")) && isManager && (
        <Card className="mt-5">
          <CardHeader title="Verify check-ins" description="Self check-ins stay unverified until a leader or HR confirms them. Only verified days count as actual attendance." />
          <CardBody>
            <VerifyQueue records={toVerify.map((r) => ({ id: r.id, name: r.employee.fullName, date: toISO(r.date), mode: r.mode, at: r.clockInAt ? formatDateTime(r.clockInAt) : "—" }))} />
          </CardBody>
        </Card>
      )}

      {can(me, "attendance.correct") && (
        <div className="mt-5 grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Attendance correction" description="HR only. A reason is mandatory; every correction is logged with before/after values." />
            <CardBody>
              <CorrectionForm employees={employees} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Recent corrections" />
            <CardBody className="space-y-2">
              {corrections.length === 0 && <p className="text-[13px] text-muted">No corrections yet.</p>}
              {corrections.map((c) => {
                const after = c.after as { mode: string; verification: string };
                return (
                  <div key={c.id} className="rounded-xl border border-line-2 px-3 py-2 text-[12.5px]">
                    <div className="font-medium text-ink">{c.record.employee.fullName} · {formatDate(toISO(c.record.date))} → {after.mode} ({after.verification.toLowerCase()})</div>
                    <div className="text-muted">“{c.reason}” · {formatDateTime(c.createdAt)}</div>
                  </div>
                );
              })}
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}

function Mini({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-canvas px-3 py-2">
      <div className="text-[11.5px] text-muted">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold text-ink tabular">{value}</div>
    </div>
  );
}
