"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Archive, RefreshCw } from "lucide-react";
import { archiveClientAction, changeClientStatusAction } from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import type { ClientStatusT } from "@/lib/engine/clients";
import { formatDate } from "@/lib/dates";

export function ChangeStatusButton({ id, status, statusFrom, dateStart, today }: { id: string; status: ClientStatusT; statusFrom: string; dateStart: string; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const choices = (["ACTIVE", "FREEZE", "INACTIVE"] as ClientStatusT[]).filter((s) => s !== status && !(status === "INACTIVE" && s === "FREEZE"));
  const [f, setF] = useState({ status: choices[0], effectiveDate: today, dateOff: today, reason: "" });
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await changeClientStatusAction(id, { status: f.status, effectiveDate: f.status === "INACTIVE" ? null : f.effectiveDate, dateOff: f.status === "INACTIVE" ? f.dateOff : null, reason: f.reason || null });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
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
            <Button loading={pending} onClick={save}>Save status</Button>
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
            <Field label="Date OFF" required hint="Last day of collaboration">
              <Input type="date" value={f.dateOff} min={statusFrom > dateStart ? statusFrom : dateStart} max={today} onChange={(e) => setF({ ...f, dateOff: e.target.value })} />
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
        {status === "INACTIVE" && f.status === "ACTIVE" && (
          <Notice className="mt-3">Reactivation starts a new engagement with the last package. Date START stays {formatDate(dateStart)}.</Notice>
        )}
      </Dialog>
    </>
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
