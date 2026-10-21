import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { effectiveOn, visibleEmployeeIds } from "@/server/services/org";
import { loadMonthContexts } from "@/server/services/calendar";
import { addMonths, currentMonthJakarta, formatMonth, monthParam, WEEKDAY_SHORT, parseMonthParam, todayJakarta, toISO } from "@/lib/dates";
import { evaluatePlan } from "@/lib/engine/working-days";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { TeamFilter } from "./team-filter";

export const metadata = { title: "Team Calendar" };

export default async function TeamCalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; team?: string }> }) {
  const me = await requirePagePermission("team.view");
  const sp = await searchParams;
  const { year, month } = parseMonthParam(sp.month, currentMonthJakarta());
  const today = todayJakarta();
  const scope = await visibleEmployeeIds(me);
  const teams = await db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } });
  const employees = await db.employee.findMany({
    where: { isActive: true, id: scope ? { in: scope } : undefined, memberships: sp.team ? { some: { teamId: sp.team, ...effectiveOn(today) } } : undefined },
    select: { id: true, fullName: true, jobTitle: true },
    orderBy: { fullName: "asc" },
  });
  const ctxs = await loadMonthContexts(employees.map((e) => e.id), year, month);
  const days = [...ctxs.values()][0]?.requirement?.days ?? [];
  const prev = addMonths(year, month, -1),
    next = addMonths(year, month, 1);
  const q = (m: { year: number; month: number }) => `/team-calendar?month=${monthParam(m.year, m.month)}${sp.team ? `&team=${sp.team}` : ""}`;

  // coverage: people planned in office per day
  const officeCount = new Map<string, number>();
  for (const ctx of ctxs.values()) {
    const modes = Object.keys(ctx.approvedModes).length ? ctx.approvedModes : ctx.plannedModes;
    for (const d of ctx.requirement?.days ?? []) if (d.plannable && modes[d.date] === "WFO") officeCount.set(d.date, (officeCount.get(d.date) ?? 0) + 1);
  }

  return (
    <>
      <PageHeader eyebrow="Team Calendar" title="Who's where" description="Approved plans (or drafts when not yet approved), leave, offsite and holidays for your team. Use it to check office coverage before approving." />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-full border border-line bg-white p-1">
          <Link href={q(prev)} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-[150px] text-center font-display text-[15px] font-semibold">{formatMonth(year, month)}</span>
          <Link href={q(next)} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <TeamFilter teams={teams.map((t) => ({ id: t.id, name: t.name }))} value={sp.team ?? ""} month={monthParam(year, month)} />
      </div>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 min-w-[200px] border-b border-line bg-white px-3 py-2 text-left text-[12px] font-medium text-muted">Employee</th>
                {days.map((d) => (
                  <th key={d.date} className={cn("min-w-[34px] border-b border-line px-0.5 py-1.5 text-center font-medium", d.weekday > 5 ? "bg-canvas text-subtle" : "text-muted", d.date === today && "bg-brand-50 text-brand-700")}>
                    <div className="text-[10px] uppercase">{WEEKDAY_SHORT[d.weekday].slice(0, 2)}</div>
                    <div className="text-[12px] font-semibold">{Number(d.date.slice(8))}</div>
                  </th>
                ))}
                <th className="border-b border-line px-3 text-right font-medium text-muted">WFO</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => {
                const ctx = ctxs.get(e.id)!;
                const approved = Object.keys(ctx.approvedModes).length > 0;
                const modes = approved ? ctx.approvedModes : ctx.plannedModes;
                const ev = ctx.requirement ? evaluatePlan(ctx.requirement, modes) : null;
                const pendingDates = new Set(ctx.pendingRevisions.flatMap((r) => r.items.map((i) => toISO(i.date))));
                const pendingReq = ctx.requests.filter((r) => r.status === "PENDING_DELEGATE" || r.status === "PENDING_LEADER");
                return (
                  <tr key={e.id} className="hover:bg-canvas/50">
                    <td className="sticky left-0 z-10 border-b border-line-2 bg-white px-3 py-1.5">
                      <Link href={`/calendar?month=${monthParam(year, month)}&employee=${e.id}`} className="font-medium text-ink hover:text-brand-700">
                        {e.fullName}
                      </Link>
                      <div className="flex items-center gap-1.5 text-[11px] text-muted">
                        <StatusBadge status={ctx.schedule?.status ?? "NOT_STARTED"} className="px-1.5 py-0 text-[10.5px]" />
                      </div>
                    </td>
                    {(ctx.requirement?.days ?? days).map((d) => {
                      const m = modes[d.date];
                      const isPendingReq = pendingReq.some((r) => toISO(r.startDate) <= d.date && toISO(r.endDate) >= d.date);
                      let cls = "";
                      let label = "";
                      if (d.kind === "WEEKEND") cls = "bg-canvas";
                      else if (d.kind === "HOLIDAY") (cls = "bg-holiday-soft text-holiday"), (label = "H");
                      else if (d.kind === "LEAVE") (cls = d.leave?.category === "PERMISSION" ? "bg-permission-soft text-permission" : "bg-leave-soft text-leave"), (label = "L");
                      else if (d.kind === "OFFSITE") (cls = "bg-offsite-soft text-offsite"), (label = "OS");
                      else if (m === "WFO") (cls = approved ? "bg-wfo text-white" : "bg-wfo-soft text-wfo border border-dashed border-wfo/60"), (label = "O");
                      else if (m === "WFH") (cls = approved ? "bg-wfh-soft text-brand-600" : "bg-white text-brand-600 border border-dashed border-wfh"), (label = "H");
                      if (d.kind === "WORKDAY" && m === "WFH") label = "R";
                      return (
                        <td key={d.date} className="border-b border-line-2 p-0.5 text-center" title={`${d.date}${d.holiday ? ` · ${d.holiday.name}` : ""}${d.leave ? ` · ${d.leave.label}` : ""}`}>
                          <div className={cn("relative mx-auto flex h-7 w-full min-w-[28px] items-center justify-center rounded-md text-[10.5px] font-semibold", cls, (pendingDates.has(d.date) || isPendingReq) && "ring-2 ring-pending")}>
                            {label}
                            {d.mandatory && <span className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-current opacity-70" />}
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-b border-line-2 px-3 text-right tabular">
                      {ev ? (
                        <span className={ev.shortfall ? "text-danger" : "text-ink"}>
                          {ev.plannedWfo}/{ctx.requirement!.effectiveMinimumWfo}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td className="sticky left-0 z-10 bg-white px-3 py-2 text-[11.5px] font-medium text-muted">In office</td>
                {days.map((d) => (
                  <td key={d.date} className="py-2 text-center text-[11px] font-semibold text-brand-700 tabular">
                    {d.weekday <= 5 ? officeCount.get(d.date) ?? "" : ""}
                  </td>
                ))}
                <td />
              </tr>
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 border-t border-line-2 px-4 py-3 text-[11.5px] text-muted">
          <span><b className="text-wfo">O</b> WFO</span>
          <span><b className="text-brand-600">R</b> Remote (WFH)</span>
          <span><b className="text-leave">L</b> Leave / permission</span>
          <span><b className="text-offsite">OS</b> Offsite</span>
          <span><b className="text-holiday">H</b> Holiday</span>
          <span>Dashed = draft, not yet approved</span>
          <span>Orange ring = pending change/request</span>
          <span>Dot = mandatory day</span>
        </div>
      </Card>
    </>
  );
}
