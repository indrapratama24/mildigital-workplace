"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changeLevelAction, createEmployeeAction, policyOverrideAction, setEmployeeActiveAction, setLeaderAction, updateEmployeeAction } from "@/server/actions/admin";
import { setLeaveBalanceAction } from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Notice, Table } from "@/components/ui/misc";

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

const ROLES = [
  ["EMPLOYEE", "Employee"],
  ["LEADER", "Leader"],
  ["HR", "HR / People Ops"],
  ["SUPER_ADMIN", "Super Admin"],
];
const STATUSES = ["PERMANENT", "CONTRACT", "PROBATION", "INTERN"];

export function EditEmployeeForm({
  id,
  initial,
  departments,
  teams,
  levels,
  canGrantAdmin,
  levelDefaultDate,
}: {
  id: string;
  initial: { fullName: string; jobTitle: string; employmentStatus: string; departmentId: string; teamId: string; role: string; levelId: string; roleDescription: string; fullTimeSince: string };
  departments: Opt[];
  teams: Opt[];
  levels: Opt[];
  canGrantAdmin: boolean;
  levelDefaultDate: string;
}) {
  const [f, setF] = useState(initial);
  const [levelFrom, setLevelFrom] = useState(levelDefaultDate);
  const [levelReason, setLevelReason] = useState("");
  const levelChanged = f.levelId !== initial.levelId;
  const router = useRouter();
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const { levelId, ...profile } = f;
      const r = await updateEmployeeAction(id, { ...profile, departmentId: f.departmentId || null, teamId: f.teamId || null, roleDescription: f.roleDescription.trim() || null, fullTimeSince: f.fullTimeSince || null });
      if (!r.ok) return void toast.error(r.error);
      if (levelChanged) {
        const l = await changeLevelAction({ employeeId: id, levelId, effectiveFrom: levelFrom, reason: levelReason.trim() || "Level group updated in profile" });
        if (!l.ok) return void toast.error(l.error);
      }
      toast.success(levelChanged ? "Profile and level group updated" : "Profile updated");
      router.refresh();
    });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Full name"><Input value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>
      <Field label="Job title"><Input value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></Field>
      <Field label="Employment status">
        <Select value={f.employmentStatus} onChange={(e) => setF({ ...f, employmentStatus: e.target.value })}>
          {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
        </Select>
      </Field>
      <Field label="Leave-eligible since" hint="The day they passed probation (about 3 months for regular staff, 6 for trainees; extended probation follows the company's decision). Annual leave is earned 1 day per month from this month.">
        <Input type="date" value={f.fullTimeSince} onChange={(e) => setF({ ...f, fullTimeSince: e.target.value })} />
      </Field>
      <Field label="Permission role" hint="Independent of level. Approvers need Leader/HR/Admin.">
        <Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
          {ROLES.filter(([r]) => canGrantAdmin || r === "EMPLOYEE" || r === "LEADER" || r === initial.role).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
      </Field>
      <Field label="Department">
        <Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>
          <option value="">—</option>
          {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </Select>
      </Field>
      <Field label="Primary team" hint="Team changes apply from today.">
        <Select value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value })}>
          <option value="">—</option>
          {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </Select>
      </Field>
      <Field label="Level group" hint="Determines the WFO policy. Independent of the permission role.">
        <Select value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}>
          {!f.levelId && <option value="">—</option>}
          {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </Field>
      {levelChanged ? (
        <Field label="Level effective from" hint="Months already submitted keep their policy snapshot.">
          <Input type="date" value={levelFrom} onChange={(e) => setLevelFrom(e.target.value)} />
        </Field>
      ) : (
        <div className="hidden sm:block" />
      )}
      {levelChanged && (
        <Field label="Reason for level change" className="sm:col-span-2">
          <Input value={levelReason} onChange={(e) => setLevelReason(e.target.value)} placeholder="e.g. Promotion to Senior" />
        </Field>
      )}
      <Field label="Role description (optional)" className="sm:col-span-2" hint="Shown on the directory profile.">
        <Textarea value={f.roleDescription} onChange={(e) => setF({ ...f, roleDescription: e.target.value })} className="min-h-[60px]" maxLength={1000} />
      </Field>
      <div className="sm:col-span-2">
        <Button loading={pending} onClick={save}>Save profile</Button>
      </div>
    </div>
  );
}

export function ChangeLevelForm({ employeeId, levels, defaultDate }: { employeeId: string; levels: Opt[]; defaultDate: string }) {
  const [f, setF] = useState({ levelId: "", effectiveFrom: defaultDate, reason: "" });
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="New level">
          <Select value={f.levelId} onChange={(e) => setF({ ...f, levelId: e.target.value })}>
            <option value="">Choose…</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Effective from" hint="Months before this keep the previous policy.">
          <Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} />
        </Field>
      </div>
      <Field label="Reason"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Promotion to Senior" /></Field>
      <Button size="sm" loading={pending} disabled={!f.levelId || f.reason.trim().length < 5} onClick={() => run(() => changeLevelAction({ employeeId, ...f }), () => setF({ ...f, levelId: "", reason: "" }))}>Schedule level change</Button>
    </div>
  );
}

export function LeaderForm({ employeeId, leaders, defaultDate, current }: { employeeId: string; leaders: Opt[]; defaultDate: string; current: { PRIMARY: string; SECONDARY: string } }) {
  // prefilled with the current leader so saving without changes never removes the reporting line
  const [f, setF] = useState({ leaderId: current.PRIMARY, type: "PRIMARY", effectiveFrom: defaultDate });
  const unchanged = f.leaderId === current[f.type as "PRIMARY" | "SECONDARY"];
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Leader">
          <Select value={f.leaderId} onChange={(e) => setF({ ...f, leaderId: e.target.value })}>
            <option value="">— none (remove) —</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </Field>
        <Field label="Type">
          <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, leaderId: current[e.target.value as "PRIMARY" | "SECONDARY"] })}>
            <option value="PRIMARY">Primary (approver)</option>
            <option value="SECONDARY">Secondary (fallback)</option>
          </Select>
        </Field>
        <Field label="Effective from"><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
      </div>
      <p className="text-[12px] text-muted">Pending approvals move to the new primary leader if effective today or earlier. Decided approvals keep their original approver. Circular reporting lines are blocked.</p>
      <Button size="sm" loading={pending} disabled={unchanged} onClick={() => run(() => setLeaderAction({ employeeId, leaderId: f.leaderId || null, type: f.type, effectiveFrom: f.effectiveFrom }))}>Save reporting line</Button>
    </div>
  );
}

export function PolicyOverrideForm({ employeeId, policies, defaultDate }: { employeeId: string; policies: Opt[]; defaultDate: string }) {
  const [f, setF] = useState({ policyId: "", effectiveFrom: defaultDate, reason: "" });
  const { pending, run } = useRun();
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Policy">
          <Select value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}>
            <option value="">— follow level (remove override) —</option>
            {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Effective from"><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
      </div>
      <Field label="Reason (required)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Approved medical accommodation" /></Field>
      <Button size="sm" variant="secondary" loading={pending} disabled={f.reason.trim().length < 5} onClick={() => run(() => policyOverrideAction({ employeeId, policyId: f.policyId || null, effectiveFrom: f.effectiveFrom, reason: f.reason }))}>Save override</Button>
    </div>
  );
}

export function BalanceForm({ employeeId, typeId, year, entitled, adjusted }: { employeeId: string; typeId: string; year: number; entitled: number; adjusted: number }) {
  const [f, setF] = useState({ entitledDays: entitled, adjustedDays: adjusted });
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Entitled"><Input type="number" step="0.5" className="w-24" value={f.entitledDays} onChange={(e) => setF({ ...f, entitledDays: Number(e.target.value) })} /></Field>
      <Field label="Adjustment"><Input type="number" step="0.5" className="w-24" value={f.adjustedDays} onChange={(e) => setF({ ...f, adjustedDays: Number(e.target.value) })} /></Field>
      <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => setLeaveBalanceAction({ employeeId, requestTypeId: typeId, year, ...f }))}>Save</Button>
    </div>
  );
}

export function ActiveToggle({ id, active, name }: { id: string; active: boolean; name: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Button variant={active ? "danger-outline" : "secondary"} size="sm" onClick={() => setOpen(true)}>{active ? "Deactivate" : "Reactivate"}</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`${active ? "Deactivate" : "Reactivate"} ${name}?`}
        description={active ? "They lose access immediately (sessions are revoked). History is kept. Direct reports and pending approvals must be reassigned first." : "They can sign in again."}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant={active ? "danger" : "primary"} loading={pending} onClick={() => run(() => setEmployeeActiveAction(id, !active), () => setOpen(false))}>{active ? "Deactivate" : "Reactivate"}</Button>
          </>
        }
      />
    </>
  );
}

export function NewEmployeeForm({ departments, teams, levels, leaders, canGrantAdmin, today }: { departments: Opt[]; teams: Opt[]; levels: Opt[]; leaders: Opt[]; canGrantAdmin: boolean; today: string }) {
  const router = useRouter();
  const [f, setF] = useState({ employeeCode: "", fullName: "", email: "", employmentStatus: "PERMANENT", jobTitle: "", departmentId: "", teamId: "", levelId: "", leaderId: "", secondaryLeaderId: "", startDate: today, role: "EMPLOYEE", password: "" });
  const [pending, start] = useTransition();
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Employee ID" required><Input value={f.employeeCode} onChange={set("employeeCode")} placeholder="MIL-0100" /></Field>
      <Field label="Full name" required><Input value={f.fullName} onChange={set("fullName")} /></Field>
      <Field label="Work email" required><Input type="email" value={f.email} onChange={set("email")} /></Field>
      <Field label="Job title" required><Input value={f.jobTitle} onChange={set("jobTitle")} /></Field>
      <Field label="Employment status">
        <Select value={f.employmentStatus} onChange={set("employmentStatus")}>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select>
      </Field>
      <Field label="Start date" required><Input type="date" value={f.startDate} onChange={set("startDate")} /></Field>
      <Field label="Level group" required hint="Determines the WFO policy automatically.">
        <Select value={f.levelId} onChange={set("levelId")}><option value="">Choose…</option>{levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
      </Field>
      <Field label="Permission role">
        <Select value={f.role} onChange={set("role")}>{ROLES.filter(([r]) => canGrantAdmin || r === "EMPLOYEE" || r === "LEADER").map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
      </Field>
      <Field label="Department">
        <Select value={f.departmentId} onChange={set("departmentId")}><option value="">—</option>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select>
      </Field>
      <Field label="Team">
        <Select value={f.teamId} onChange={set("teamId")}><option value="">—</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</Select>
      </Field>
      <Field label="Direct leader">
        <Select value={f.leaderId} onChange={set("leaderId")}><option value="">—</option>{leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
      </Field>
      <Field label="Secondary leader (optional)">
        <Select value={f.secondaryLeaderId} onChange={set("secondaryLeaderId")}><option value="">—</option>{leaders.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>
      </Field>
      <Field label="Initial password" hint="10+ characters with letters and numbers. Leave empty to generate a random one (reset later)." className="sm:col-span-2">
        <Input type="password" autoComplete="new-password" value={f.password} onChange={set("password")} />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          loading={pending}
          onClick={() =>
            start(async () => {
              const r = await createEmployeeAction({
                ...f,
                departmentId: f.departmentId || null,
                teamId: f.teamId || null,
                leaderId: f.leaderId || null,
                secondaryLeaderId: f.secondaryLeaderId || null,
                password: f.password || undefined,
              });
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              router.push(`/directory/${r.data!.id}`);
            })
          }
        >
          Create employee
        </Button>
        <Button variant="ghost" onClick={() => router.back()}>Cancel</Button>
      </div>
    </div>
  );
}

