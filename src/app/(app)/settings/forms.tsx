"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil, Plus, Trash2 } from "lucide-react";
import * as A from "@/server/actions/admin";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/misc";
import { WEEKDAY_SHORT } from "@/lib/dates";
import { cn } from "@/lib/cn";
import type { LevelException, Requirement } from "@/lib/engine/request-rules";

type Result = { ok: boolean; error?: string; message?: string; data?: unknown };
function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<Result>, after?: (r: Result) => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.(r);
      router.refresh();
    });
  return { pending, run };
}

function Weekdays({ value, onChange, disabled = [] }: { value: number[]; onChange: (v: number[]) => void; disabled?: number[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {[1, 2, 3, 4, 5, 6, 7].map((d) => {
        const on = value.includes(d);
        return (
          <button
            key={d}
            type="button"
            disabled={disabled.includes(d)}
            onClick={() => onChange(on ? value.filter((x) => x !== d) : [...value, d].sort())}
            aria-pressed={on}
            className={cn("h-9 w-12 rounded-xl border text-[13px] font-medium disabled:opacity-30", on ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-2 hover:border-brand-300")}
          >
            {WEEKDAY_SHORT[d]}
          </button>
        );
      })}
    </div>
  );
}

// ───────────── Policy version ─────────────
export interface VersionDTO {
  wfoPercent: number;
  mandatoryWeekdays: number[];
  flexibleWeekdays: number[];
  evaluationPeriod: "MONTHLY" | "QUARTERLY";
  submissionDeadlineDay: number;
  requiresLeaderApproval: boolean;
  wfhCarryOver: boolean;
  exceptionsRequireHr: boolean;
  roundingMode: "CEIL" | "ROUND" | "FLOOR";
  excludeLeaveFromDenominator: boolean;
  offsiteCountsAsWfo: boolean;
}

/** Creates a new version from `current`, or — with `edit` — adjusts a version that hasn't taken effect yet. */
export function PolicyVersionDialog({
  policyId,
  policyName,
  current,
  defaultDate,
  edit,
}: {
  policyId: string;
  policyName: string;
  current: VersionDTO;
  defaultDate: string;
  edit?: { id: string; version: number; changeNote: string | null };
}) {
  const [open, setOpen] = useState(false);
  const initial = () => ({ ...pickVersion(current), effectiveFrom: defaultDate, changeNote: edit?.changeNote ?? "" });
  const [f, setF] = useState(initial);
  const [warn, setWarn] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const { pending, run } = useRun();
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => {
      const r = await A.previewPolicyAction({ wfoPercent: f.wfoPercent, mandatoryWeekdays: f.mandatoryWeekdays, flexibleWeekdays: f.flexibleWeekdays });
      if (r.ok && r.data) setWarn(r.data);
    }, 200);
    return () => clearTimeout(t);
  }, [open, f.wfoPercent, f.mandatoryWeekdays, f.flexibleWeekdays]);
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <>
      <Button size="sm" variant={edit ? "ghost" : "secondary"} onClick={() => { setF(initial()); setOpen(true); }}>
        <Pencil className="h-3.5 w-3.5" /> {edit ? "Edit" : "New version"}
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={edit ? `Edit scheduled change · ${policyName}` : `New version · ${policyName}`}
        description={
          edit
            ? "This version hasn't taken effect yet, so its rules and start date can still change. The previous version is extended or shortened to match."
            : "Policies are versioned. The current version ends the day before the new effective date; months already submitted keep their snapshot."
        }
        className="sm:max-w-2xl"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} disabled={warn.errors.length > 0 || f.changeNote.trim().length < 5} onClick={() => run(() => (edit ? A.updatePolicyVersionAction(edit.id, f) : A.createPolicyVersionAction(policyId, f)), () => setOpen(false))}>
              {edit ? "Save changes" : "Save version"}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum WFO %" hint={`Max WFH is derived: ${100 - f.wfoPercent}%`}>
            <Input type="number" min={0} max={100} value={f.wfoPercent} onChange={(e) => set("wfoPercent", Math.max(0, Math.min(100, Number(e.target.value))))} />
          </Field>
          <Field label="Effective from">
            <Input type="date" value={f.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
          </Field>
          <Field label="Mandatory WFO weekdays" className="sm:col-span-2">
            <Weekdays value={f.mandatoryWeekdays} onChange={(v) => setF((p) => ({ ...p, mandatoryWeekdays: v, flexibleWeekdays: p.flexibleWeekdays.filter((d) => !v.includes(d)) }))} disabled={[6, 7]} />
          </Field>
          <Field label="Flexible weekdays" className="sm:col-span-2">
            <Weekdays value={f.flexibleWeekdays} onChange={(v) => set("flexibleWeekdays", v)} disabled={[6, 7, ...f.mandatoryWeekdays]} />
          </Field>
          <Field label="Evaluation period">
            <Select value={f.evaluationPeriod} onChange={(e) => set("evaluationPeriod", e.target.value as VersionDTO["evaluationPeriod"])}>
              <option value="MONTHLY">Monthly</option>
              <option value="QUARTERLY">Quarterly</option>
            </Select>
          </Field>
          <Field label="Plan submission deadline" hint="Day of the previous month (1–28)">
            <Input type="number" min={1} max={28} value={f.submissionDeadlineDay} onChange={(e) => set("submissionDeadlineDay", Number(e.target.value))} />
          </Field>
          <Field label="Rounding">
            <Select value={f.roundingMode} onChange={(e) => set("roundingMode", e.target.value as VersionDTO["roundingMode"])}>
              <option value="CEIL">Round up (default)</option>
              <option value="ROUND">Round half up</option>
              <option value="FLOOR">Round down</option>
            </Select>
          </Field>
          <div />
          <Checkbox checked={f.requiresLeaderApproval} onChange={(e) => set("requiresLeaderApproval", e.target.checked)} label="Leader approval required" description="Off = plans auto-approve on submission." />
          <Checkbox checked={f.exceptionsRequireHr} onChange={(e) => set("exceptionsRequireHr", e.target.checked)} label="Exceptions require HR approval" />
          <Checkbox checked={f.excludeLeaveFromDenominator} onChange={(e) => set("excludeLeaveFromDenominator", e.target.checked)} label="Exclude approved full-day leave from the denominator" />
          <Checkbox checked={f.offsiteCountsAsWfo} onChange={(e) => set("offsiteCountsAsWfo", e.target.checked)} label="Offsite duty counts as WFO" description="Off = offsite days are neutral (excluded)." />
          <Checkbox checked={f.wfhCarryOver} onChange={(e) => set("wfhCarryOver", e.target.checked)} label="Unused WFH allowance can carry over" description="Recorded for reporting; not applied automatically (see docs)." />
          <Field label="Change note" className="sm:col-span-2" required>
            <Textarea value={f.changeNote} onChange={(e) => set("changeNote", e.target.value)} className="min-h-[60px]" placeholder="Why is this changing?" />
          </Field>
        </div>
        <div className="mt-4 space-y-2">
          {warn.errors.map((e) => <Notice key={e} tone="danger">{e}</Notice>)}
          {warn.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
        </div>
      </Dialog>
    </>
  );
}

function pickVersion(v: VersionDTO): VersionDTO {
  return {
    wfoPercent: v.wfoPercent,
    mandatoryWeekdays: v.mandatoryWeekdays,
    flexibleWeekdays: v.flexibleWeekdays,
    evaluationPeriod: v.evaluationPeriod,
    submissionDeadlineDay: v.submissionDeadlineDay,
    requiresLeaderApproval: v.requiresLeaderApproval,
    wfhCarryOver: v.wfhCarryOver,
    exceptionsRequireHr: v.exceptionsRequireHr,
    roundingMode: v.roundingMode,
    excludeLeaveFromDenominator: v.excludeLeaveFromDenominator,
    offsiteCountsAsWfo: v.offsiteCountsAsWfo,
  };
}

export function CancelVersionButton({ id, version, fromLabel }: { id: string; version: number; fromLabel: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setOpen(true)}>
        <Trash2 className="h-3.5 w-3.5" /> Cancel
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Cancel this scheduled change?"
        description={`It won't start on ${fromLabel}; the current rules simply continue. This is recorded in the audit log.`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Keep it</Button>
            <Button variant="danger" loading={pending} onClick={() => run(() => A.cancelPolicyVersionAction(id), () => setOpen(false))}>Cancel change</Button>
          </>
        }
      />
    </>
  );
}

export function NewPolicyForm({ today }: { today: string }) {
  const [f, setF] = useState({ name: "", wfoPercent: 50, effectiveFrom: today });
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Policy name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-[240px]" /></Field>
      <Field label="WFO %"><Input type="number" className="w-24" value={f.wfoPercent} onChange={(e) => setF({ ...f, wfoPercent: Number(e.target.value) })} /></Field>
      <Field label="Effective from"><Input type="date" value={f.effectiveFrom} onChange={(e) => setF({ ...f, effectiveFrom: e.target.value })} /></Field>
      <Button size="md" variant="secondary" loading={pending} disabled={f.name.trim().length < 3} onClick={() => run(() => A.createPolicyAction(f), () => setF({ ...f, name: "" }))}>
        <Plus className="h-4 w-4" /> Create policy
      </Button>
    </div>
  );
}

export function LevelRow({ level, policies }: { level: { id: string; name: string; description: string | null; policyId: string }; policies: { id: string; name: string }[] }) {
  const [f, setF] = useState(level);
  const { pending, run } = useRun();
  const dirty = f.name !== level.name || f.policyId !== level.policyId || (f.description ?? "") !== (level.description ?? "");
  return (
    <div className="grid gap-2 border-b border-line-2 py-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <Field label="Level"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Policy">
        <Select value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}>
          {policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <Button size="md" variant={dirty ? "primary" : "secondary"} disabled={!dirty} loading={pending} onClick={() => run(() => A.updateLevelAction(f))}>Save</Button>
    </div>
  );
}

export function NewLevelForm({ policies }: { policies: { id: string; name: string }[] }) {
  const [f, setF] = useState({ code: "", name: "", policyId: policies[0]?.id ?? "" });
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-2 pt-3">
      <Field label="Code"><Input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} className="w-32" placeholder="LEAD" /></Field>
      <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className="w-[220px]" /></Field>
      <Field label="Policy">
        <Select value={f.policyId} onChange={(e) => setF({ ...f, policyId: e.target.value })}>{policies.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
      </Field>
      <Button variant="secondary" loading={pending} disabled={!f.code || !f.name} onClick={() => run(() => A.createLevelAction(f), () => setF({ ...f, code: "", name: "" }))}><Plus className="h-4 w-4" /> Add level</Button>
    </div>
  );
}

// ───────────── Teams ─────────────
export function DepartmentForm({ initial }: { initial?: { id: string; code: string; name: string } }) {
  const [f, setF] = useState(initial ?? { code: "", name: "" });
  const { pending, run } = useRun();
  return (
    <div className="flex flex-wrap items-end gap-2">
      <Field label="Code"><Input className="w-32" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
      <Field label="Department name"><Input className="w-[240px]" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Button variant={initial ? "secondary" : "primary"} size="md" loading={pending} onClick={() => run(() => A.upsertDepartmentAction(f), () => !initial && setF({ code: "", name: "" }))}>{initial ? "Save" : "Add department"}</Button>
    </div>
  );
}

export function TeamDialog({ initial, departments, approvers }: { initial?: { id: string; name: string; departmentId: string; leadId: string | null; backupApproverId: string | null; isActive: boolean }; departments: { id: string; name: string }[]; approvers: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ id?: string; name: string; departmentId: string; leadId: string | null; backupApproverId: string | null; isActive: boolean }>(initial ?? { name: "", departmentId: departments[0]?.id ?? "", leadId: null, backupApproverId: null, isActive: true });
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant={initial ? "ghost" : "primary"} onClick={() => setOpen(true)}>{initial ? <Pencil className="h-3.5 w-3.5" /> : <><Plus className="h-4 w-4" /> Add team</>}</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={initial ? `Edit ${initial.name}` : "Add team"}
        description="The backup approver receives approvals when the leader is unavailable."
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={pending} onClick={() => run(() => A.upsertTeamAction(f), () => setOpen(false))}>Save team</Button></>}
      >
        <div className="grid gap-3">
          <Field label="Team name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Department"><Select value={f.departmentId} onChange={(e) => setF({ ...f, departmentId: e.target.value })}>{departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          <Field label="Team lead"><Select value={f.leadId ?? ""} onChange={(e) => setF({ ...f, leadId: e.target.value || null })}><option value="">—</option>{approvers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Field label="Backup approver"><Select value={f.backupApproverId ?? ""} onChange={(e) => setF({ ...f, backupApproverId: e.target.value || null })}><option value="">—</option>{approvers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</Select></Field>
          <Checkbox checked={f.isActive} onChange={(e) => setF({ ...f, isActive: e.target.checked })} label="Active" />
        </div>
      </Dialog>
    </>
  );
}

// ───────────── Holidays ─────────────
export function HolidayDialog({ initial }: { initial?: { id: string; date: string; name: string; type: "NATIONAL" | "CUTI_BERSAMA" | "COMPANY"; isObserved: boolean } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<{ id?: string; date: string; name: string; type: "NATIONAL" | "CUTI_BERSAMA" | "COMPANY"; isObserved: boolean }>(initial ?? { date: "", name: "", type: "COMPANY", isObserved: true });
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant={initial ? "ghost" : "primary"} onClick={() => setOpen(true)} aria-label={initial ? "Edit holiday" : undefined}>{initial ? <Pencil className="h-3.5 w-3.5" /> : <><Plus className="h-4 w-4" /> Add holiday</>}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={initial ? "Edit holiday" : "Add holiday"} footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={pending} onClick={() => run(() => A.upsertHolidayAction(f), () => setOpen(false))}>Save</Button></>}>
        <div className="grid gap-3">
          <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Type">
            <Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as typeof f.type })}>
              <option value="NATIONAL">National holiday</option>
              <option value="CUTI_BERSAMA">Cuti bersama</option>
              <option value="COMPANY">Company holiday</option>
            </Select>
          </Field>
          <Checkbox checked={f.isObserved} onChange={(e) => setF({ ...f, isObserved: e.target.checked })} label="Observed (office closed)" description="Untick for a manual override: the company works on this day." />
        </div>
      </Dialog>
    </>
  );
}

export function DeleteHolidayButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return <Button size="sm" variant="ghost" loading={pending} onClick={() => run(() => A.deleteHolidayAction(id))} aria-label="Delete holiday"><Trash2 className="h-3.5 w-3.5" /></Button>;
}

export function HolidayImport() {
  const [csv, setCsv] = useState("");
  const { pending, run } = useRun();
  return (
    <div className="space-y-2">
      <Textarea value={csv} onChange={(e) => setCsv(e.target.value)} className="min-h-[110px] font-mono text-[12px]" placeholder={"date,name,type\n2027-03-10,Hari Suci Nyepi,NATIONAL"} />
      <Button size="sm" variant="secondary" loading={pending} disabled={!csv.trim()} onClick={() => run(() => A.importHolidaysAction(csv), (r) => { const d = r.data as { created: number; skipped: number }; toast.success(`${d.created} imported, ${d.skipped} already existed`); setCsv(""); })}>Import holidays</Button>
    </div>
  );
}

// ───────────── Request types ─────────────
export interface RequestTypeDTO {
  id?: string;
  code: string;
  name: string;
  category: "LEAVE" | "PERMISSION" | "OFFSITE" | "ADDITIONAL_WFH" | "SCHEDULE_CHANGE";
  description?: string;
  documentRequirement: "NONE" | "OPTIONAL" | "REQUIRED";
  delegation: "NONE" | "OPTIONAL" | "REQUIRED";
  reasonMinLength: number;
  advanceNoticeDays: number;
  allowHalfDay: boolean;
  allowHourly: boolean;
  deductsBalance: boolean;
  defaultEntitlement: number | null;
  monthlyAccrual: boolean;
  eligibleStatuses: ("PERMANENT" | "CONTRACT" | "PROBATION" | "INTERN")[];
  annualRules: boolean;
  isSensitive: boolean;
  isActive: boolean;
  levelExceptions: LevelException[];
}

const REQ_LABEL: Record<Requirement, string> = { NONE: "Not requested", OPTIONAL: "Optional", REQUIRED: "Required" };
const DELEG_LABEL: Record<Requirement, string> = { NONE: "Not used", OPTIONAL: "Optional", REQUIRED: "Required" };

/** Rules that differ for some levels (e.g. leaders). Empty fields keep the type's own rule. */
function LevelExceptions({ f, levels, onChange }: { f: RequestTypeDTO; levels: { id: string; name: string }[]; onChange: (v: LevelException[]) => void }) {
  const list = f.levelExceptions;
  const update = (i: number, patch: Partial<LevelException>) => onChange(list.map((e, k) => (k === i ? { ...e, ...patch } : e)));
  const num = (v: string) => (v === "" ? null : Number(v));
  const bool = (v: string) => (v === "" ? null : v === "yes");
  const usedElsewhere = (i: number) => new Set(list.flatMap((e, k) => (k === i ? [] : e.levelIds)));
  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-medium text-ink-2">Exceptions by level</div>
          <p className="text-[12px] text-muted">Different rules for some levels, e.g. leaders. Leave a field empty to keep the rule above.</p>
        </div>
        <Button size="sm" variant="secondary" disabled={list.length >= 10} onClick={() => onChange([...list, { name: "", levelIds: [] }])}>
          <Plus className="h-3.5 w-3.5" /> Add exception
        </Button>
      </div>
      <div className="space-y-3">
        {list.map((e, i) => {
          const taken = usedElsewhere(i);
          return (
            <div key={i} className="rounded-xl border border-line bg-canvas/60 p-3">
              <div className="flex items-end gap-2">
                <Field label="Exception name" className="flex-1"><Input value={e.name} placeholder="e.g. Leaders" onChange={(ev) => update(i, { name: ev.target.value })} /></Field>
                <Button size="sm" variant="ghost" aria-label={`Remove ${e.name || "exception"}`} onClick={() => onChange(list.filter((_, k) => k !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="mt-2.5">
                <div className="mb-1 text-[12.5px] font-medium text-ink-2">Applies to levels</div>
                <div className="flex flex-wrap gap-1.5">
                  {levels.map((l) => {
                    const on = e.levelIds.includes(l.id);
                    const off = !on && taken.has(l.id);
                    return (
                      <button key={l.id} type="button" disabled={off} title={off ? "Already in another exception" : undefined} onClick={() => update(i, { levelIds: on ? e.levelIds.filter((x) => x !== l.id) : [...e.levelIds, l.id] })} className={cn("rounded-full border px-3 py-1 text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-40", on ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-2 hover:border-brand-300")}>
                        {l.name}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="mt-2.5 grid gap-2.5 sm:grid-cols-2">
                <Field label="Advance notice (days)"><Input type="number" min={0} value={e.advanceNoticeDays ?? ""} placeholder={`Same (${f.advanceNoticeDays})`} onChange={(ev) => update(i, { advanceNoticeDays: num(ev.target.value) })} /></Field>
                <Field label="Minimum reason length"><Input type="number" min={0} value={e.reasonMinLength ?? ""} placeholder={`Same (${f.reasonMinLength})`} onChange={(ev) => update(i, { reasonMinLength: num(ev.target.value) })} /></Field>
                <Field label="Supporting document">
                  <Select value={e.documentRequirement ?? ""} onChange={(ev) => update(i, { documentRequirement: (ev.target.value || null) as Requirement | null })}>
                    <option value="">Same ({REQ_LABEL[f.documentRequirement].toLowerCase()})</option>
                    {(Object.keys(REQ_LABEL) as Requirement[]).map((r) => <option key={r} value={r}>{REQ_LABEL[r]}</option>)}
                  </Select>
                </Field>
                <Field label="Peer delegation">
                  <Select value={e.delegation ?? ""} onChange={(ev) => update(i, { delegation: (ev.target.value || null) as Requirement | null })}>
                    <option value="">Same ({DELEG_LABEL[f.delegation].toLowerCase()})</option>
                    {(Object.keys(DELEG_LABEL) as Requirement[]).map((r) => <option key={r} value={r}>{DELEG_LABEL[r]}</option>)}
                  </Select>
                </Field>
                <Field label="Half days">
                  <Select value={e.allowHalfDay == null ? "" : e.allowHalfDay ? "yes" : "no"} onChange={(ev) => update(i, { allowHalfDay: bool(ev.target.value) })}>
                    <option value="">Same ({f.allowHalfDay ? "allowed" : "not allowed"})</option><option value="yes">Allowed</option><option value="no">Not allowed</option>
                  </Select>
                </Field>
                <Field label="Hourly">
                  <Select value={e.allowHourly == null ? "" : e.allowHourly ? "yes" : "no"} onChange={(ev) => update(i, { allowHourly: bool(ev.target.value) })}>
                    <option value="">Same ({f.allowHourly ? "allowed" : "not allowed"})</option><option value="yes">Allowed</option><option value="no">Not allowed</option>
                  </Select>
                </Field>
                {f.deductsBalance && (
                  <Field label="Yearly entitlement (days)"><Input type="number" min={0} value={e.defaultEntitlement ?? ""} placeholder={`Same (${f.defaultEntitlement ?? 0})`} onChange={(ev) => update(i, { defaultEntitlement: num(ev.target.value) })} /></Field>
                )}
              </div>
            </div>
          );
        })}
        {!list.length && <p className="rounded-xl border border-dashed border-line px-3 py-2.5 text-[12.5px] text-muted">No exceptions — everyone follows the rules above.</p>}
      </div>
    </div>
  );
}

export function RequestTypeDialog({ initial, levels }: { initial?: RequestTypeDTO; levels: { id: string; name: string }[] }) {
  const blank: RequestTypeDTO = { code: "", name: "", category: "PERMISSION", description: "", documentRequirement: "NONE", delegation: "OPTIONAL", reasonMinLength: 10, advanceNoticeDays: 0, allowHalfDay: true, allowHourly: false, deductsBalance: false, defaultEntitlement: null, monthlyAccrual: false, eligibleStatuses: [], annualRules: false, isSensitive: false, isActive: true, levelExceptions: [] };
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<RequestTypeDTO>(initial ?? blank);
  const { pending, run } = useRun();
  const set = <K extends keyof RequestTypeDTO>(k: K, v: RequestTypeDTO[K]) => setF((p) => ({ ...p, [k]: v }));
  return (
    <>
      <Button size="sm" variant={initial ? "ghost" : "primary"} onClick={() => setOpen(true)}>{initial ? <Pencil className="h-3.5 w-3.5" /> : <><Plus className="h-4 w-4" /> Add request type</>}</Button>
      <Dialog open={open} onOpenChange={setOpen} title={initial ? `Edit ${initial.name}` : "Add request type"} className="sm:max-w-2xl" footer={<><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button loading={pending} onClick={() => run(() => A.upsertRequestTypeAction({ ...f, description: f.description || undefined }), () => setOpen(false))}>Save</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Code"><Input value={f.code} disabled={!!initial} onChange={(e) => set("code", e.target.value.toUpperCase())} /></Field>
          <Field label="Name"><Input value={f.name} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Category">
            <Select value={f.category} disabled={!!initial} onChange={(e) => set("category", e.target.value as RequestTypeDTO["category"])}>
              <option value="LEAVE">Leave</option><option value="PERMISSION">Permission</option><option value="OFFSITE">Offsite duty</option><option value="ADDITIONAL_WFH">Additional WFH</option><option value="SCHEDULE_CHANGE">Schedule change</option>
            </Select>
          </Field>
          <Field label="Peer delegation">
            <Select value={f.delegation} onChange={(e) => set("delegation", e.target.value as RequestTypeDTO["delegation"])}>
              <option value="NONE">Not used (bypass)</option><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required</option>
            </Select>
          </Field>
          <Field label="Supporting document">
            <Select value={f.documentRequirement} onChange={(e) => set("documentRequirement", e.target.value as RequestTypeDTO["documentRequirement"])}>
              <option value="NONE">Not requested</option><option value="OPTIONAL">Optional</option><option value="REQUIRED">Required</option>
            </Select>
          </Field>
          <Field label="Minimum reason length"><Input type="number" value={f.reasonMinLength} onChange={(e) => set("reasonMinLength", Number(e.target.value))} /></Field>
          <Field label="Advance notice (days)"><Input type="number" value={f.advanceNoticeDays} onChange={(e) => set("advanceNoticeDays", Number(e.target.value))} /></Field>
          <Field label="Default yearly entitlement (days)"><Input type="number" value={f.defaultEntitlement ?? ""} onChange={(e) => set("defaultEntitlement", e.target.value === "" ? null : Number(e.target.value))} /></Field>
          <Field label="Description" className="sm:col-span-2"><Input value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} /></Field>
          <Checkbox checked={f.allowHalfDay} onChange={(e) => set("allowHalfDay", e.target.checked)} label="Allow half days" />
          <Checkbox checked={f.allowHourly} onChange={(e) => set("allowHourly", e.target.checked)} label="Allow hourly" />
          <Checkbox checked={f.deductsBalance} onChange={(e) => set("deductsBalance", e.target.checked)} label="Deducts leave balance" />
          {f.deductsBalance && (
            <>
              <Checkbox checked={f.annualRules} onChange={(e) => set("annualRules", e.target.checked)} label="Annual leave rules" description="Usage tiers, max days off, max % on leave at once and the year-end choice (Settings → Leave rules)." />
              <Checkbox checked={f.monthlyAccrual} onChange={(e) => set("monthlyAccrual", e.target.checked)} label="Earned monthly" description="Entitlement ÷ 12 per month from the month the employee became eligible (full-time since). The balance is counted at the leave date." />
              <div className="sm:col-span-2">
                <div className="mb-1 text-[13px] font-medium text-ink-2">Eligible employment status <span className="font-normal text-muted">(none ticked = everyone)</span></div>
                <div className="flex flex-wrap gap-3">
                  {(["PERMANENT", "CONTRACT", "PROBATION", "INTERN"] as const).map((st) => (
                    <Checkbox key={st} checked={f.eligibleStatuses.includes(st)} onChange={(e) => set("eligibleStatuses", e.target.checked ? [...f.eligibleStatuses, st] : f.eligibleStatuses.filter((x) => x !== st))} label={st.charAt(0) + st.slice(1).toLowerCase()} />
                  ))}
                </div>
              </div>
            </>
          )}
          <Checkbox checked={f.isSensitive} onChange={(e) => set("isSensitive", e.target.checked)} label="Sensitive (medical/private)" description="Documents visible only to approvers and HR." />
          <Checkbox checked={f.isActive} onChange={(e) => set("isActive", e.target.checked)} label="Active" />
          <LevelExceptions f={f} levels={levels} onChange={(v) => set("levelExceptions", v)} />
        </div>
      </Dialog>
    </>
  );
}

// ───────────── System & approvals ─────────────
export interface SettingsDTO {
  workingWeekdays: number[];
  cutiBersamaIsHoliday: boolean;
  clockInValidatesDay: boolean;
  leaderDeadlineHours: number;
  delegateDeadlineHours: number;
  escalation: "BACKUP_APPROVER" | "LEADERS_LEADER" | "HR";
  hrFallbackEmployeeId: string | null;
  reminderDaysBeforeDeadline: number;
}

export function ApprovalSettingsForm({ initial, hrPeople }: { initial: SettingsDTO; hrPeople: { id: string; name: string }[] }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  return (
    <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
      <Field label="Leader approval deadline (hours)" hint="After this, the step escalates."><Input type="number" value={f.leaderDeadlineHours} onChange={(e) => setF({ ...f, leaderDeadlineHours: Number(e.target.value) })} /></Field>
      <Field label="Delegate response deadline (hours)" hint="After this, the requester is reminded."><Input type="number" value={f.delegateDeadlineHours} onChange={(e) => setF({ ...f, delegateDeadlineHours: Number(e.target.value) })} /></Field>
      <Field label="Escalation behaviour">
        <Select value={f.escalation} onChange={(e) => setF({ ...f, escalation: e.target.value as SettingsDTO["escalation"] })}>
          <option value="BACKUP_APPROVER">Fallback chain (secondary leader → team backup → leader&apos;s leader → HR)</option>
          <option value="LEADERS_LEADER">Leader&apos;s leader first</option>
          <option value="HR">Straight to HR</option>
        </Select>
      </Field>
      <Field label="HR fallback approver" hint="Used when no leader is available and for HR exception steps.">
        <Select value={f.hrFallbackEmployeeId ?? ""} onChange={(e) => setF({ ...f, hrFallbackEmployeeId: e.target.value || null })}>
          <option value="">First active HR/Admin</option>
          {hrPeople.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
      </Field>
      <div className="sm:col-span-2">
        <Button loading={pending} onClick={() => run(() => A.updateSettingsAction({ leaderDeadlineHours: f.leaderDeadlineHours, delegateDeadlineHours: f.delegateDeadlineHours, escalation: f.escalation, hrFallbackEmployeeId: f.hrFallbackEmployeeId }))}>Save approval settings</Button>
      </div>
    </div>
  );
}

export function SystemSettingsForm({ initial }: { initial: SettingsDTO }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  const jobs = useRun();
  return (
    <div className="max-w-3xl space-y-5">
      <Field label="Working weekdays" hint="Default Monday–Friday. Changes affect calculations for months not yet locked by submitted plans.">
        <Weekdays value={f.workingWeekdays} onChange={(v) => setF({ ...f, workingWeekdays: v })} />
      </Field>
      <Checkbox checked={f.cutiBersamaIsHoliday} onChange={(e) => setF({ ...f, cutiBersamaIsHoliday: e.target.checked })} label="Treat cuti bersama as non-working days" description="Untick if the company works on cuti bersama (configured independently of national holidays)." />
      <Checkbox checked={f.clockInValidatesDay} onChange={(e) => setF({ ...f, clockInValidatesDay: e.target.checked })} label="A clock-in validates the whole day" description="Off (default): self check-ins stay unverified until a leader or HR verifies them." />
      <Field label="Plan deadline reminder (days before)"><Input type="number" className="w-28" value={f.reminderDaysBeforeDeadline} onChange={(e) => setF({ ...f, reminderDaysBeforeDeadline: Number(e.target.value) })} /></Field>
      <div className="flex flex-wrap gap-2">
        <Button loading={pending} onClick={() => run(() => A.updateSettingsAction({ workingWeekdays: f.workingWeekdays, cutiBersamaIsHoliday: f.cutiBersamaIsHoliday, clockInValidatesDay: f.clockInValidatesDay, reminderDaysBeforeDeadline: f.reminderDaysBeforeDeadline }))}>Save system settings</Button>
        <Button variant="secondary" loading={jobs.pending} onClick={() => jobs.run(() => A.runJobsAction(), (r) => { const d = r.data as { reminders: number; shortfalls: number; escalated: number }; toast.success(`Jobs ran: ${d.reminders} reminders, ${d.shortfalls} shortfalls, ${d.escalated} escalations`); })}>Run daily jobs now</Button>
      </div>
    </div>
  );
}

// ───────────── Policy edit / remove ─────────────
export function PolicyEditDialog({ policy }: { policy: { id: string; name: string; description: string | null } }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: policy.name, description: policy.description ?? "" });
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} aria-label={`Edit ${policy.name}`}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Edit policy"
        description="Renaming doesn't change any rules or history. To change WFO rules, create a new version."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} disabled={f.name.trim().length < 3} onClick={() => run(() => A.updatePolicyAction({ id: policy.id, name: f.name, description: f.description || null }), () => setOpen(false))}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <Field label="Policy name" required><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={120} /></Field>
          <Field label="Description"><Textarea value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} className="min-h-[70px]" maxLength={500} /></Field>
        </div>
      </Dialog>
    </>
  );
}

export function RemovePolicyButton({ policy, usedBy }: { policy: { id: string; name: string }; usedBy: string[] }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useRun();
  return (
    <>
      <Button size="sm" variant="ghost" className="text-danger hover:bg-danger-soft hover:text-danger" onClick={() => setOpen(true)} aria-label={`Remove ${policy.name}`}>
        <Trash2 className="h-3.5 w-3.5" /> Remove
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Remove “${policy.name}”?`}
        description={
          usedBy.length
            ? `It's still assigned to ${usedBy.join(", ")}. Change those levels to another policy first (Employee levels section below).`
            : "If past months were evaluated with this policy it is archived (hidden, history kept); otherwise it's deleted permanently."
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="danger"
              loading={pending}
              disabled={usedBy.length > 0}
              onClick={() =>
                run(
                  () => A.removePolicyAction(policy.id),
                  (r) => {
                    setOpen(false);
                    toast.success((r.data as { mode: string }).mode === "archived" ? "Policy archived — past months keep their history." : "Policy deleted.");
                  },
                )
              }
            >
              Remove policy
            </Button>
          </>
        }
      />
    </>
  );
}

export function RestorePolicyButton({ id }: { id: string }) {
  const { pending, run } = useRun();
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => run(() => A.restorePolicyAction(id))}>
      Restore
    </Button>
  );
}

// ───────────── Leave rules & final approval ─────────────

type LeaveRules = { tier1MaxDays: number; tier2MaxDays: number; tier2GapDays: number; laterMaxDays: number; maxOffDays: number; maxConcurrentPercent: number };
type YearEnd = { enabled: boolean; maxDays: number; windowDays: number; carryUntilMonth: number };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function LeaveRulesForm({ initial }: { initial: { annualLeaveRules: LeaveRules; leaveYearEnd: YearEnd } }) {
  const [r, setR] = useState(initial.annualLeaveRules);
  const [y, setY] = useState(initial.leaveYearEnd);
  const { pending, run } = useRun();
  const num = (label: string, value: number, onChange: (v: number) => void, hint?: string, step = 1) => (
    <Field label={label} hint={hint}><Input type="number" step={step} min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} /></Field>
  );
  return (
    <div className="space-y-6">
      <div>
        <h4 className="mb-2 text-[13.5px] font-semibold text-ink">Usage tiers (per year)</h4>
        <div className="grid gap-3 sm:grid-cols-4">
          {num("Tier 1 · max days", r.tier1MaxDays, (v) => setR({ ...r, tier1MaxDays: v }), "One leave per year up to this many days.")}
          {num("Tier 2 · max days", r.tier2MaxDays, (v) => setR({ ...r, tier2MaxDays: v }), "One more leave up to this many days.")}
          {num("Tier 2 · gap (days)", r.tier2GapDays, (v) => setR({ ...r, tier2GapDays: v }), "Minimum days between the two longer leaves.")}
          {num("Tier 3 · max days", r.laterMaxDays, (v) => setR({ ...r, laterMaxDays: v }), "After that, per request.", 0.5)}
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        {num("Max days off in a row", r.maxOffDays, (v) => setR({ ...r, maxOffDays: v }), "Calendar days, incl. adjoining public holidays.")}
        {num("Max on leave at once (%)", r.maxConcurrentPercent, (v) => setR({ ...r, maxConcurrentPercent: v }), "Share of all active employees on the same date.")}
      </div>
      <div className="border-t border-line-2 pt-5">
        <h4 className="mb-2 text-[13.5px] font-semibold text-ink">Year-end leftover (cash or carry-over)</h4>
        <Checkbox checked={y.enabled} onChange={(e) => setY({ ...y, enabled: e.target.checked })} label="Let employees trade leftover annual leave at year end" />
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          {num("Max days tradable", y.maxDays, (v) => setY({ ...y, maxDays: v }), "Cash or carried over.", 0.5)}
          {num("Choice opens (days before 31 Dec)", y.windowDays, (v) => setY({ ...y, windowDays: v }), "e.g. 30 = from 1 December.")}
          <Field label="Carried days usable until" hint="End of this month next year; unused carried days expire.">
            <Select value={y.carryUntilMonth} onChange={(e) => setY({ ...y, carryUntilMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        </div>
      </div>
      <Button loading={pending} onClick={() => run(() => A.updateLeaveRulesAction({ annualLeaveRules: r, leaveYearEnd: y }))}>Save leave rules</Button>
    </div>
  );
}

export function FinalApprovalForm({ initial, approvers, types }: { initial: { finalApproverEmployeeId: string | null; finalApprovalRequestTypes: string[] }; approvers: { id: string; name: string }[]; types: { id: string; name: string; category: string }[] }) {
  const [f, setF] = useState(initial);
  const { pending, run } = useRun();
  return (
    <div className="space-y-4">
      <Field label="Final approver (after the leader)" hint="Leave empty to switch the final approval off. Skipped when the approver is the requester or already their leader.">
        <Select value={f.finalApproverEmployeeId ?? ""} onChange={(e) => setF({ ...f, finalApproverEmployeeId: e.target.value || null })} className="max-w-sm">
          <option value="">No final approval</option>
          {approvers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
      </Field>
      <div>
        <div className="mb-1.5 text-[13px] font-medium text-ink-2">Applies to</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {types.map((t) => (
            <Checkbox
              key={t.id}
              checked={f.finalApprovalRequestTypes.includes(t.id)}
              disabled={!f.finalApproverEmployeeId}
              onChange={(e) => setF({ ...f, finalApprovalRequestTypes: e.target.checked ? [...f.finalApprovalRequestTypes, t.id] : f.finalApprovalRequestTypes.filter((x) => x !== t.id) })}
              label={t.name}
              description={t.category.toLowerCase().replace("_", " ")}
            />
          ))}
        </div>
      </div>
      <p className="text-[12px] text-muted">Applies to requests submitted from now on; requests already in progress keep their steps.</p>
      <Button loading={pending} onClick={() => run(() => A.updateFinalApprovalAction(f))}>Save final approval</Button>
    </div>
  );
}
