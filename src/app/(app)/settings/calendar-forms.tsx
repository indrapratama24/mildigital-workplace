"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { addCalendarGrantAction, removeCalendarGrantAction, setCalendarVisibilityAction, upsertEventCategoryAction } from "@/server/actions/calendar";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";

type Opt = { id: string; name: string };
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

const ROLE_HELP: Record<string, string> = {
  VIEWER: "Sees events in scope (only matters when visibility is “assigned events only”).",
  ORGANIZER: "Creates events and edits the ones they organise or created, within scope.",
  EDITOR: "Creates and edits any event whose participants are within scope.",
  MANAGER: "Editor rights plus cancelling events and managing participants in scope. With “All” scope: also manages categories.",
};

export function GrantForm({ employees, teams, departments }: { employees: Opt[]; teams: Opt[]; departments: Opt[] }) {
  const [f, setF] = useState({ subjectType: "EMPLOYEE", subjectId: "", permissionRole: "EDITOR", scope: "ALL", scopeId: "" });
  const { pending, run } = useRun();
  const subjects = f.subjectType === "EMPLOYEE" ? employees : f.subjectType === "TEAM" ? teams : [
    { id: "EMPLOYEE", name: "All employees (role)" },
    { id: "LEADER", name: "Leaders (role)" },
    { id: "HR", name: "HR / People Ops (role)" },
  ];
  return (
    <div className="space-y-3 rounded-2xl border border-line-2 p-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Assign to">
          <Select value={f.subjectType} onChange={(e) => setF({ ...f, subjectType: e.target.value, subjectId: "" })}>
            <option value="EMPLOYEE">Individual employee</option>
            <option value="TEAM">Team (all members)</option>
            <option value="ROLE">Application role</option>
          </Select>
        </Field>
        <Field label={f.subjectType === "EMPLOYEE" ? "Employee" : f.subjectType === "TEAM" ? "Team" : "Role"}>
          <Select value={f.subjectId} onChange={(e) => setF({ ...f, subjectId: e.target.value })}>
            <option value="">Choose…</option>
            {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <Field label="Calendar role">
          <Select value={f.permissionRole} onChange={(e) => setF({ ...f, permissionRole: e.target.value })}>
            <option value="VIEWER">Calendar viewer</option>
            <option value="ORGANIZER">Event organizer</option>
            <option value="EDITOR">Calendar editor</option>
            <option value="MANAGER">Calendar manager</option>
          </Select>
        </Field>
        <Field label="Scope">
          <Select value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value, scopeId: "" })}>
            <option value="ALL">All events</option>
            <option value="DEPARTMENT">One department</option>
            <option value="TEAM">One team</option>
          </Select>
        </Field>
        {f.scope !== "ALL" && (
          <Field label={f.scope === "TEAM" ? "Team" : "Department"}>
            <Select value={f.scopeId} onChange={(e) => setF({ ...f, scopeId: e.target.value })}>
              <option value="">Choose…</option>
              {(f.scope === "TEAM" ? teams : departments).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
      </div>
      <p className="text-[12px] text-muted">{ROLE_HELP[f.permissionRole]} Scope limits which participants their events may include.</p>
      <Button size="sm" loading={pending} disabled={!f.subjectId || (f.scope !== "ALL" && !f.scopeId)} onClick={() => run(() => addCalendarGrantAction({ ...f, scopeId: f.scope === "ALL" ? null : f.scopeId }), () => setF({ ...f, subjectId: "" }))}>
        <Plus className="h-4 w-4" /> Add permission
      </Button>
    </div>
  );
}

export function RevokeGrant({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => removeCalendarGrantAction(id))} aria-label="Remove permission">
      <Trash2 className="h-3.5 w-3.5" />
    </Button>
  );
}

export function CategoryRow({ c }: { c?: { id: string; name: string; color: string; isActive: boolean } }) {
  const [f, setF] = useState(c ?? { name: "", color: "#1f63ee", isActive: true });
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-line-2 py-2.5">
      <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-white p-1" aria-label="Colour" />
      <Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="New category name" className="w-[240px]" />
      <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Active" className="mb-2.5" />
      <Button size="md" variant={c ? "secondary" : "primary"} loading={pending} disabled={f.name.trim().length < 2} onClick={() => run(() => upsertEventCategoryAction({ ...f, id: c?.id }), () => !c && setF({ name: "", color: "#1f63ee", isActive: true }))}>
        {c ? "Save" : "Add category"}
      </Button>
    </div>
  );
}

export function VisibilitySetting({ value }: { value: "ALL" | "ASSIGNED" }) {
  const { pending, run } = useRun();
  return (
    <Field label="Who can see published events?">
      <Select value={value} disabled={pending} onChange={(e) => run(() => setCalendarVisibilityAction(e.target.value))} className="max-w-md">
        <option value="ALL">All active employees (company calendar)</option>
        <option value="ASSIGNED">Only assigned participants, organizers and calendar viewers/editors</option>
      </Select>
    </Field>
  );
}
