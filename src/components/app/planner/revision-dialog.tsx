"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowRight, Plus, X } from "lucide-react";
import type { PlannerData } from "@/server/services/schedules";
import type { RevisionImpact } from "@/lib/engine/working-days";
import { createRevisionAction, previewRevisionAction } from "@/server/actions/work";
import { formatDate, formatDateLong } from "@/lib/dates";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";

type M = "WFO" | "WFH";

export function RevisionDialog({ open, onOpenChange, data, selected, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; data: PlannerData; selected: string[]; onDone: () => void }) {
  const byDate = useMemo(() => new Map(data.days.map((d) => [d.date, d])), [data.days]);
  const [replacements, setReplacements] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [exception, setException] = useState(false);
  const [impact, setImpact] = useState<(RevisionImpact & { eventConflicts?: { date: string; event: { title: string } }[] }) | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();

  useEffect(() => {
    if (open) {
      setReplacements([]);
      setReason("");
      setException(false);
      setKey(crypto.randomUUID());
    }
  }, [open]);

  const changes = useMemo(
    () => [
      ...selected.map((date) => ({ date, toMode: (byDate.get(date)?.approved === "WFO" ? "WFH" : "WFO") as M })),
      ...replacements.map((date) => ({ date, toMode: "WFO" as M, isReplacement: true })),
    ],
    [selected, replacements, byDate],
  );
  const kind = replacements.length
    ? "ADDITIONAL_WFH"
    : changes.some((c) => c.toMode === "WFH") && changes.some((c) => c.toMode === "WFO")
      ? "SWAP"
      : changes.every((c) => c.toMode === "WFH")
        ? "WFO_TO_WFH"
        : "WFH_TO_WFO";

  useEffect(() => {
    if (!open || !changes.length) return;
    const t = setTimeout(async () => {
      const r = await previewRevisionAction({ employeeId: data.employee.id, year: data.year, month: data.month, changes });
      if (r.ok && r.data) setImpact(r.data);
    }, 200);
    return () => clearTimeout(t);
  }, [open, changes, data.employee.id, data.year, data.month]);

  const submit = () =>
    start(async () => {
      const r = await createRevisionAction({ employeeId: data.employee.id, year: data.year, month: data.month, kind, changes, reason, requestException: exception, idempotencyKey: key });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onDone();
    });

  const shortfall = impact?.shortfall ?? 0;
  const blockingReplacement = shortfall > 0 && !impact?.requiresException;
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Request a schedule change"
      description="Only the dates below change after your leader approves. Your approved plan stays in effect until then."
      className="sm:max-w-xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={pending} disabled={!changes.length || reason.trim().length < 10 || blockingReplacement || (impact?.requiresException && !exception) || !!impact?.invalid.length}>
            Submit change request
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          {changes.map((c) => {
            const from = byDate.get(c.date)?.approved;
            return (
              <div key={c.date} className="flex items-center justify-between gap-3 rounded-xl border border-line px-3 py-2 text-[13px]">
                <span className="font-medium text-ink">{formatDateLong(c.date)}</span>
                <span className="flex items-center gap-2">
                  <ModePill mode={(from as M | null) ?? null} />
                  <ArrowRight className="h-3.5 w-3.5 text-subtle" />
                  <ModePill mode={c.toMode} />
                  {"isReplacement" in c && !!c.isReplacement && (
                    <button className="rounded-full p-1 text-muted hover:bg-canvas" aria-label="Remove replacement" onClick={() => setReplacements((r) => r.filter((x) => x !== c.date))}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>

        {impact && (
          <div className="rounded-2xl bg-canvas p-4">
            <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Impact on this month</div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <ImpactNum label="Planned WFO now" value={impact.plannedWfoBefore} />
              <ImpactNum label="After change" value={impact.plannedWfoAfter} tone={impact.plannedWfoAfter < impact.minimumRequired ? "danger" : "success"} />
              <ImpactNum label="Minimum required" value={impact.minimumRequired} />
            </div>
            {shortfall > 0 && (
              <div className="mt-3 text-[13px] text-ink-2">
                Shortfall: <b>{shortfall} day(s)</b> · replacement WFO required: <b>{impact.replacementRequired}</b>
              </div>
            )}
            {impact.suggestions.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[12px] text-muted">Suggested replacement WFO dates</div>
                <div className="flex flex-wrap gap-1.5">
                  {impact.suggestions.map((d) => (
                    <button key={d} onClick={() => setReplacements((r) => [...r, d])} className="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2.5 py-1 text-[12px] font-medium text-brand-700 hover:bg-brand-50">
                      <Plus className="h-3 w-3" /> {formatDate(d)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        {impact?.invalid.map((i) => (
          <Notice key={i.date + i.reason} tone="danger">
            {formatDate(i.date)}: {i.reason}
          </Notice>
        ))}
        {impact?.eventConflicts && impact.eventConflicts.length > 0 && (
          <Notice tone="warning" title="Schedule Conflict">
            You are assigned to a mandatory in-office event: {impact.eventConflicts.map((c) => `${c.event.title} (${formatDate(c.date)})`).join(", ")}. Switching to WFH needs an authorised exception.
          </Notice>
        )}
        {impact && impact.mandatoryViolations.length > 0 && <Notice tone="warning" title="Mandatory WFO day">{impact.mandatoryViolations.map(formatDate).join(", ")} is a mandatory office day. This needs an authorised exception.</Notice>}
        {impact?.requiresException && (
          <Notice tone="warning">
            <Checkbox
              checked={exception}
              onChange={(e) => setException(e.target.checked)}
              label="Request an authorised exception"
              description="Your leader (and HR if your policy requires) must approve. The shortfall is recorded as an exception — you are not silently marked compliant."
            />
          </Notice>
        )}
        <Field label="Reason" required hint="At least 10 characters. Your leader sees this.">
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} placeholder="e.g. Client workshop moved to Thursday" />
        </Field>
      </div>
    </Dialog>
  );
}

function ModePill({ mode }: { mode: M | null }) {
  return <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", mode === "WFO" ? "bg-wfo text-white" : mode === "WFH" ? "bg-wfh-soft text-brand-700" : "bg-holiday-soft text-muted")}>{mode ?? "—"}</span>;
}

function ImpactNum({ label, value, tone }: { label: string; value: number; tone?: "danger" | "success" }) {
  return (
    <div>
      <div className={cn("font-display text-[24px] font-bold tabular", tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink")}>{value}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}
