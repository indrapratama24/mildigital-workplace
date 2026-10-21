import Link from "next/link";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Building2, ListTodo, Plus, Star, UserCheck } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { canCreateEvents, getGrants } from "@/server/services/calendar-access";
import { getOffDays, listEvents, toChip, type EventChip, type EventFilters, type OffDay } from "@/server/services/events";
import { addDays, addMonths, currentMonthJakarta, eachDate, formatDate, formatDateLong, formatMonth, formatWeekdayShort, isValidISO, monthEnd, monthParam, monthStart, parseMonthParam, todayJakarta, weekKey, WEEKDAY_SHORT } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Stat } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { EventDialogProvider } from "@/components/app/events/event-dialog";
import { EventChip as Chip } from "@/components/app/events/event-chip";
import { MoreEvents } from "./more-events";
import { LOCATION_LABEL } from "@/components/app/events/labels";

export const metadata = { title: "Internal Calendar" };

type SP = Record<string, string | undefined>;

export default async function InternalCalendarPage({ searchParams }: { searchParams: Promise<SP> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const view = sp.view === "week" ? "week" : sp.view === "agenda" ? "agenda" : "month";
  const today = todayJakarta();
  const { year, month } = parseMonthParam(sp.month, currentMonthJakarta());
  const weekStart = weekKey(sp.date && isValidISO(sp.date) ? sp.date : today);
  const from = view === "week" ? weekStart : view === "agenda" ? (sp.from && isValidISO(sp.from) ? sp.from : today) : monthStart(year, month);
  const to = view === "week" ? addDays(weekStart, 6) : view === "agenda" ? (sp.to && isValidISO(sp.to) ? sp.to : addDays(from, 60)) : monthEnd(year, month);
  const filters: EventFilters = {
    categoryId: sp.category,
    teamId: sp.team,
    departmentId: sp.department,
    organizerId: sp.organizer,
    participantId: sp.participant,
    attendance: sp.attendance === "MANDATORY" || sp.attendance === "OPTIONAL" ? sp.attendance : undefined,
    locationType: ["IN_OFFICE", "ONLINE", "HYBRID", "EXTERNAL"].includes(sp.mode ?? "") ? (sp.mode as EventFilters["locationType"]) : undefined,
    q: sp.q,
    mine: sp.mine === "1",
    includeCancelled: sp.cancelled === "1",
  };
  const grants = await getGrants(me);
  const [events, monthEvents, upcoming, categories, teams, departments, people, canCreate] = await Promise.all([
    listEvents(me, from, to, filters, grants),
    listEvents(me, monthStart(year, month), monthEnd(year, month), {}, grants),
    listEvents(me, today, addDays(today, 14), {}, grants),
    db.internalEventCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    canCreateEvents(me, grants),
  ]);
  const offDays = await getOffDays(db, view === "month" ? weekKey(monthStart(year, month)) : from, view === "month" ? addDays(weekKey(monthEnd(year, month)), 6) : to);
  const chips = events.map(toChip);
  const published = monthEvents.filter((e) => e.status === "PUBLISHED");
  const byDate = new Map<string, EventChip[]>();
  for (const c of chips) for (const d of eachDate(c.date < from ? from : c.date, c.endDate > to ? to : c.endDate)) byDate.set(d, [...(byDate.get(d) ?? []), c]);

  const q = (patch: SP) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `/internal-calendar?${p}`;
  };
  const prev = view === "week" ? q({ date: addDays(weekStart, -7) }) : q({ month: monthParam(addMonths(year, month, -1).year, addMonths(year, month, -1).month) });
  const next = view === "week" ? q({ date: addDays(weekStart, 7) }) : q({ month: monthParam(addMonths(year, month, 1).year, addMonths(year, month, 1).month) });
  const title = view === "week" ? `${formatDate(weekStart)} – ${formatDate(addDays(weekStart, 6))}` : view === "agenda" ? `${formatDate(from)} – ${formatDate(to)}` : formatMonth(year, month);

  return (
    <EventDialogProvider>
      <PageHeader
        eyebrow="Internal Calendar"
        title="Learning & internal events"
        description="Company meetings, L&D sessions, workshops and team alignments. Events you're assigned to also appear in your work calendar."
        actions={
          canCreate && (
            <Link href={`/internal-calendar/events/new${view === "month" ? `?date=${monthStart(year, month) > today ? monthStart(year, month) : today}` : ""}`} className={buttonClass("primary")}>
              <Plus className="h-4 w-4" /> New event
            </Link>
          )
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label={`Events in ${formatMonth(year, month).split(" ")[0]}`} value={published.length} icon={CalendarDays} />
        <Stat label="Upcoming (14 days)" value={upcoming.filter((e) => e.status === "PUBLISHED").length} icon={CalendarClock} />
        <Stat label="My assigned events" value={published.filter((e) => e.participants.length).length} icon={UserCheck} tone="brand" />
        <Stat label="Mandatory events" value={published.filter((e) => e.attendanceRequirement === "MANDATORY").length} icon={Star} />
        <Stat label="In-office required" value={published.filter((e) => e.wfoRequirement === "IN_OFFICE_REQUIRED").length} icon={Building2} />
      </div>

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-full border border-line bg-white p-1" role="tablist">
            {(["month", "week", "agenda"] as const).map((v) => (
              <Link key={v} href={q({ view: v === "month" ? undefined : v })} role="tab" aria-selected={view === v} className={cn("rounded-full px-4 py-1.5 text-[13.5px] font-medium capitalize", view === v ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>
                {v}
              </Link>
            ))}
          </div>
          {view !== "agenda" && (
            <div className="flex items-center rounded-full border border-line bg-white p-1">
              <Link href={prev} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Previous">
                <ChevronLeft className="h-4 w-4" />
              </Link>
              <span className="min-w-[170px] px-2 text-center font-display text-[15px] font-semibold text-ink">{title}</span>
              <Link href={next} className="rounded-full p-1.5 text-muted hover:bg-brand-50" aria-label="Next">
                <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          )}
          <Link href={q({ mine: filters.mine ? undefined : "1" })} className={cn("inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[13px] font-medium", filters.mine ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-2 hover:border-brand-200")} aria-pressed={filters.mine}>
            <span className={cn("h-3.5 w-6 rounded-full p-0.5 transition-colors", filters.mine ? "bg-white/30" : "bg-line")}>
              <span className={cn("block h-2.5 w-2.5 rounded-full bg-white transition-transform", filters.mine && "translate-x-2.5")} />
            </span>
            My events only
          </Link>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {categories.map((c) => (
            <Link key={c.id} href={q({ category: sp.category === c.id ? undefined : c.id })} className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px]", sp.category === c.id ? "border-ink bg-ink text-white" : "border-line bg-white text-ink-2")}>
              <span className="h-2 w-2 rounded-full" style={{ background: c.color }} /> {c.name}
            </Link>
          ))}
        </div>
      </div>

      <details className="mb-4 rounded-2xl border border-line bg-white" open={!!(sp.team || sp.department || sp.organizer || sp.participant || sp.attendance || sp.mode || sp.q || sp.cancelled || view === "agenda")}>
        <summary className="cursor-pointer px-4 py-2.5 text-[13px] font-medium text-ink-2">Filters & search</summary>
        <form method="get" className="flex flex-wrap gap-2 px-4 pb-4">
          {view !== "month" && <input type="hidden" name="view" value={view} />}
          {view === "month" && <input type="hidden" name="month" value={monthParam(year, month)} />}
          {view === "week" && <input type="hidden" name="date" value={weekStart} />}
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          {filters.mine && <input type="hidden" name="mine" value="1" />}
          <Input name="q" defaultValue={sp.q} placeholder="Search name or topic" className="h-9 w-[200px]" />
          <Select name="department" defaultValue={sp.department ?? ""} className="h-9 w-auto">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="team" defaultValue={sp.team ?? ""} className="h-9 w-auto">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="organizer" defaultValue={sp.organizer ?? ""} className="h-9 w-auto">
            <option value="">Any organizer</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
          <Select name="participant" defaultValue={sp.participant ?? ""} className="h-9 w-auto">
            <option value="">Any participant</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
          <Select name="attendance" defaultValue={sp.attendance ?? ""} className="h-9 w-auto">
            <option value="">Mandatory & optional</option>
            <option value="MANDATORY">Mandatory</option>
            <option value="OPTIONAL">Optional</option>
          </Select>
          <Select name="mode" defaultValue={sp.mode ?? ""} className="h-9 w-auto">
            <option value="">Any attendance mode</option>
            {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {view === "agenda" && (
            <>
              <Input type="date" name="from" defaultValue={from} className="h-9 w-auto" aria-label="From" />
              <Input type="date" name="to" defaultValue={to} className="h-9 w-auto" aria-label="To" />
            </>
          )}
          <label className="flex items-center gap-2 px-2 text-[13px] text-ink-2">
            <input type="checkbox" name="cancelled" value="1" defaultChecked={filters.includeCancelled} className="h-4 w-4 accent-brand-700" /> Show cancelled
          </label>
          <button className={buttonClass("primary", "sm", "h-9")}>Apply</button>
          <Link href={`/internal-calendar${view !== "month" ? `?view=${view}` : ""}`} className={buttonClass("ghost", "sm", "h-9")}>Reset</Link>
        </form>
      </details>

      <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
        {view === "month" && <MonthGrid year={year} month={month} today={today} byDate={byDate} offDays={offDays} />}
        {view === "week" && <WeekGrid start={weekStart} today={today} byDate={byDate} offDays={offDays} />}
        {view === "agenda" && <Agenda chips={chips} />}

        <Card className="self-start">
          <CardHeader title="Upcoming events" description="Next 14 days" />
          <CardBody className="space-y-2.5">
            {upcoming.filter((e) => e.status === "PUBLISHED").length === 0 && <p className="text-[13px] text-muted">Nothing scheduled.</p>}
            {upcoming
              .filter((e) => e.status === "PUBLISHED")
              .slice(0, 12)
              .map(toChip)
              .map((c) => (
                <div key={c.id} className="rounded-xl border border-line-2 p-2.5">
                  <div className="mb-1 flex items-center justify-between text-[11.5px] text-muted">
                    <span>{formatDate(c.date)} · {c.time}</span>
                    {c.mine && <Badge tone="success" className="px-1.5 py-0 text-[10.5px]">Assigned</Badge>}
                  </div>
                  <Chip e={c} />
                  <div className="mt-1 text-[11px] text-muted">
                    {c.category} · {c.organizer} · {c.participants} participants · {LOCATION_LABEL[c.locationType]}
                  </div>
                </div>
              ))}
          </CardBody>
        </Card>
      </div>
    </EventDialogProvider>
  );
}

const MAX_PER_CELL = 3;

function OffDayLabel({ o }: { o?: OffDay }) {
  if (!o || o.kind === "WEEKEND") return null;
  return (
    <span className="rounded-md bg-holiday-soft px-1.5 py-0.5 text-[10.5px] font-medium leading-tight text-ink-2" title={o.label}>
      <span className="line-clamp-2">{o.label}</span>
    </span>
  );
}

function MonthGrid({ year, month, today, byDate, offDays }: { year: number; month: number; today: string; byDate: Map<string, EventChip[]>; offDays: Record<string, OffDay> }) {
  const first = monthStart(year, month);
  const gridStart = weekKey(first);
  const last = monthEnd(year, month);
  const gridEnd = addDays(weekKey(last), 6);
  const days = eachDate(gridStart, gridEnd);
  return (
    <Card className="overflow-hidden p-2 sm:p-3">
      <div className="mb-2 px-1 font-display text-[20px] font-bold text-ink">{formatMonth(year, month)}</div>
      <div className="grid grid-cols-7 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((w) => (
          <div key={w} className={cn("pb-1 text-center text-[11.5px] font-semibold uppercase tracking-wide", w > 5 ? "text-subtle" : "text-muted")}>
            {WEEKDAY_SHORT[w]}
          </div>
        ))}
        {days.map((d) => {
          const inMonth = d.slice(0, 7) === first.slice(0, 7);
          const list = (byDate.get(d) ?? []).sort((a, b) => a.time.localeCompare(b.time));
          return (
            <div
              key={d}
              className={cn(
                "flex min-h-[118px] flex-col gap-1 rounded-xl border p-1.5",
                !inMonth ? "border-transparent bg-canvas/60" : offDays[d] && offDays[d].kind !== "WEEKEND" ? "border-line-2 bg-holiday-soft/70" : offDays[d] ? "border-line-2 bg-canvas/50" : "border-line-2 bg-white",
                d === today && "ring-2 ring-brand-400",
              )}
            >
              <span className={cn("px-0.5 font-display text-[13px] font-semibold", inMonth ? (offDays[d] ? "text-muted" : "text-ink") : "text-subtle", d === today && "text-brand-700")}>
                {Number(d.slice(8))}
                {d === today && <span className="ml-1 text-[10px] font-medium uppercase">today</span>}
              </span>
              {inMonth && <OffDayLabel o={offDays[d]} />}
              {list.slice(0, MAX_PER_CELL).map((c) => <Chip key={c.id} e={c} compact={list.length > 2} />)}
              {list.length > MAX_PER_CELL && <MoreEvents label={formatDateLong(d)} chips={list} more={list.length - MAX_PER_CELL} />}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function WeekGrid({ start, today, byDate, offDays }: { start: string; today: string; byDate: Map<string, EventChip[]>; offDays: Record<string, OffDay> }) {
  const days = eachDate(start, addDays(start, 6));
  return (
    <Card className="overflow-x-auto p-3">
      <div className="grid min-w-[760px] grid-cols-7 gap-2">
        {days.map((d) => {
          const list = (byDate.get(d) ?? []).sort((a, b) => a.time.localeCompare(b.time));
          return (
            <div key={d} className={cn("flex min-h-[340px] flex-col gap-1.5 rounded-xl border border-line-2 p-2", offDays[d] && (offDays[d].kind === "WEEKEND" ? "bg-canvas/50" : "bg-holiday-soft/70"), d === today && "ring-2 ring-brand-400")}>
              <div className="mb-1 text-center">
                <div className="text-[11px] font-semibold uppercase text-muted">{formatWeekdayShort(d)}</div>
                <div className={cn("font-display text-[18px] font-bold", d === today ? "text-brand-700" : "text-ink")}>{Number(d.slice(8))}</div>
              </div>
              <OffDayLabel o={offDays[d]} />
              {list.map((c) => <Chip key={c.id} e={c} />)}
              {!list.length && <span className="mt-6 text-center text-[11.5px] text-subtle">—</span>}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Agenda({ chips }: { chips: EventChip[] }) {
  if (!chips.length) return <EmptyState icon={ListTodo} title="No events in this range" description="Change the dates or filters." />;
  const groups = new Map<string, EventChip[]>();
  for (const c of chips) groups.set(c.date, [...(groups.get(c.date) ?? []), c]);
  return (
    <Card>
      <CardBody className="space-y-5">
        {[...groups.entries()].map(([d, list]) => (
          <div key={d}>
            <div className="mb-2 text-[13px] font-semibold text-ink">{formatDateLong(d)}</div>
            <div className="space-y-2">
              {list.map((c) => (
                <div key={c.id} className="grid gap-2 rounded-xl border border-line-2 p-3 sm:grid-cols-[110px_1fr_auto] sm:items-center">
                  <span className="text-[12.5px] font-medium text-muted">{c.time}</span>
                  <Chip e={c} />
                  <span className="text-[11.5px] text-muted sm:text-right">
                    {c.category} · {c.organizer}
                    <br />
                    {c.participants} participants · {LOCATION_LABEL[c.locationType]}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
