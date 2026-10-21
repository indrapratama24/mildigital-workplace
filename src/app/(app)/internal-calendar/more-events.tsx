"use client";
import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import type { EventChip as Chip } from "@/server/services/events";
import { EventChip } from "@/components/app/events/event-chip";

export function MoreEvents({ label, chips, more }: { label: string; chips: Chip[]; more: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="rounded-md px-1 text-left text-[11px] font-semibold text-brand-700 hover:underline">
        +{more} more
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={label} description={`${chips.length} events`}>
        <div className="space-y-1.5" onClick={() => setOpen(false)}>
          {chips.map((c) => <EventChip key={c.id} e={c} />)}
        </div>
      </Dialog>
    </>
  );
}
