import Link from "next/link";
import {
  ArrowRight,
  Award,
  BookOpenText,
  Briefcase,
  Building2,
  Cake,
  CalendarClock,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Contact,
  ExternalLink,
  FileSignature,
  Handshake,
  Home as HomeIcon,
  Inbox,
  Megaphone,
  PartyPopper,
  PlaneTakeoff,
  ScrollText,
  ShieldAlert,
  TrendingUp,
  UserX,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { getPlannerData } from "@/server/services/schedules";
import { companyOverview } from "@/server/services/compliance";
import { inboxFor } from "@/server/services/approvals";
import { todayRecord } from "@/server/services/attendance";
import { eventsForEmployee } from "@/server/services/events";
import { announcementsFor, pendingAcknowledgements, recognitionFeed } from "@/server/services/workplace";
import { getSettings } from "@/server/services/settings";
import { addDays, addMonths, currentMonthJakarta, formatDate, formatDateLong, formatDateRange, formatDateTime, formatMonth, formatTimeRange, formatWeekdayShort, monthParam, todayJakarta, toISO } from "@/lib/dates";
import { isEnabled } from "@/lib/features";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, Notice, Progress, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { Badge } from "@/components/ui/badge";
import { ClockInCard } from "@/components/app/clock-in-card";
import { AnnouncementCard } from "@/components/app/workplace/announcement-card";
import { cn } from "@/lib/cn";

export const metadata = { title: "Home" };

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jakarta", hour: "numeric", hourCycle: "h23" }).format(new Date()));
  return h < 11 ? "Good morning" : h < 15 ? "Good afternoon" : h < 18 ? "Good evening" : "Good evening";
}

const LOCATION: Record<string, string> = { IN_OFFICE: "In office", ONLINE: "Online", HYBRID: "Hybrid", EXTERNAL: "External venue" };
const MODE_STYLE: Record<string, { label: string; cls: string; icon: LucideIcon }> = {
  WFO: { label: "Work from office", cls: "bg-brand-700 text-white", icon: Building2 },
  WFH: { label: "Work from home", cls: "bg-brand-50 text-brand-700", icon: HomeIcon },
  OFFSITE: { label: "Offsite duty", cls: "bg-offsite-soft text-offsite", icon: Briefcase },
  LEAVE: { label: "On leave", cls: "bg-leave-soft text-leave", icon: PlaneTakeoff },
  OFF: { label: "Day off", cls: "bg-holiday-soft text-ink-2", icon: CalendarDays },
  UNPLANNED: { label: "Not planned yet", cls: "bg-pending-soft text-pending", icon: ClipboardList },
};

interface Action {
  key: string;
  icon: LucideIcon;
  title: string;
  detail: string;
  href: string;
  tone: "danger" | "warning" | "brand" | "neutral";
}

export default async function HomePage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const me = await requirePageUser();
  const { denied } = await searchParams;
  const cur = currentMonthJakarta();
  const next = addMonths(cur.year, cur.month, 1);
  const today = todayJakarta();
  const isManager = can(me, "team.view");
  const [thisMonth, nextMonth, approvals, delegations, myRequests, revisions, rec, company, events, news, acks, recognition, settings] = await Promise.all([
    getPlannerData(me, me.employeeId, cur.year, cur.month),
    getPlannerData(me, me.employeeId, next.year, next.month),
    inboxFor(me.employeeId, ["LEADER", "HR"]),
    inboxFor(me.employeeId, ["DELEGATE"]),
    db.request.findMany({ where: { employeeId: me.employeeId, status: { in: ["PENDING_DELEGATE", "PENDING_LEADER", "CHANGES_REQUESTED", "DRAFT"] } }, include: { requestType: true }, orderBy: { startDate: "asc" }, take: 5 }),
    db.scheduleRevision.findMany({ where: { employeeId: me.employeeId, status: { in: ["PENDING", "CHANGES_REQUESTED"] } }, include: { schedule: { select: { year: true, month: true } } }, take: 5 }),
    todayRecord(me.employeeId),
    isManager ? companyOverview(me, cur.year, cur.month) : null,
    eventsForEmployee(me.employeeId, today, addDays(today, 45)),
    announcementsFor(me.employeeId, { take: 4 }),
    pendingAcknowledgements(me.employeeId),
    recognitionFeed(me),
    getSettings(),
  ]);

  // ── My work today ──
  const days = [...thisMonth.days, ...nextMonth.days];
  const todayDay = thisMonth.days.find((d) => d.date === today);
  const modeOf = (d: (typeof days)[number]) => d.approved ?? d.planned ?? null;
  const plannedToday = todayDay ? modeOf(todayDay) : null;
  const todayMode =
    todayDay?.kind === "LEAVE" ? "LEAVE" : todayDay?.kind === "OFFSITE" ? "OFFSITE" : todayDay?.kind === "HOLIDAY" || todayDay?.kind === "WEEKEND" ? "OFF" : plannedToday ?? "UNPLANNED";
  const nextWfh = days.find((d) => d.date > today && d.plannable && modeOf(d) === "WFH");
  const nextMandatory = days.find((d) => d.date > today && d.mandatory && d.plannable);
  const ev = thisMonth.approvedEval ?? thisMonth.draftEval;
  const att = thisMonth.attendanceEval;
  const verified = att ? att.actualWfoVerified + att.offsiteCreditToDate : 0;

  // ── Action center ──
  const actions: Action[] = [];
  const deadlineDay = nextMonth.policy?.submissionDeadlineDay;
  const nextStatus = nextMonth.schedule?.status ?? "NOT_STARTED";
  const curStatus = thisMonth.schedule?.status ?? "NOT_STARTED";
  if (["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(curStatus) && thisMonth.requirement)
    actions.push({ key: "plan-cur", icon: ClipboardList, title: `Submit your ${formatMonth(cur.year, cur.month)} workplan`, detail: curStatus === "CHANGES_REQUESTED" ? "Your leader asked for changes" : "This month's plan isn't approved yet", href: `/calendar?month=${monthParam(cur.year, cur.month)}`, tone: "danger" });
  if (["NOT_STARTED", "DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(nextStatus) && nextMonth.requirement)
    actions.push({
      key: "plan-next",
      icon: ClipboardList,
      title: `Plan ${formatMonth(next.year, next.month)}`,
      detail: deadlineDay ? `Submit by ${formatDate(`${monthParam(cur.year, cur.month)}-${String(deadlineDay).padStart(2, "0")}`)}` : "Submit for leader approval",
      href: `/calendar?month=${monthParam(next.year, next.month)}`,
      tone: deadlineDay && Number(today.slice(8)) >= deadlineDay - 3 ? "warning" : "neutral",
    });
  for (const r of revisions)
    actions.push({ key: `rev${r.id}`, icon: CalendarDays, title: "Schedule revision pending", detail: `${formatMonth(r.schedule.year, r.schedule.month)} · ${r.status === "CHANGES_REQUESTED" ? "changes requested" : "awaiting your leader"}`, href: `/calendar?month=${monthParam(r.schedule.year, r.schedule.month)}`, tone: r.status === "CHANGES_REQUESTED" ? "warning" : "neutral" });
  for (const d of delegations)
    actions.push({ key: `del${d.stepId}`, icon: Handshake, title: `Confirm delegation for ${d.requester.fullName}`, detail: d.summary, href: d.link, tone: "warning" });
  for (const a of approvals) actions.push({ key: `app${a.stepId}`, icon: Inbox, title: `Approve: ${a.requester.fullName} · ${a.title}`, detail: a.summary, href: a.link, tone: "brand" });
  for (const r of myRequests)
    actions.push({ key: `req${r.id}`, icon: PlaneTakeoff, title: `${r.requestType.name}: ${r.status.replace(/_/g, " ").toLowerCase()}`, detail: formatDateRange(toISO(r.startDate), toISO(r.endDate)), href: `/requests/${r.id}`, tone: r.status === "CHANGES_REQUESTED" || r.status === "DRAFT" ? "warning" : "neutral" });
  for (const e of events) {
    const d = days.find((x) => x.date === toISO(e.localDate));
    if (e.attendanceRequirement === "MANDATORY" && e.wfoRequirement === "IN_OFFICE_REQUIRED" && d && modeOf(d) === "WFH")
      actions.push({ key: `ev${e.id}`, icon: ShieldAlert, title: `WFO conflict: ${e.title}`, detail: `${formatDate(toISO(e.localDate))} is planned as WFH — in-office attendance required`, href: `/calendar?month=${toISO(e.localDate).slice(0, 7)}`, tone: "danger" });
  }
  for (const r of acks) actions.push({ key: `ack${r.id}`, icon: FileSignature, title: `Acknowledge: ${r.title}`, detail: "Company regulation update", href: `/company/regulations/${r.id}`, tone: "warning" });
  const order = { danger: 0, warning: 1, brand: 2, neutral: 3 };
  actions.sort((a, b) => order[a.tone] - order[b.tone]);

  // ── Quick actions (only what the user can access) ──
  const quick = [
    { href: "/calendar", label: "My Work Calendar", icon: CalendarDays, show: isEnabled("workCalendar") },
    { href: "/requests/new", label: "Request leave", icon: PlaneTakeoff, show: isEnabled("requests") },
    { href: "/internal-calendar", label: "Internal Calendar", icon: CalendarClock, show: isEnabled("internalCalendar") },
    { href: "/directory", label: "Team Directory", icon: Contact, show: isEnabled("teamDirectory") },
    { href: "/clients", label: "Client Directory", icon: Briefcase, show: isEnabled("clients") },
  ].filter((q) => q.show);

  const firstName = me.fullName.split(" ")[0];
  const short = (d: string) => formatDate(d).replace(/ \d{4}$/, "");
  const recogItems = [
    ...recognition.manual.slice(0, 3).map((m) => ({ key: `m${m.id}`, id: m.employee.id, name: m.employee.fullName, photoId: m.employee.photoId, icon: Award, text: m.title, date: m.date })),
    ...recognition.promotions.slice(0, 2).map((p) => ({ key: `p${p.employee.id}${p.date}`, id: p.employee.id, name: p.employee.fullName, photoId: p.employee.photoId, icon: TrendingUp, text: `Promoted to ${p.to}`, date: p.date })),
    ...recognition.birthdays.slice(0, 3).map((b) => ({ key: `b${b.id}`, id: b.id, name: b.name, photoId: null, icon: Cake, text: b.isToday ? "Birthday today 🎉" : `Birthday ${short(b.date)}`, date: b.date })),
    ...recognition.anniversaries.slice(0, 3).map((a) => ({ key: `a${a.id}`, id: a.id, name: a.name, photoId: null, icon: PartyPopper, text: `${a.years} year${a.years > 1 ? "s" : ""} at MIL`, date: a.date })),
  ].slice(0, 6);

  return (
    <>
      {/* A. Welcome */}
      <section className="mb-6 overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 via-brand-700 to-brand-900 p-6 text-white shadow-[0_16px_40px_rgba(19,34,106,0.22)] sm:p-8">
        <div className="text-[13px] font-medium text-brand-100/90">{formatDateLong(today)}</div>
        <h1 className="mt-1 font-display text-[28px] font-extrabold tracking-tight sm:text-[34px]">{greeting()}, {firstName}!</h1>
        <p className="mt-1 text-[15px] text-brand-100/90">Here&apos;s what&apos;s happening at MIL today.</p>
        <div className="mt-5 flex flex-wrap gap-2 text-[13px]">
          <span className={cn("inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1.5 font-medium")}>
            {(() => {
              const M = MODE_STYLE[todayMode];
              return (
                <>
                  <M.icon className="h-4 w-4" /> Today: {M.label}
                  {todayDay?.mandatory && todayMode === "WFO" && " · mandatory"}
                </>
              );
            })()}
          </span>
          {actions.length > 0 && <a href="#actions" className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1.5 font-semibold text-brand-700">{actions.length} thing{actions.length > 1 ? "s" : ""} need your attention</a>}
        </div>
      </section>
      {denied && <Notice tone="warning" className="mb-5">You don&apos;t have access to that page.</Notice>}

      <div className="grid gap-5 lg:grid-cols-3">
        {/* B. My work today */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="My work today"
            description={thisMonth.policy ? `${thisMonth.policy.name}${thisMonth.policy.levelName ? ` · ${thisMonth.policy.levelName}` : ""}` : "No policy assigned"}
            action={<Link href="/calendar" className="inline-flex items-center gap-1 text-[13px] font-medium text-brand-700 hover:underline">My Work Calendar <ArrowRight className="h-3.5 w-3.5" /></Link>}
          />
          <CardBody className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              {(() => {
                const M = MODE_STYLE[todayMode];
                return (
                  <div className={cn("rounded-2xl p-4", M.cls)}>
                    <M.icon className="h-5 w-5" />
                    <div className="mt-2 text-[12px] opacity-80">Today</div>
                    <div className="font-display text-[18px] font-bold leading-tight">{M.label}</div>
                    {todayDay?.kind === "HOLIDAY" && <div className="text-[12px] opacity-80">{todayDay.holidayName}</div>}
                  </div>
                );
              })()}
              <MiniTile label="Next WFH" value={nextWfh ? `${formatWeekdayShort(nextWfh.date)}, ${short(nextWfh.date)}` : "None planned"} />
              <MiniTile label="Next mandatory WFO" value={nextMandatory ? `${formatWeekdayShort(nextMandatory.date)}, ${short(nextMandatory.date)}` : "—"} />
            </div>
            {thisMonth.requirement && ev ? (
              <div className="rounded-2xl bg-canvas p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-[13px]">
                  <span className="font-medium text-ink">{formatMonth(cur.year, cur.month)} WFO compliance</span>
                  <StatusBadge status={att?.status ?? thisMonth.schedule?.status ?? "NOT_STARTED"} />
                </div>
                <Progress value={verified} max={thisMonth.requirement.attendanceEligibleDays || 1} target={thisMonth.requirement.effectiveMinimumWfo} />
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                  <span>Verified WFO <b className="text-ink">{verified}</b> / min {thisMonth.requirement.effectiveMinimumWfo}</span>
                  <span>{thisMonth.approvedEval ? "Approved" : "Planned"} WFO <b className="text-ink">{ev.plannedWfo}</b></span>
                  {att && <span>Still needed <b className="text-ink">{att.remainingRequiredWfo}</b></span>}
                  {ev.shortfall > 0 && <span className="text-danger">Replacement WFO required: <b>{ev.shortfall}</b></span>}
                </div>
              </div>
            ) : (
              <p className="text-sm text-muted">Ask HR to assign your level and policy.</p>
            )}
          </CardBody>
        </Card>

        <ClockInCard
          isWorkday={!!todayDay?.plannable || todayDay?.kind === "OFFSITE"}
          dayLabel={todayDay?.kind === "HOLIDAY" ? todayDay.holidayName ?? "Holiday" : todayDay?.kind === "LEAVE" ? todayDay.leave?.label ?? "Leave" : todayDay?.kind === "WEEKEND" ? "Weekend" : null}
          planned={todayDay?.kind === "OFFSITE" ? "OFFSITE" : plannedToday}
          mandatory={!!todayDay?.mandatory}
          record={rec ? { mode: rec.mode, at: rec.clockInAt ? formatDateTime(rec.clockInAt) : null, verified: rec.verification === "VERIFIED" } : null}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* C. Action center */}
        <Card id="actions" className="scroll-mt-24 lg:col-span-2">
          <CardHeader title="My action center" description="What needs you, most urgent first" action={<Link href="/requests" className="text-[13px] font-medium text-brand-700 hover:underline">Requests & Approvals</Link>} />
          <CardBody className="space-y-2">
            {actions.length === 0 && <p className="flex items-center gap-2 text-[13px] text-muted"><CheckCircle2 className="h-4 w-4 text-success" /> You&apos;re all caught up.</p>}
            {actions.slice(0, 8).map((a) => (
              <Link key={a.key} href={a.href} className="flex items-center gap-3 rounded-xl border border-line-2 px-3 py-2.5 hover:border-brand-200 hover:bg-brand-50/40">
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", a.tone === "danger" ? "bg-danger-soft text-danger" : a.tone === "warning" ? "bg-warning-soft text-warning" : a.tone === "brand" ? "bg-brand-50 text-brand-700" : "bg-canvas text-ink-2")}>
                  <a.icon className="h-4 w-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-medium text-ink">{a.title}</span>
                  <span className="block truncate text-[12px] text-muted">{a.detail}</span>
                </span>
                <ArrowRight className="h-4 w-4 shrink-0 text-subtle" />
              </Link>
            ))}
            {actions.length > 8 && <p className="text-[12px] text-muted">+{actions.length - 8} more in Requests & Approvals.</p>}
          </CardBody>
        </Card>

        {/* G. Quick actions */}
        <Card>
          <CardHeader title="Quick actions" />
          <CardBody className="grid grid-cols-2 gap-2">
            {quick.map((q) => (
              <Link key={q.href} href={q.href} className="flex flex-col gap-2 rounded-2xl border border-line-2 p-3 text-[13px] font-medium text-ink hover:border-brand-200 hover:bg-brand-50/40">
                <q.icon className="h-5 w-5 text-brand-600" />
                {q.label}
              </Link>
            ))}
            {settings.knowledgeHubUrl ? (
              <a href={settings.knowledgeHubUrl} target="_blank" rel="noopener noreferrer" className="flex flex-col gap-2 rounded-2xl border border-line-2 p-3 text-[13px] font-medium text-ink hover:border-brand-200 hover:bg-brand-50/40">
                <BookOpenText className="h-5 w-5 text-brand-600" />
                <span className="inline-flex items-center gap-1">Knowledge Hub <ExternalLink className="h-3 w-3 text-subtle" /></span>
              </a>
            ) : (
              <div className="flex flex-col gap-2 rounded-2xl border border-dashed border-line p-3 text-[13px] font-medium text-subtle" title="MIL Academy is in development">
                <BookOpenText className="h-5 w-5" />
                <span>Knowledge Hub<span className="block text-[11px] font-normal">Platform in development</span></span>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* D. Upcoming internal events */}
        <Card className="lg:col-span-2">
          <CardHeader title="Upcoming internal events" description="Assigned to you" action={<Link href="/internal-calendar?mine=1" className="text-[13px] font-medium text-brand-700 hover:underline">Full calendar</Link>} />
          <CardBody className="space-y-2">
            {events.length === 0 && <p className="text-[13px] text-muted">No upcoming events assigned to you.</p>}
            {events.slice(0, 5).map((e) => (
              <Link key={e.id} href={`/internal-calendar/events/${e.id}`} className="flex items-center gap-3 rounded-xl border border-line-2 border-l-[3px] px-3 py-2 hover:bg-brand-50/40" style={{ borderLeftColor: e.category.color }}>
                <span className="w-12 shrink-0 text-center">
                  <span className="block text-[11px] uppercase text-muted">{formatWeekdayShort(toISO(e.localDate))}</span>
                  <span className="block font-display text-[18px] font-bold leading-none text-ink">{toISO(e.localDate).slice(8)}</span>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-semibold text-ink">{e.title}</span>
                  <span className="block truncate text-[12px] text-muted">{short(toISO(e.localDate))} · {formatTimeRange(e.startAt, e.endAt)} · {e.topic}</span>
                </span>
                <span className="hidden shrink-0 flex-col items-end gap-1 sm:flex">
                  <Badge tone={e.locationType === "IN_OFFICE" ? "brand" : "neutral"}>{LOCATION[e.locationType] ?? e.locationType}</Badge>
                  {e.attendanceRequirement === "MANDATORY" && <span className="text-[11px] font-medium text-pending">Mandatory</span>}
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>

        {/* F. Recognition */}
        <Card>
          <CardHeader title="Recognition" action={<Link href="/company/recognition" className="text-[13px] font-medium text-brand-700 hover:underline">See all</Link>} />
          <CardBody className="space-y-1">
            {recogItems.length === 0 && <p className="text-[13px] text-muted">Nothing to celebrate this week — yet.</p>}
            {recogItems.map((r) => (
              <Link key={r.key} href={`/directory/${r.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                <Avatar name={r.name} photoId={r.photoId} className="h-8 w-8" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                  <span className="flex items-center gap-1 truncate text-[12px] text-muted"><r.icon className="h-3 w-3 shrink-0" /> {r.text}</span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      {/* E. Announcements */}
      <Card className="mt-5">
        <CardHeader title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-600" /> Company announcements</span>} action={<Link href="/company/announcements" className="text-[13px] font-medium text-brand-700 hover:underline">Company Hub</Link>} />
        <CardBody>
          {news.length === 0 ? (
            <p className="flex items-center gap-2 text-[13px] text-muted"><ScrollText className="h-4 w-4" /> No current announcements.</p>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{news.map((a) => <AnnouncementCard key={a.id} a={a} compact />)}</div>
          )}
        </CardBody>
      </Card>

      {company && (
        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="font-display text-[19px] font-bold text-ink">{can(me, "company.view") ? "Company" : "My team"} · {formatMonth(cur.year, cur.month)}</h2>
            <Link href="/compliance" className="text-[13px] font-medium text-brand-700 hover:underline">Compliance dashboard →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            <Stat label="Active employees" value={company.totalActive} icon={Users2} />
            <Stat label="Plans submitted" value={`${company.submitted}/${company.totalActive}`} icon={ClipboardList} />
            <Stat label="Pending approvals" value={company.pendingApprovals} icon={Clock} tone={company.pendingApprovals ? "warning" : "default"} />
            <Stat label="Avg planned WFO" value={company.avgPlannedPercent !== null ? `${company.avgPlannedPercent}%` : "—"} icon={TrendingUp} tone="brand" />
            <Stat label="Avg verified WFO" value={company.avgActualPercent !== null ? `${company.avgActualPercent}%` : "—"} icon={CheckCircle2} hint="to date" />
            <Stat label="Below target / at risk" value={company.belowTarget} icon={ShieldAlert} tone={company.belowTarget ? "danger" : "success"} />
            <Stat label="Replacement days owed" value={company.outstandingReplacement} icon={UserX} />
            <Stat label="Upcoming leave (14d)" value={company.upcomingLeave.length} icon={PlaneTakeoff} />
          </div>
        </section>
      )}
    </>
  );
}

function MiniTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-canvas p-4">
      <CalendarDays className="h-5 w-5 text-subtle" />
      <div className="mt-2 text-[12px] text-muted">{label}</div>
      <div className="font-display text-[16px] font-bold leading-tight text-ink">{value}</div>
    </div>
  );
}
