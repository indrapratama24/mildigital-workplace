"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, CalendarClock, RefreshCw } from "lucide-react";
import { archiveClientAction, cancelScheduledInactiveAction, changeClientStatusAction } from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import type { ClientStatusT } from "@/lib/engine/clients";
import { addDays, formatDate } from "@/lib/dates";

export function ChangeStatusButton({ id, status, statusFrom, dateStart, today }: { id: string; status: ClientStatusT; statusFrom: string; dateStart: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const choices = (["ACTIVE", "FREEZE", "INACTIVE"] as ClientStatusT[]).filter((s) => s !== status && !(status === "INACTIVE" && s === "FREEZE"));
  const [f, setF] = useState({ status: choices[0], effectiveDate: today, dateOff: today, reason: "" });
  const [pending, start] = useTransition();
  // A Date OFF of today or later is planned ahead instead of applied now.
  const planned = f.status === "INACTIVE" && !!f.dateOff && f.dateOff >= today;
  const save = () =>
    start(async () => {
      const r = await changeClientStatusAction(id, { status: f.status, effectiveDate: f.status === "INACTIVE" ? null : f.effectiveDate, dateOff: f.status === "INACTIVE" ? f.dateOff : null, reason: f.reason || null });
      if (!r.ok) return void toast.error(r.error);
      const planned = r.data?.scheduledDateOff;
      toast.success(planned ? `Planned — becomes Inactive on ${formatDate(addDays(planned, 1))}.` : r.message);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" /> Change status
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Change client status"
        description={`Current status started ${formatDate(statusFrom)}. The change is added to the history; earlier months keep their counts.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={save}>{planned ? "Plan Date OFF" : "Save status"}</Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New status">
            <Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as ClientStatusT })}>
              {choices.map((s) => <option key={s} value={s}>{s === "ACTIVE" ? (status === "INACTIVE" ? "Active (reactivate)" : "Active") : s === "FREEZE" ? "Freeze" : "Inactive"}</option>)}
            </Select>
          </Field>
          {f.status === "INACTIVE" ? (
            <Field label="Date OFF" required hint={planned ? `Planned: stays ${status === "FREEZE" ? "Freeze" : "Active"} until then, Inactive from ${formatDate(addDays(f.dateOff, 1))}` : "Last day of collaboration"}>
              <Input type="date" value={f.dateOff} min={statusFrom > dateStart ? statusFrom : dateStart} onChange={(e) => setF({ ...f, dateOff: e.target.value })} />
            </Field>
          ) : (
            <Field label={status === "INACTIVE" ? "Reactivation date" : "Effective from"}>
              <Input type="date" value={f.effectiveDate} max={today} onChange={(e) => setF({ ...f, effectiveDate: e.target.value })} />
            </Field>
          )}
          <Field label="Reason" className="sm:col-span-2">
            <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Optional" />
          </Field>
        </div>
        {planned && (
          <Notice className="mt-3">
            The client stays {status === "FREEZE" ? "Freeze" : "Active"} and keeps counting until {formatDate(f.dateOff)}, then becomes Inactive automatically on {formatDate(addDays(f.dateOff, 1))}. You can cancel or change the date until then.
          </Notice>
        )}
        {status === "INACTIVE" && f.status === "ACTIVE" && (
          <Notice className="mt-3">Reactivation starts a new engagement with the last package. Date START stays {formatDate(dateStart)}.</Notice>
        )}
      </Dialog>
    </>
  );
}

/** Planned Date OFF on the client page: when it takes effect, with a way to cancel it. */
export function ScheduledOffNotice({ id, dateOff, canManage }: { id: string; dateOff: string; canManage: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Notice tone="warning">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="flex items-start gap-2">
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Date OFF planned for <b>{formatDate(dateOff)}</b> — the client becomes Inactive automatically on {formatDate(addDays(dateOff, 1))}. Until then it stays in the counts as it is now.
          </span>
        </span>
        {canManage && (
          <Button
            size="sm"
            variant="secondary"
            loading={pending}
            onClick={() =>
              start(async () => {
                const r = await cancelScheduledInactiveAction(id);
                if (!r.ok) return void toast.error(r.error);
                toast.success(r.message);
                router.refresh();
              })
            }
          >
            Cancel plan
          </Button>
        )}
      </div>
    </Notice>
  );
}

export function ArchiveClientButton({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setOpen(true)}>
        <Archive className="h-4 w-4" /> Archive record
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Archive “${name}”?`}
        description="Use this only for records created by mistake (e.g. duplicates). Archived records disappear from the directory and from counts; their history and Client ID stay reserved. To end a collaboration, set the status to Inactive instead."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={reason.trim().length < 5}
              onClick={() =>
                start(async () => {
                  const r = await archiveClientAction(id, reason);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  router.push("/clients");
                  router.refresh();
                })
              }
            >
              Archive
            </Button>
          </>
        }
      >
        <Field label="Reason" required>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate of MIL-CL-0007" />
        </Field>
      </Dialog>
    </>
  );
}
