"use client";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/cn";
import type { PlannerEvent } from "@/server/services/schedules";
import { useEventDialog } from "@/components/app/events/event-dialog";

/**
 * Compact event indicators inside a work-calendar day. They never recolour the day: a dot carries the
 * category colour, strength follows priority (mandatory in-office → mandatory → optional).
 */
export function DayEvents({ events, dark, max = 2 }: { events: PlannerEvent[]; dark?: boolean; max?: number }) {
  const { open } = useEventDialog();
  const sorted = [...events].sort((a, b) => rank(a) - rank(b) || a.time.localeCompare(b.time));
  return (
    <div className="pointer-events-auto mt-1 flex flex-col gap-0.5">
      {sorted.slice(0, max).map((e) => (
        <button
          key={e.id}
          type="button"
          onClick={(ev) => {
            ev.stopPropagation();
            open(e.id);
          }}
          title={`${e.title} — ${e.topic} · ${e.time}${e.officeMandatory ? " · mandatory in office" : e.attendance === "MANDATORY" ? " · mandatory" : " · optional"}`}
          className={cn(
            "flex max-w-full items-center gap-1 rounded-md px-1 py-[1px] text-left text-[10.5px] leading-tight hover:underline",
            dark ? "bg-white/10 text-white" : "bg-white/80 text-ink",
            e.officeMandatory && "font-semibold",
          )}
        >
          <Dot e={e} />
          {e.officeMandatory && <Building2 className={cn("h-2.5 w-2.5 shrink-0", dark ? "text-white" : "text-brand-700")} />}
          <span className="truncate">{e.title}</span>
        </button>
      ))}
      {sorted.length > max && (
        <button type="button" onClick={(ev) => { ev.stopPropagation(); open(sorted[max].id); }} className={cn("px-1 text-left text-[10px] font-semibold", dark ? "text-white/80" : "text-brand-700")}>
          +{sorted.length - max} event{sorted.length - max > 1 ? "s" : ""}
        </button>
      )}
    </div>
  );
}

const rank = (e: PlannerEvent) => (e.officeMandatory ? 0 : e.attendance === "MANDATORY" ? 1 : 2);

function Dot({ e }: { e: PlannerEvent }) {
  const mandatory = e.attendance === "MANDATORY";
  return (
    <span
      className={cn("h-2 w-2 shrink-0 rounded-full", e.officeMandatory && "ring-2 ring-white/70")}
      style={mandatory ? { background: e.color } : { border: `2px solid ${e.color}`, background: "transparent" }}
      aria-hidden
    />
  );
}
