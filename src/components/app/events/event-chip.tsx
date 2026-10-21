"use client";
import { Building2, Repeat } from "lucide-react";
import { cn } from "@/lib/cn";
import type { EventChip as Chip } from "@/server/services/events";
import { useEventDialog } from "./event-dialog";

/** Compact event entry for calendar cells. Category colour is a left bar; mandatory in-office events get an icon. */
export function EventChip({ e, compact }: { e: Chip; compact?: boolean }) {
  const { open } = useEventDialog();
  const cancelled = e.status === "CANCELLED";
  return (
    <button
      type="button"
      onClick={(ev) => {
        ev.stopPropagation();
        open(e.id);
      }}
      className={cn(
        "group flex w-full items-start gap-1.5 rounded-lg border-l-[3px] bg-white px-1.5 py-1 text-left shadow-[0_1px_2px_rgba(16,32,90,0.06)] transition-colors hover:bg-brand-50",
        e.status === "DRAFT" && "border border-dashed border-l-[3px] opacity-80",
        cancelled && "opacity-50",
      )}
      style={{ borderLeftColor: e.color }}
      title={`${e.title} — ${e.topic} · ${e.time}`}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("flex items-center gap-1 text-[11px] font-semibold leading-tight text-ink", cancelled && "line-through")}>
          {e.attendance === "MANDATORY" && e.wfo === "IN_OFFICE_REQUIRED" && <Building2 className="h-3 w-3 shrink-0 text-brand-700" aria-label="Mandatory in office" />}
          <span className="truncate">{e.title}</span>
          {e.recurring && <Repeat className="h-2.5 w-2.5 shrink-0 text-subtle" aria-label="Recurring" />}
        </span>
        {!compact && <span className="block truncate text-[10.5px] leading-tight text-muted">{e.topic}</span>}
        <span className="block text-[10px] leading-tight text-subtle">
          {e.time}
          {e.status === "DRAFT" ? " · draft" : cancelled ? " · cancelled" : ""}
        </span>
      </span>
    </button>
  );
}
