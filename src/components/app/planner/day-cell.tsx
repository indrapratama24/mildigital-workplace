import { CheckCircle2, CircleDashed, Clock3, Lock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { DayEvents } from "./day-events";
import type { PlannerData } from "@/server/services/schedules";

export type PlannerDay = PlannerData["days"][number];
export type Mode = "WFO" | "WFH" | null;

export const LEGEND: { label: string; swatch: string }[] = [
  { label: "Planned WFO", swatch: "border-2 border-dashed border-wfo bg-wfo-soft" },
  { label: "Planned WFH", swatch: "border-2 border-dashed border-wfh bg-wfh-soft" },
  { label: "Approved WFO", swatch: "bg-wfo" },
  { label: "Approved WFH", swatch: "bg-wfh-soft border border-wfh" },
  { label: "Actual (verified)", swatch: "bg-success" },
  { label: "Unverified attendance", swatch: "bg-warning" },
  { label: "Leave", swatch: "bg-leave" },
  { label: "Permission", swatch: "bg-permission" },
  { label: "Offsite duty", swatch: "bg-offsite" },
  { label: "Holiday", swatch: "bg-holiday" },
  { label: "Pending change / request", swatch: "bg-pending" },
  { label: "Event: mandatory in office", swatch: "rounded-full bg-brand-700 ring-2 ring-brand-200" },
  { label: "Event: mandatory", swatch: "rounded-full bg-muted" },
  { label: "Event: optional", swatch: "rounded-full border-2 border-muted bg-white" },
];

export function DayCell({
  day,
  mode,
  approvedView,
  selected,
  interactive,
  onClick,
  compact,
  conflict,
}: {
  day: PlannerDay;
  mode: Mode;
  approvedView: boolean;
  selected?: boolean;
  interactive?: boolean;
  onClick?: () => void;
  compact?: boolean;
  /** WFH on a date with a mandatory in-office event (and no exception) */
  conflict?: boolean;
}) {
  const num = Number(day.date.slice(8));
  const base = "relative flex flex-col rounded-xl border text-left transition-all";
  const size = compact ? "min-h-[64px] p-1.5" : "min-h-[92px] p-2 sm:min-h-[104px] sm:p-2.5";
  let body: React.ReactNode = null;
  let tone = "border-line-2 bg-white";

  if (day.kind === "WEEKEND") {
    tone = "border-transparent bg-transparent text-subtle";
  } else if (day.kind === "HOLIDAY") {
    tone = "border-line-2 bg-holiday-soft";
    body = <Tag className="bg-white/70 text-holiday">{day.holidayType === "CUTI_BERSAMA" ? "Cuti bersama" : day.holidayType === "COMPANY" ? "Company holiday" : "Public holiday"}</Tag>;
  } else if (day.kind === "LEAVE" && day.leave) {
    const isPerm = day.leave.category === "PERMISSION";
    tone = isPerm ? "border-permission/20 bg-permission-soft" : "border-leave/20 bg-leave-soft";
    body = <Tag className={isPerm ? "bg-permission text-white" : "bg-leave text-white"}>{day.leave.label}</Tag>;
  } else if (day.kind === "OFFSITE") {
    tone = "border-offsite/20 bg-offsite-soft";
    body = <Tag className="bg-offsite text-white">Offsite</Tag>;
  } else if (mode) {
    const isWfo = mode === "WFO";
    if (approvedView) {
      tone = isWfo ? "border-wfo bg-wfo text-white" : "border-wfh/40 bg-wfh-soft";
      body = <Tag className={isWfo ? "bg-white/15 text-white" : "bg-white text-brand-600"}>{isWfo ? "WFO" : "WFH"}</Tag>;
    } else {
      tone = isWfo ? "border-2 border-dashed border-wfo/70 bg-wfo-soft" : "border-2 border-dashed border-wfh bg-wfh-soft";
      body = <Tag className={isWfo ? "bg-wfo text-white" : "bg-white text-brand-600"}>{isWfo ? "Planned WFO" : "Planned WFH"}</Tag>;
    }
  } else if (day.plannable) {
    tone = "border-dashed border-line bg-white";
    body = <span className="text-[11px] text-subtle">{interactive ? "Click to plan" : "Not planned"}</span>;
  }

  const dark = approvedView && mode === "WFO" && day.kind === "WORKDAY";
  const events = day.events ?? [];
  return (
    // The whole cell toggles the day (a full-size button underneath); event entries sit above it as separate buttons.
    <div
      className={cn(
        base,
        size,
        tone,
        interactive && "group hover:-translate-y-px hover:shadow-card",
        selected && "ring-2 ring-pending ring-offset-2",
        conflict && !selected && "ring-2 ring-pending/80 ring-offset-1",
        day.isToday && "outline outline-2 outline-offset-1 outline-brand-400",
      )}
    >
      {interactive && (
        <button
          type="button"
          onClick={onClick}
          aria-pressed={selected !== undefined ? selected : undefined}
          aria-label={`${day.date}${mode ? `, ${mode}` : ""}${day.mandatory ? ", mandatory WFO" : ""}${events.length ? `, ${events.length} event(s)` : ""}${conflict ? ", schedule conflict" : ""}`}
          className="absolute inset-0 z-0 cursor-pointer rounded-xl"
        />
      )}
      <div className="pointer-events-none relative z-[1] flex flex-1 flex-col">
        <div className="flex items-start justify-between gap-1">
          <span className={cn("font-display text-[15px] font-semibold tabular", dark ? "text-white" : day.kind === "WEEKEND" ? "text-subtle" : "text-ink")}>{num}</span>
          <span className="flex items-center gap-1">
            {day.mandatory && <Lock className={cn("h-3.5 w-3.5", dark ? "text-white/80" : "text-brand-700")} aria-label="Mandatory WFO day" />}
            {day.waived && <span className="rounded bg-warning-soft px-1 text-[9px] font-semibold text-warning">WAIVED</span>}
          </span>
        </div>
        {events.length > 0 && <DayEvents events={events} dark={dark} max={compact ? 1 : 2} />}
        <div className="mt-auto flex flex-col items-start gap-1 pt-1">
          {body}
          {conflict && (
            <Tag className="bg-pending text-white">
              <AlertCircle className="h-3 w-3" /> Conflict
            </Tag>
          )}
          {day.leave && day.kind !== "LEAVE" && day.leave.portion > 0 && (
            <Tag className={day.leave.category === "PERMISSION" ? "bg-permission-soft text-permission" : "bg-leave-soft text-leave"}>½ {day.leave.label}</Tag>
          )}
          {day.pendingChange && (
            <Tag className="bg-pending text-white">
              <Clock3 className="h-3 w-3" /> → {day.pendingChange.toMode}
            </Tag>
          )}
          {day.pendingRequest && (
            <Tag className="bg-pending-soft text-pending">
              <Clock3 className="h-3 w-3" /> {day.pendingRequest.label}
            </Tag>
          )}
          {day.attendance ? (
            <Tag className={day.attendance.verified ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}>
              {day.attendance.verified ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
              {day.attendance.verified ? `Actual ${day.attendance.mode}` : "Unverified"}
            </Tag>
          ) : (
            day.isPast &&
            day.kind === "WORKDAY" &&
            mode === "WFO" &&
            approvedView && (
              <Tag className="bg-danger-soft text-danger">
                <AlertCircle className="h-3 w-3" /> No check-in
              </Tag>
            )
          )}
        </div>
        {day.holidayName && !compact && <span className="mt-1 line-clamp-2 text-[10.5px] leading-tight text-muted">{day.holidayName}</span>}
      </div>
    </div>
  );
}

function Tag({ className, children }: { className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex max-w-full items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold leading-tight", className)}>{children}</span>;
}
