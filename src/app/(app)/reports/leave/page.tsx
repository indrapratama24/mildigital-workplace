import Link from "next/link";
import { redirect } from "next/navigation";
import { Download, FileBarChart, X } from "lucide-react";
import type { RequestCategory } from "@prisma/client";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { canViewLeaveReport, filtersFromParams, leaveReportRows, PERIODS, REPORT_CATEGORIES, REPORT_STATUSES, summarizeLeave } from "@/server/services/leave-report";
import { formatDate, formatDateRange, formatMonth } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat, Table } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { FilterBar } from "@/components/app/filter-bar";

export const metadata = { title: "Leave & Permission Report" };

const PAGE = 50;
const CATEGORY: Record<RequestCategory, { label: string; bar: string }> = {
  LEAVE: { label: "Leave", bar: "bg-brand-600" },
  PERMISSION: { label: "Permission", bar: "bg-warning" },
  OFFSITE: { label: "Offsite duty", bar: "bg-success" },
  ADDITIONAL_WFH: { label: "Additional WFH", bar: "bg-line" },
  SCHEDULE_CHANGE: { label: "Schedule change", bar: "bg-line" },
};
const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
const amount = (days: number, hours: number) => [days ? `${n(days)} d` : "", hours ? `${n(hours)} h` : ""].filter(Boolean).join(" · ") || "—";

export default async function LeaveReportPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePageUser();
  if (!canViewLeaveReport(me)) redirect("/overview");
  const sp = await searchParams;
  const f = filtersFromParams((k) => sp[k]);
  const company = can(me, "company.view");
  const [rows, teams, levels, types, person] = await Promise.all([
    leaveReportRows(me, f),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" }, select: { id: true, name: true } }),
    db.requestType.findMany({ where: { category: { in: REPORT_CATEGORIES } }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    f.employeeId ? db.employee.findUnique({ where: { id: f.employeeId }, select: { fullName: true } }) : null,
  ]);
  const s = summarizeLeave(rows);
  const page = Math.max(1, Number(sp.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);

  const keep = { period: f.period, from: f.period === "custom" ? f.from : undefined, to: f.period === "custom" ? f.to : undefined, team: f.teamId, level: f.levelId, employee: f.employeeId, q: f.q, type: f.typeId, category: f.category, status: f.status };
  const href = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ ...keep, ...over }).filter(([, v]) => v) as [string, string][]);
    return `/reports/leave?${p}`;
  };
  const exportHref = `/api/export/leave?${new URLSearchParams(Object.entries(keep).filter(([, v]) => v) as [string, string][])}`;
  const active = [f.teamId, f.levelId, f.typeId, f.category, f.status].filter(Boolean).length;
  const monthMax = Math.max(1, ...s.byMonth.map((m) => REPORT_CATEGORIES.reduce((t, c) => t + (m[c] ?? 0), 0)));

  return (
    <>
      <PageHeader
        eyebrow="Requests & Approvals"
        title="Leave & Permission Report"
        description={`${company ? "Everyone in the company" : "You and your direct reports"} · ${formatDateRange(f.from, f.to)}. Requests count in the period they start; days and hours count approved requests only.`}
        actions={
          can(me, "report.export") || can(me, "team.view") ? (
            <a href={exportHref} className={buttonClass("secondary")}><Download className="h-4 w-4" /> Export CSV</a>
          ) : undefined
        }
      />

      <Card className="mb-5">
        <FilterBar search={{ name: "q", value: f.q, placeholder: "Search name" }} activeCount={active} resetHref={`/reports/leave?period=${f.period}`} hidden={{ employee: f.employeeId }}>
          <Select name="period" defaultValue={f.period} aria-label="Period">
            {PERIODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </Select>
          {f.period === "custom" && (
            <>
              <input type="date" name="from" defaultValue={f.from} aria-label="From" className="h-10 rounded-xl border border-line bg-white px-3 text-sm" />
              <input type="date" name="to" defaultValue={f.to} aria-label="To" className="h-10 rounded-xl border border-line bg-white px-3 text-sm" />
            </>
          )}
          <Select name="team" defaultValue={f.teamId ?? ""} aria-label="Team">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="level" defaultValue={f.levelId ?? ""} aria-label="Level">
            <option value="">All levels</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select name="category" defaultValue={f.category ?? ""} aria-label="Category">
            <option value="">Leave, permission & offsite</option>
            {REPORT_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY[c].label}</option>)}
          </Select>
          <Select name="type" defaultValue={f.typeId ?? ""} aria-label="Request type">
            <option value="">All request types</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="status" defaultValue={f.status ?? ""} aria-label="Status">
            <option value="">All statuses</option>
            {REPORT_STATUSES.map((st) => <option key={st} value={st}>{st.replace(/_/g, " ").toLowerCase()}</option>)}
          </Select>
        </FilterBar>
        {person && (
          <div className="-mt-1 px-4 pb-4">
            <Link href={href({ employee: undefined })} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3 py-1 text-[12.5px] font-medium text-brand-700 hover:bg-brand-100">
              Only {person.fullName} <X className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}
      </Card>

      {rows.length === 0 ? (
        <EmptyState icon={FileBarChart} title="No requests in this period" description="Try a longer period or fewer filters. Drafts are never included." />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Approved days" value={n(s.totals.days)} hint={`${s.totals.approved} approved request${s.totals.approved === 1 ? "" : "s"}`} tone="brand" />
            <Stat label="Hourly permission" value={`${n(s.totals.hours)} h`} hint="Approved hours" />
            <Stat label="Requests" value={s.totals.requests} hint={`${s.totals.people} people`} />
            <Stat label="Pending" value={s.totals.pending} tone={s.totals.pending ? "warning" : "default"} hint="Waiting for a decision" />
            <Stat label="Rejected / cancelled" value={`${s.totals.rejected} / ${s.totals.cancelled}`} tone={s.totals.rejected ? "danger" : "default"} />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="By request type" />
              <div className="px-2 pb-3">
                <Table>
                  <thead><tr><th>Type</th><th className="text-right">Requests</th><th className="text-right">Approved</th><th className="text-right">Days / hours</th></tr></thead>
                  <tbody>
                    {s.byType.map((t) => (
                      <tr key={t.name}>
                        <td><span className={cn("mr-2 inline-block h-2 w-2 rounded-full", CATEGORY[t.category].bar)} />{t.name}</td>
                        <td className="text-right tabular">{t.requests}</td>
                        <td className="text-right tabular">{t.approved}</td>
                        <td className="text-right tabular">{amount(t.days, t.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
            <Card>
              <CardHeader title="By month" description="Approved days by start month (8 permission hours = 1 day)." />
              <CardBody>
                {s.byMonth.length === 0 ? (
                  <p className="py-8 text-center text-[13px] text-muted">No approved requests yet.</p>
                ) : (
                  <>
                    <div className="flex h-44 items-end gap-2">
                      {s.byMonth.map((m) => {
                        const total = REPORT_CATEGORIES.reduce((t, c) => t + (m[c] ?? 0), 0);
                        return (
                          <div key={m.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${formatMonth(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7)))}: ${n(total)} days`}>
                            <span className="text-[11px] font-medium text-ink-2 tabular">{n(total)}</span>
                            <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-md" style={{ height: `${(total / monthMax) * 100}%` }}>
                              {REPORT_CATEGORIES.map((c) => (m[c] ? <div key={c} className={CATEGORY[c].bar} style={{ height: `${(m[c]! / total) * 100}%` }} /> : null))}
                            </div>
                            <span className="text-[11px] text-muted">{formatMonth(Number(m.month.slice(0, 4)), Number(m.month.slice(5, 7))).slice(0, 3)}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap gap-3 text-[12px] text-muted">
                      {REPORT_CATEGORIES.map((c) => <span key={c} className="inline-flex items-center gap-1.5"><span className={cn("h-2.5 w-2.5 rounded-sm", CATEGORY[c].bar)} />{CATEGORY[c].label}</span>)}
                    </div>
                  </>
                )}
              </CardBody>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card>
              <CardHeader title="By team" />
              <div className="px-2 pb-3">
                <Table>
                  <thead><tr><th>Team</th><th className="text-right">People</th><th className="text-right">Days / hours</th></tr></thead>
                  <tbody>
                    {s.byTeam.map((t) => (
                      <tr key={t.name}>
                        <td>{t.name}</td>
                        <td className="text-right tabular">{t.people}</td>
                        <td className="text-right tabular">{amount(t.days, t.hours)}</td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </div>
            </Card>
            <TopList title="Most days away" empty="No approved full or half days." people={s.topDays.map((p) => ({ id: p.employeeId, name: p.name, team: p.teamName, value: amount(p.days, 0), sub: `${p.approved} request${p.approved === 1 ? "" : "s"}` }))} href={(id) => href({ employee: id, page: undefined })} />
            <TopList title="Most permissions" empty="No approved permissions." people={s.topPermissions.map((p) => ({ id: p.employeeId, name: p.name, team: p.teamName, value: `${p.byCategory.PERMISSION}×`, sub: p.hours ? `${n(p.hours)} h hourly` : "" }))} href={(id) => href({ employee: id, page: undefined })} />
          </div>

          <Card>
            <CardHeader title="History" description={`${rows.length} request${rows.length === 1 ? "" : "s"}, newest first. Open a row for its approval trail.`} />
            <div className="px-2 pb-3">
              <Table className="min-w-[900px] [&_td]:whitespace-nowrap">
                <thead>
                  <tr><th className="freeze-col">Employee</th><th>Type</th><th>Dates</th><th>Duration</th><th className="text-right">Days / hours</th><th>Status</th><th>Decided</th></tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas/60">
                      <td className="freeze-col">
                        <Link href={href({ employee: r.employeeId, page: undefined })} className="font-medium text-ink hover:text-brand-700">{r.fullName}</Link>
                        <div className="text-[11.5px] text-muted">{r.teamName ?? "—"}</div>
                      </td>
                      <td><Link href={`/requests/${r.id}`} className="text-ink hover:text-brand-700 hover:underline">{r.typeName}</Link></td>
                      <td>{formatDateRange(r.startDate, r.endDate)}</td>
                      <td className="text-muted">{r.durationType === "HOURLY" ? `${r.startTime}–${r.endTime}` : r.durationType === "FULL_DAY" ? "Full day" : r.durationType === "HALF_DAY_AM" ? "Half day (AM)" : "Half day (PM)"}</td>
                      <td className="text-right tabular">{amount(r.days, r.hours)}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-muted">{r.decidedAt ? formatDate(r.decidedAt) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {pages > 1 && (
                <div className="flex items-center justify-between px-3 pt-3 text-[13px] text-muted">
                  <span>Page {page} of {pages}</span>
                  <div className="flex gap-2">
                    {page > 1 && <Link href={href({ page: String(page - 1) })} className={buttonClass("secondary", "sm")}>Previous</Link>}
                    {page < pages && <Link href={href({ page: String(page + 1) })} className={buttonClass("secondary", "sm")}>Next</Link>}
                  </div>
                </div>
              )}
            </div>
          </Card>
        </div>
      )}
    </>
  );
}

function TopList({ title, empty, people, href }: { title: string; empty: string; people: { id: string; name: string; team: string | null; value: string; sub: string }[]; href: (id: string) => string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <CardBody className="space-y-1 pt-0">
        {people.length === 0 && <p className="py-4 text-[13px] text-muted">{empty}</p>}
        {people.map((p, i) => (
          <Link key={p.id} href={href(p.id)} className="flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-canvas">
            <span className="w-4 text-[12px] text-subtle tabular">{i + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13.5px] font-medium text-ink">{p.name}</span>
              <span className="block truncate text-[11.5px] text-muted">{p.team ?? "—"}</span>
            </span>
            <span className="text-right">
              <span className="block text-[13.5px] font-semibold text-ink tabular">{p.value}</span>
              {p.sub && <span className="block text-[11px] text-muted">{p.sub}</span>}
            </span>
          </Link>
        ))}
      </CardBody>
    </Card>
  );
}
