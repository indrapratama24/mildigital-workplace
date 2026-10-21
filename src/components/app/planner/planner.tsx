"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, History, RotateCcw, Save, Send, Sparkles, Scale, GitPullRequestArrow, Info, AlertTriangle, CalendarRange, Building2, CalendarClock } from "lucide-react";
import { evaluatePlan, type MonthRequirement } from "@/lib/engine/working-days";
import { formatDate, formatDateTime, formatMonth, WEEKDAY_SHORT } from "@/lib/dates";
import type { PlannerData } from "@/server/services/schedules";
import { autoGenerateAction, resetDraftAction, saveDraftAction, submitScheduleAction } from "@/server/actions/work";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Progress } from "@/components/ui/misc";
import { Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { DayCell, LEGEND, type Mode } from "./day-cell";
import { RevisionDialog } from "./revision-dialog";
import { EventDialogProvider, useEventDialog } from "@/components/app/events/event-dialog";
import { requestConflictExceptionAction } from "@/server/actions/calendar";
import { Field, Textarea } from "@/components/ui/field";

type PlannerProps = { data: PlannerData; employees: { id: string; fullName: string }[] | null; prevHref: string; nextHref: string };

export function Planner(props: PlannerProps) {
  return (
    <EventDialogProvider>
      <PlannerInner {...props} />
    </EventDialogProvider>
  );
}

function PlannerInner({ data, employees, prevHref, nextHref }: PlannerProps) {
  const router = useRouter();
  const { open: openEvent } = useEventDialog();
  const [pending, start] = useTransition();
  const status = data.schedule?.status ?? "NOT_STARTED";
  const approvedView = ["APPROVED", "REVISION_PENDING"].includes(status);
  // Mandatory WFO days are locked to WFO in drafts (the server persists the same rule).
  const initial = useMemo(
    () => Object.fromEntries(data.days.filter((d) => d.plannable).map((d) => [d.date, (approvedView ? d.approved : d.mandatory ? "WFO" : d.planned) as Mode])),
    [data, approvedView],
  );
  const [modes, setModes] = useState<Record<string, Mode>>(initial);
  const [dirty, setDirty] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "submit" | "reset" | "generate">(null);
  const [exceptionFor, setExceptionFor] = useState<null | { eventId: string; date: string; title: string }>(null);
  const [exceptionReason, setExceptionReason] = useState("");
  const [revisionPreset, setRevisionPreset] = useState<string[] | null>(null);

  useEffect(() => {
    setModes(initial);
    setDirty(false);
    setSelected([]);
  }, [initial]);

  // Live evaluation reuses the server engine against the server-computed requirement.
  const req = useMemo(
    () =>
      data.requirement
        ? ({ ...data.requirement, days: data.days.map((d) => ({ date: d.date, plannable: d.plannable, mandatory: d.mandatory })) } as unknown as MonthRequirement)
        : null,
    [data],
  );
  const ev = useMemo(() => (req ? evaluatePlan(req, modes) : null), [req, modes]);

  // Schedule conflicts: WFH on a date with a mandatory in-office event the employee is assigned to (no exception yet).
  const hasException = (eventId: string, date: string) => data.eventExceptions.some((x) => x.eventId === eventId && x.date === date);
  const conflicts = useMemo(
    () =>
      data.days.flatMap((d) =>
        modes[d.date] === "WFH" && !d.isPast ? d.events.filter((e) => e.officeMandatory && !hasException(e.id, d.date)).map((e) => ({ date: d.date, event: e, isPast: d.isPast })) : [],
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.days, modes, data.eventExceptions],
  );
  const conflictDates = new Set(conflicts.map((c) => c.date));
  const monthEvents = useMemo(() => {
    const seen = new Map<string, { date: string; e: PlannerData["days"][number]["events"][number] }>();
    for (const d of data.days) for (const e of d.events) if (!seen.has(e.id)) seen.set(e.id, { date: d.date, e });
    return [...seen.values()];
  }, [data.days]);

  const toggle = (date: string) => {
    const day = data.days.find((d) => d.date === date)!;
    if (data.canEdit) {
      if (day.mandatory) {
        toast.info("Mandatory WFO day — locked by your policy.");
        return;
      }
      const next = modes[date] === "WFO" ? "WFH" : "WFO";
      setModes((m) => ({ ...m, [date]: next }));
      setDirty(true);
      const office = day.events.find((e) => e.officeMandatory && !hasException(e.id, date));
      if (next === "WFH" && office)
        toast.warning(`Schedule Conflict: You are assigned to a mandatory in-office event on this date — ${office.title} (${office.time}). Keep it WFO, pick another WFH day, or request an exception.`, { duration: 7000 });
    } else if (data.canRevise) {
      if (day.isPast) return toast.info("Past dates can't be changed. Ask HR for an attendance correction.");
      if (day.pendingChange) return toast.info("This date already has a pending change.");
      setSelected((s) => (s.includes(date) ? s.filter((x) => x !== date) : s.length >= 6 ? s : [...s, date]));
    }
  };

  const ident = { employeeId: data.employee.id, year: data.year, month: data.month };
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error);
      else {
        if (r.message) toast.success(r.message);
        after?.();
        router.refresh();
      }
    });

  const save = () => run(() => saveDraftAction({ ...ident, modes }), () => setDirty(false));
  const submit = () =>
    start(async () => {
      if (dirty) {
        const s = await saveDraftAction({ ...ident, modes });
        if (!s.ok) return void toast.error(s.error);
      }
      const r = await submitScheduleAction(ident);
      setConfirm(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.data?.status === "APPROVED" ? "Plan approved automatically (policy does not require leader approval)." : `Submitted for approval${r.data && "approverReason" in r.data ? ` (${String(r.data.approverReason).toLowerCase()})` : ""}.`);
      setDirty(false);
      router.refresh();
    });
  const generate = (mode: "generate" | "balance") =>
    start(async () => {
      if (mode === "balance" && dirty) {
        const s = await saveDraftAction({ ...ident, modes });
        if (!s.ok) return void toast.error(s.error);
      }
      const r = await autoGenerateAction({ ...ident, mode });
      setConfirm(null);
      if (!r.ok) return void toast.error(r.error);
      toast.success(mode === "generate" ? "Schedule generated — review and submit." : "WFO days balanced across the month.");
      const d = r.data as { eventWarnings?: string[]; eventDatesPrioritised?: number } | undefined;
      if (d?.eventDatesPrioritised) toast.info(`${d.eventDatesPrioritised} mandatory in-office event day(s) were scheduled as WFO first.`);
      for (const w of d?.eventWarnings ?? []) toast.warning(w, { duration: 8000 });
      setDirty(false);
      router.refresh();
    });

  const weeks = useMemo(() => {
    const first = data.days[0]?.weekday ?? 1;
    const cells: (PlannerData["days"][number] | null)[] = [...Array(first - 1).fill(null), ...data.days];
    while (cells.length % 7) cells.push(null);
    return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  }, [data.days]);

  const upcoming = data.days.filter((d) => !d.isPast && (d.leave || d.pendingRequest || d.kind === "OFFSITE" || d.kind === "HOLIDAY"));
  const minWfo = data.requirement?.effectiveMinimumWfo ?? 0;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center rounded-full border border-line bg-white p-1">
            <Link href={prevHref} className="rounded-full p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <span className="min-w-[150px] px-2 text-center font-display text-[15px] font-semibold text-ink">{formatMonth(data.year, data.month)}</span>
            <Link href={nextHref} className="rounded-full p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          {employees && (
            <Select
              aria-label="Employee"
              className="h-10 w-auto min-w-[200px] rounded-full"
              value={data.employee.id}
              onChange={(e) => router.push(`/calendar?month=${data.year}-${String(data.month).padStart(2, "0")}&employee=${e.target.value}`)}
            >
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.fullName}
                </option>
              ))}
            </Select>
          )}
          <StatusBadge status={status} />
          {dirty && <span className="text-[12px] font-medium text-pending">Unsaved changes</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {data.history.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="h-4 w-4" /> Approval history
            </Button>
          )}
          {data.canEdit && (
            <>
              <Button variant="secondary" size="sm" onClick={() => setConfirm("reset")} disabled={pending}>
                <RotateCcw className="h-4 w-4" /> Reset
              </Button>
              <Button variant="secondary" size="sm" onClick={() => generate("balance")} disabled={pending} title="Keep your WFO picks and add balanced WFO days to reach the target">
                <Scale className="h-4 w-4" /> Auto-balance
              </Button>
              <Button variant="subtle" size="sm" onClick={() => (Object.values(modes).some(Boolean) ? setConfirm("generate") : generate("generate"))} disabled={pending}>
                <Sparkles className="h-4 w-4" /> Auto-generate
              </Button>
              <Button variant="secondary" size="sm" onClick={save} disabled={!dirty || pending} loading={pending && dirty}>
                <Save className="h-4 w-4" /> Save draft
              </Button>
              <Button size="sm" onClick={() => setConfirm("submit")} disabled={pending || !ev?.compliant}>
                <Send className="h-4 w-4" /> Submit for approval
              </Button>
            </>
          )}
          {data.canRevise && (
            <Button size="sm" variant={selected.length ? "primary" : "subtle"} onClick={() => (selected.length ? setRevisionOpen(true) : toast.info("Select the approved date(s) you want to change, then request a revision."))}>
              <GitPullRequestArrow className="h-4 w-4" /> Request revision{selected.length ? ` (${selected.length})` : ""}
            </Button>
          )}
        </div>
      </div>

      {!data.policy && <Notice tone="danger" title="No WFO policy assigned">HR must assign a level/policy before this month can be planned.</Notice>}
      {data.schedule?.lastComment && ["CHANGES_REQUESTED", "REJECTED"].includes(status) && (
        <Notice tone="warning" title={status === "REJECTED" ? "Your leader rejected this plan" : "Your leader requested changes"}>
          “{data.schedule.lastComment}” — edit the plan and submit again.
        </Notice>
      )}
      {data.canRevise && (
        <Notice tone="info">
          This plan is approved and can&apos;t be overwritten. Click future dates to select them, then <b>Request revision</b> — only those dates change after your leader approves.
        </Notice>
      )}
      {status === "PENDING_LEADER_APPROVAL" && <Notice tone="info">Submitted {data.schedule?.submittedAt ? formatDateTime(new Date(data.schedule.submittedAt)) : ""}. The plan is locked while your leader reviews it.</Notice>}

      {conflicts.length > 0 && (
        <div className="rounded-2xl border border-pending/40 bg-pending-soft/60 p-4" role="alert">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#9a3412]">
            <AlertTriangle className="h-4 w-4" /> Schedule Conflict{conflicts.length > 1 ? `s (${conflicts.length})` : ""}: You are assigned to a mandatory in-office event on {conflicts.length > 1 ? "these dates" : "this date"}.
          </div>
          <div className="space-y-2">
            {conflicts.map((c) => (
              <div key={c.date + c.event.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white px-3 py-2.5">
                <div className="text-[13px]">
                  <button className="font-semibold text-ink hover:underline" onClick={() => openEvent(c.event.id)}>
                    {c.event.title}
                  </button>
                  <span className="text-muted"> · {formatDate(c.date)} · {c.event.time} WIB</span>
                  <div className="text-[12px] text-muted">
                    Current plan: <b className="text-ink">WFH</b> · Recommended: switch this day to <b className="text-ink">WFO</b>
                  </div>
                </div>
                {data.isSelf && !c.isPast && (data.canEdit || data.canRevise) && (
                  <div className="flex flex-wrap gap-1.5">
                    <Button size="sm" onClick={() => (data.canEdit ? (setModes((m) => ({ ...m, [c.date]: "WFO" })), setDirty(true), toast.success("Changed to WFO — remember to save.")) : (setRevisionPreset([c.date]), setRevisionOpen(true)))}>
                      <Building2 className="h-3.5 w-3.5" /> Change date to WFO
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        if (data.canEdit) {
                          setModes((m) => ({ ...m, [c.date]: "WFO" }));
                          setDirty(true);
                          toast.info("Set to WFO. Now click another WFO day to make it WFH, then save.");
                        } else {
                          setSelected([c.date]);
                          toast.info("Now click the WFO day you want to swap to WFH, then “Request revision”.");
                        }
                      }}
                    >
                      Select another WFH date
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { setExceptionReason(""); setExceptionFor({ eventId: c.event.id, date: c.date, title: c.event.title }); }}>
                      Request an exception
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        {/* Calendar */}
        <Card className="p-3 sm:p-4">
          <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
            {[1, 2, 3, 4, 5, 6, 7].map((w) => (
              <div key={w} className={cn("px-1 pb-1 text-center text-[11.5px] font-semibold uppercase tracking-wide", w > 5 ? "text-subtle" : "text-muted")}>
                {WEEKDAY_SHORT[w]}
                {data.policy?.mandatoryWeekdays.includes(w) && <span className="ml-1 text-brand-600">•</span>}
              </div>
            ))}
            {weeks.flat().map((day, i) =>
              day ? (
                <DayCell
                  key={day.date}
                  day={day}
                  mode={day.plannable ? modes[day.date] ?? null : null}
                  approvedView={approvedView}
                  interactive={(data.canEdit && day.plannable) || (data.canRevise && day.plannable && !day.isPast)}
                  selected={data.canRevise ? selected.includes(day.date) : undefined}
                  conflict={conflictDates.has(day.date)}
                  onClick={() => toggle(day.date)}
                />
              ) : (
                <div key={`e${i}`} aria-hidden />
              ),
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t border-line-2 px-1 pt-3">
            {LEGEND.map((l) => (
              <span key={l.label} className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">
                <span className={cn("h-3 w-3 rounded", l.swatch)} aria-hidden />
                {l.label}
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted">🔒 Mandatory WFO</span>
          </div>
        </Card>

        {/* Side panel */}
        <div className="space-y-4">
          {data.requirement && ev && (
            <Card>
              <CardHeader title="WFO target" description={data.policy ? `${data.policy.name} · v${data.policy.version}${data.policy.source === "snapshot" ? " (locked at submission)" : data.policy.source === "override" ? " (override)" : ""}` : undefined} />
              <CardBody className="space-y-4">
                <div className="flex items-end justify-between">
                  <div>
                    <div className="font-display text-[34px] font-bold leading-none text-ink tabular">
                      {ev.plannedWfo}
                      <span className="text-[18px] font-semibold text-subtle"> / {minWfo}</span>
                    </div>
                    <div className="mt-1 text-[12px] text-muted">{approvedView ? "approved" : "planned"} WFO days vs minimum</div>
                  </div>
                  <div className="text-right">
                    <div className={cn("font-display text-[20px] font-bold tabular", ev.plannedPercent >= data.requirement.targetPercent ? "text-success" : "text-warning")}>{ev.plannedPercent}%</div>
                    <div className="text-[12px] text-muted">target {data.requirement.targetPercent}%</div>
                  </div>
                </div>
                <Progress value={ev.plannedWfo} max={data.requirement.attendanceEligibleDays || 1} target={minWfo} />
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <Metric label="Working days" value={data.requirement.eligibleWorkingDays} />
                  <Metric label="Attendance-eligible" value={data.requirement.attendanceEligibleDays} />
                  <Metric label="Mandatory WFO" value={data.requirement.mandatoryCount} />
                  <Metric label="Approved leave" value={data.requirement.fullLeaveDays} />
                  <Metric label="Planned WFH" value={ev.plannedWfh} />
                  <Metric label="WFH remaining" value={ev.wfhAllowanceRemaining} tone={ev.wfhAllowanceRemaining < 0 ? "danger" : undefined} />
                  {data.requirement.offsiteDays > 0 && <Metric label="Offsite days" value={data.requirement.offsiteDays} />}
                  {data.requirement.holidayDays > 0 && <Metric label="Holidays" value={data.requirement.holidayDays} />}
                </dl>
                {ev.violations.length > 0 ? (
                  <Notice tone={ev.shortfall || ev.missingMandatoryDates.length ? "warning" : "info"}>
                    <ul className="list-disc space-y-0.5 pl-4">
                      {ev.violations.map((v) => (
                        <li key={v}>{v}</li>
                      ))}
                    </ul>
                  </Notice>
                ) : (
                  <Notice tone="success">Plan meets the policy.</Notice>
                )}
              </CardBody>
            </Card>
          )}

          {data.attendanceEval && (
            <Card>
              <CardHeader title="Actual attendance" description="Verified check-ins only. Planned days never count as actual." action={<StatusBadge status={data.attendanceEval.status} />} />
              <CardBody>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px]">
                  <Metric label="Verified WFO" value={data.attendanceEval.actualWfoVerified + data.attendanceEval.offsiteCreditToDate} />
                  <Metric label="Unverified" value={data.attendanceEval.actualWfoUnverified} />
                  <Metric label="Remaining WFO" value={data.attendanceEval.remainingRequiredWfo} />
                  <Metric label="Missing check-ins" value={data.attendanceEval.unauthorizedAbsences.length} tone={data.attendanceEval.unauthorizedAbsences.length ? "danger" : undefined} />
                </dl>
              </CardBody>
            </Card>
          )}

          {data.requirement && data.requirement.warnings.length > 0 && (
            <Card>
              <CardHeader title="Policy notes" />
              <CardBody className="space-y-2">
                {data.requirement.warnings.map((w) => (
                  <div key={w.code} className="flex gap-2 text-[12.5px] text-ink-2">
                    {w.code === "UNACHIEVABLE" || w.code === "MANDATORY_EXCEEDS_RATIO" ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> : <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-500" />}
                    {w.message}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader title="Internal events" description="Events you're assigned to this month" action={<a href={`/internal-calendar?month=${data.year}-${String(data.month).padStart(2, "0")}&mine=1`} className="text-[12.5px] font-medium text-brand-700 hover:underline">Calendar</a>} />
            <CardBody className="space-y-1.5">
              {monthEvents.length === 0 && <p className="text-[13px] text-muted">No internal events assigned.</p>}
              {monthEvents.map(({ date, e }) => (
                <button key={e.id} onClick={() => openEvent(e.id)} className="flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[13px] hover:bg-brand-50">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={e.attendance === "MANDATORY" ? { background: e.color } : { border: `2px solid ${e.color}` }} />
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {e.officeMandatory && <Building2 className="mr-1 inline h-3 w-3 text-brand-700" />}
                    {e.title}
                  </span>
                  <span className="shrink-0 text-[11.5px] text-muted">{formatDate(date).replace(/ \d{4}$/, "")}</span>
                </button>
              ))}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Upcoming this month" />
            <CardBody className="space-y-2">
              {upcoming.length === 0 && <p className="text-[13px] text-muted">No upcoming leave, requests or holidays.</p>}
              {upcoming.slice(0, 8).map((d) => (
                <div key={d.date} className="flex items-center justify-between gap-2 text-[13px]">
                  <span className="flex items-center gap-2 text-ink-2">
                    <CalendarRange className="h-3.5 w-3.5 text-subtle" />
                    {formatDate(d.date)}
                  </span>
                  <span className="truncate text-right text-muted">{d.pendingRequest ? `${d.pendingRequest.label} (pending)` : d.leave ? d.leave.label : d.kind === "OFFSITE" ? d.offsiteLabel ?? "Offsite duty" : d.holidayName}</span>
                </div>
              ))}
            </CardBody>
          </Card>

          {data.pendingRevisions.length > 0 && (
            <Card>
              <CardHeader title="Pending changes" />
              <CardBody className="space-y-2 text-[13px]">
                {data.pendingRevisions.map((r) => (
                  <div key={r.id} className="rounded-xl bg-pending-soft px-3 py-2 text-ink-2">
                    <div className="font-medium">{r.kind.replace(/_/g, " ").toLowerCase()}</div>
                    <div className="text-[12px] text-muted">{r.dates.map((d) => formatDate(d)).join(", ")}</div>
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* Dialogs */}
      <Dialog
        open={confirm === "submit"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={`Submit ${formatMonth(data.year, data.month)} plan?`}
        description={data.policy?.requiresLeaderApproval ? "Your leader will be notified. The plan is locked while it's reviewed." : "Your policy does not require leader approval; the plan becomes official immediately."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={submit} loading={pending}>
              Submit
            </Button>
          </>
        }
      >
        {ev && (
          <p className="text-sm text-ink-2">
            {ev.plannedWfo} WFO · {ev.plannedWfh} WFH ({ev.plannedPercent}% WFO, minimum {minWfo} days).
          </p>
        )}
        {conflicts.length > 0 && (
          <Notice tone="warning" className="mt-3">
            {conflicts.length} schedule conflict(s) with mandatory in-office events. Submission is blocked until each is changed to WFO or has an exception request.
          </Notice>
        )}
      </Dialog>
      <Dialog
        open={confirm === "reset"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Reset draft?"
        description="All planned days are cleared. Mandatory days stay locked."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={pending} onClick={() => run(() => resetDraftAction(ident), () => setConfirm(null))}>
              Reset draft
            </Button>
          </>
        }
      />
      <Dialog
        open={confirm === "generate"}
        onOpenChange={(o) => !o && setConfirm(null)}
        title="Replace your draft?"
        description="Auto-generate builds a fresh balanced plan and replaces your current choices. Use Auto-balance to keep your picks."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button loading={pending} onClick={() => generate("generate")}>
              Generate
            </Button>
          </>
        }
      />
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title="Approval history" description="Submissions, decisions and applied revisions. Earlier versions are kept immutably." className="sm:max-w-xl">
        <ol className="relative space-y-4 border-l border-line pl-5">
          {data.history.map((h, i) => (
            <li key={i} className="relative">
              <span className={cn("absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white", h.kind === "version" ? "bg-brand-500" : "bg-subtle")} />
              <div className="text-[13px] font-medium capitalize text-ink">{h.label}</div>
              <div className="text-[12px] text-muted">
                {formatDateTime(new Date(h.at))}
                {h.actor ? ` · ${h.actor}` : ""}
              </div>
              {h.comment && <div className="mt-1 rounded-lg bg-canvas px-2.5 py-1.5 text-[12.5px] text-ink-2">{h.comment}</div>}
            </li>
          ))}
        </ol>
      </Dialog>
      <Dialog
        open={!!exceptionFor}
        onOpenChange={(o) => !o && setExceptionFor(null)}
        title="Request an exception"
        description={exceptionFor ? `Stay WFH on ${formatDate(exceptionFor.date)} despite “${exceptionFor.title}”. Your leader decides; until then the conflict stays visible.` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExceptionFor(null)}>Cancel</Button>
            <Button
              loading={pending}
              disabled={exceptionReason.trim().length < 10}
              onClick={() =>
                start(async () => {
                  const r = await requestConflictExceptionAction({ eventId: exceptionFor!.eventId, date: exceptionFor!.date, reason: exceptionReason });
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setExceptionFor(null);
                  router.refresh();
                })
              }
            >
              Send to my leader
            </Button>
          </>
        }
      >
        <Field label="Reason" required hint="At least 10 characters.">
          <Textarea value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} placeholder="e.g. Client workshop at their office the whole day" />
        </Field>
      </Dialog>
      {data.canRevise && (
        <RevisionDialog
          open={revisionOpen}
          onOpenChange={(o) => {
            setRevisionOpen(o);
            if (!o) setRevisionPreset(null);
          }}
          data={data}
          selected={revisionPreset ?? selected}
          onDone={() => {
            setSelected([]);
            setRevisionPreset(null);
            setRevisionOpen(false);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "danger" }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line-2 pb-1.5">
      <dt className="text-muted">{label}</dt>
      <dd className={cn("font-semibold tabular", tone === "danger" ? "text-danger" : "text-ink")}>{value}</dd>
    </div>
  );
}
