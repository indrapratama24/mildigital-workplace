"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Building2, ChevronLeft, ChevronRight, House, MessageSquareText, RotateCcw } from "lucide-react";
import { setOfficeDaysAction, setOfficePatternAction, setWfoPolicyEnabledAction } from "@/server/actions/office";
import type { OfficeScheduleView } from "@/server/services/office";
import { addMonths, formatDateLong, formatMonth, monthParam, WEEKDAY_SHORT } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

type Result = { ok: boolean; error?: string; message?: string };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.();
      router.refresh();
    });
  return { pending, run };
}

const days = (d: number[]) => (d.length ? d.map((x) => WEEKDAY_SHORT[x]).join(", ") : "none");

// ───────────── WFO Policy switch ─────────────

export function WfoPolicySwitch({ enabled, officeReady }: { enabled: boolean; officeReady: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13.5px]">
          <Badge tone={enabled ? "success" : "neutral"} dot>
            {enabled ? "On" : "Off"}
          </Badge>
          <span className="text-ink-2">{enabled ? "Employees plan their month against their WFO policy." : "Calendars follow the office schedule below. No WFO percentage is calculated."}</span>
        </div>
        <Button size="sm" variant={enabled ? "secondary" : "primary"} onClick={() => setConfirm(true)}>
          {enabled ? "Turn off" : "Turn on"}
        </Button>
      </div>
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={enabled ? "Turn off the WFO Policy?" : "Turn on the WFO Policy?"}
        description={
          enabled
            ? "From today, every employee's calendar follows the office schedule. Monthly plans, submission deadlines and WFO percentages stop. Days before today stay as they were."
            : "From today, employees plan their month against their WFO policy again and get submission reminders. Days before today stay as they were."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button loading={pending} disabled={!enabled ? false : !officeReady} onClick={() => run(() => setWfoPolicyEnabledAction(!enabled), () => setConfirm(false))}>
              {enabled ? "Turn off" : "Turn on"}
            </Button>
          </>
        }
      >
        {enabled && !officeReady && <Notice tone="warning">Set the company&apos;s weekly office days first, so calendars don&apos;t turn all WFH.</Notice>}
      </Dialog>
    </>
  );
}

// ───────────── Weekly office days ─────────────

export function WeeklyPattern({ view }: { view: OfficeScheduleView }) {
  const team = view.teamId ? view.teams.find((t) => t.id === view.teamId) : null;
  const company = view.settings.officeWfoWeekdays;
  const own = team ? team.wfoWeekdays : company;
  const [follow, setFollow] = useState(!!team && !team.wfoWeekdays);
  const [picked, setPicked] = useState<number[]>(own ?? company);
  const { pending, run } = useRun();
  useEffect(() => {
    setFollow(!!team && !team.wfoWeekdays);
    setPicked(own ?? company);
  }, [team, own, company]);
  const saved = team ? (team.wfoWeekdays ? JSON.stringify(team.wfoWeekdays) : "follow") : JSON.stringify(company);
  const current = follow ? "follow" : JSON.stringify([...picked].sort());
  return (
    <div className="space-y-3">
      {team && <Checkbox checked={follow} onChange={(e) => setFollow(e.target.checked)} label={`Same as the company (${days(company)})`} description="Untick to give this team its own office days." />}
      <div className="flex flex-wrap gap-2" role="group" aria-label="Weekly office days">
        {view.settings.workingWeekdays.map((w) => {
          const on = (follow ? company : picked).includes(w);
          return (
            <button
              key={w}
              type="button"
              disabled={follow}
              aria-pressed={on}
              onClick={() => setPicked((p) => (p.includes(w) ? p.filter((x) => x !== w) : [...p, w]))}
              className={cn(
                "inline-flex h-10 min-w-[64px] items-center justify-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                on ? "border-wfo bg-wfo text-white" : "border-line bg-white text-ink-2 hover:border-brand-200",
              )}
            >
              {on ? <Building2 className="h-3.5 w-3.5" /> : <House className="h-3.5 w-3.5" />}
              {WEEKDAY_SHORT[w]}
            </button>
          );
        })}
      </div>
      <p className="text-[12.5px] text-muted">Selected days are WFO, the other working days WFH. Changes apply from today; days before today are kept.</p>
      <Button size="sm" disabled={current === saved} loading={pending} onClick={() => run(() => setOfficePatternAction({ teamId: view.teamId, wfoWeekdays: follow ? null : picked }))}>
        Save weekly days
      </Button>
    </div>
  );
}

// ───────────── Month calendar ─────────────

type Day = OfficeScheduleView["days"][number];

export function OfficeMonth({ view, base }: { view: OfficeScheduleView; base: string }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"WFO" | "WFH" | null>("WFH");
  const [note, setNote] = useState("");
  const { pending, run } = useRun();
  useEffect(() => setSelected([]), [view.year, view.month, view.teamId]);
  const editable = (d: Day) => d.working && !d.holiday && !d.isPast;
  const toggle = (d: Day) => editable(d) && setSelected((s) => (s.includes(d.date) ? s.filter((x) => x !== d.date) : [...s, d.date]));
  const weeks = useMemo(() => {
    const cells: (Day | null)[] = [...Array(view.days[0].weekday - 1).fill(null), ...view.days];
    while (cells.length % 7) cells.push(null);
    return cells;
  }, [view.days]);
  const prev = addMonths(view.year, view.month, -1),
    next = addMonths(view.year, view.month, 1);
  const href = (m: { year: number; month: number }) => `${base}month=${monthParam(m.year, m.month)}`;
  const openDialog = () => {
    const first = view.days.find((d) => d.date === selected[0]);
    setMode(first?.mode === "WFO" ? "WFH" : "WFO");
    setNote(selected.length === 1 && first?.ownOverride ? first.note ?? "" : "");
    setOpen(true);
  };
  const scope = view.teamId ? view.teams.find((t) => t.id === view.teamId)?.name ?? "Team" : "Company";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center rounded-full border border-line bg-white p-1">
          <Link href={href(prev)} className="rounded-full p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <span className="min-w-[140px] px-2 text-center font-display text-[15px] font-semibold text-ink">{formatMonth(view.year, view.month)}</span>
          <Link href={href(next)} className="rounded-full p-1.5 text-muted hover:bg-brand-50 hover:text-brand-700" aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {selected.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setSelected([])}>
              Clear
            </Button>
          )}
          <Button size="sm" variant={selected.length ? "primary" : "subtle"} onClick={() => (selected.length ? openDialog() : toast.info("Click dates from today on to select them."))}>
            Change selected days{selected.length ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {[1, 2, 3, 4, 5, 6, 7].map((w) => (
          <div key={w} className={cn("pb-1 text-center text-[11.5px] font-semibold uppercase tracking-wide", view.settings.workingWeekdays.includes(w) ? "text-muted" : "text-subtle")}>
            {WEEKDAY_SHORT[w]}
          </div>
        ))}
        {weeks.map((d, i) =>
          d ? (
            <button
              key={d.date}
              type="button"
              disabled={!editable(d)}
              onClick={() => toggle(d)}
              aria-pressed={selected.includes(d.date)}
              title={d.note ?? undefined}
              className={cn(
                "relative flex min-h-[78px] flex-col rounded-xl border p-2 text-left transition-all disabled:cursor-default",
                !d.working ? "border-transparent bg-transparent text-subtle" : d.holiday ? "border-line-2 bg-holiday-soft" : d.mode === "WFO" ? "border-wfo bg-wfo text-white" : "border-wfh/40 bg-wfh-soft",
                d.isPast && d.working && "opacity-55",
                editable(d) && "hover:-translate-y-px hover:shadow-card",
                selected.includes(d.date) && "ring-2 ring-pending ring-offset-2",
                d.isToday && "outline outline-2 outline-offset-1 outline-brand-400",
              )}
            >
              <span className="flex items-start justify-between gap-1">
                <span className="font-display text-[14px] font-semibold tabular">{Number(d.date.slice(8))}</span>
                {d.working && !d.holiday && d.source === "OVERRIDE" && (
                  <span className={cn("rounded px-1 text-[9px] font-semibold uppercase", d.mode === "WFO" ? "bg-white/20 text-white" : "bg-white text-brand-700")}>{d.scope === "TEAM" ? "Team" : "Set"}</span>
                )}
              </span>
              {d.working && (
                <span className={cn("mt-auto text-[10.5px] font-semibold", d.holiday ? "text-holiday" : d.mode === "WFO" ? "text-white" : "text-brand-600")}>
                  {d.holiday ? "Holiday" : d.mode}
                </span>
              )}
              {d.note && !d.holiday && (
                <span className={cn("mt-0.5 line-clamp-2 flex items-start gap-1 text-[10.5px] leading-tight", d.mode === "WFO" ? "text-white/85" : "text-ink-2")}>
                  <MessageSquareText className="mt-px h-3 w-3 shrink-0" />
                  {d.note}
                </span>
              )}
            </button>
          ) : (
            <div key={`e${i}`} aria-hidden />
          ),
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11.5px] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-wfo" /> WFO</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-wfh bg-wfh-soft" /> WFH</span>
        <span><b>Set</b> = changed for this date</span>
        {view.teamId && <span><b>Team</b> = changed for this team only</span>}
        <span className="inline-flex items-center gap-1"><MessageSquareText className="h-3 w-3" /> note shown on employees&apos; calendars</span>
      </div>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${scope}: ${selected.length} day(s)`}
        description={selected.length <= 4 ? selected.map(formatDateLong).join(" · ") : `${formatDateLong(selected.slice().sort()[0])} … ${formatDateLong(selected.slice().sort().at(-1)!)}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={pending}
              onClick={() =>
                run(
                  () => setOfficeDaysAction({ teamId: view.teamId, dates: selected, mode, note: mode ? note : null }),
                  () => {
                    setOpen(false);
                    setSelected([]);
                  },
                )
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Office mode">
            {(
              [
                ["WFO", "Office day", Building2],
                ["WFH", "Work from home", House],
                [null, "Usual weekly days", RotateCcw],
              ] as const
            ).map(([m, label, Icon]) => (
              <button
                key={label}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={cn("flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left text-[13px] font-medium", mode === m ? "border-brand-500 bg-brand-50 text-brand-700" : "border-line text-ink-2 hover:border-brand-200")}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {label}
              </button>
            ))}
          </div>
          {mode ? (
            <Field label="Note" hint="Optional. Shown on these days in everyone's My Work Calendar, e.g. “Office closed for renovation” or “Town hall — everyone in the office”.">
              <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="e.g. Town hall — everyone in the office" />
            </Field>
          ) : (
            <p className="text-[13px] text-muted">Removes the change for these dates{view.teamId ? " (for this team)" : ""}, so they follow the weekly office days again.</p>
          )}
          <Notice tone="info">
            {view.settings.wfoPolicyEnabled
              ? "The WFO Policy is on, so this schedule isn't used yet. It applies once the WFO Policy is turned off."
              : "Employees' own changes on these dates are replaced, and affected employees are notified."}
          </Notice>
        </div>
      </Dialog>
    </div>
  );
}
