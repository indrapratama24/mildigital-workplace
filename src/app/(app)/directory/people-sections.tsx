"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Cake, Eye, EyeOff, Landmark, Lock, Mail, MapPin, Pencil, Phone, ShieldAlert, Users2, IdCard, Briefcase, CalendarDays, HeartHandshake } from "lucide-react";
import type { Profile } from "@/server/services/people";
import { revealSensitiveAction, updatePersonalDataAction } from "@/server/actions/people";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice, Progress, Avatar } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";

const STATUS: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", PROBATION: "Probation", INTERN: "Intern" };
const MARITAL: Record<string, string> = { SINGLE: "Single", MARRIED: "Married", DIVORCED: "Divorced", WIDOWED: "Widowed" };

export function PeopleSections({ profile: p }: { profile: Profile }) {
  const [edit, setEdit] = useState(false);
  const x = p.personal;
  const showPersonal = [x.birthDate, x.birthPlace, x.addressKtp, x.addressDomicile, x.emergencyContact, x.personalEmail].some((v) => v !== undefined);
  const showHr = [x.nik, x.npwp, x.bank, x.maritalStatus].some((v) => v !== undefined);
  return (
    <div className="space-y-5">
      {(p.isSelf || p.canEditAll) && p.completeness !== null && p.completeness < 100 && (
        <Notice tone="info">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>
              Profile {p.completeness}% complete.{" "}
              {p.isSelf && !p.canEditAll ? "Add your phone, domicile and emergency contact; HR completes identity, bank and family details." : "Complete identity, bank and family details for payroll and tax."}
            </span>
            <Progress value={p.completeness} max={100} className="max-w-[200px]" />
          </div>
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="General" action={(p.isSelf || p.canEditAll) && <Button size="sm" variant="secondary" onClick={() => setEdit(true)}><Pencil className="h-3.5 w-3.5" /> Edit {p.isSelf && !p.canEditAll ? "my details" : "personal data"}</Button>} />
          <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Item icon={IdCard} label="Employee ID" value={p.code} />
            <Item icon={Users2} label="Team" value={p.teams.map((t) => t.name).join(", ") || null} />
            <Item icon={Briefcase} label="Level" value={p.level} />
            <Item icon={Users2} label="Leader" value={p.leaders.length ? p.leaders.map((l) => `${l.fullName}${l.type === "SECONDARY" ? " (secondary)" : ""}`).join(", ") : null} />
            {p.joinDate !== null && <Item icon={CalendarDays} label="Join date · tenure at MIL" value={`${formatDate(p.joinDate)} · ${p.tenure?.label}`} />}
            {p.employmentStatus !== null && <Item icon={Briefcase} label="Employment status" value={STATUS[p.employmentStatus]} />}
            {x.birthday !== undefined && <Item icon={Cake} label="Birthday" value={x.birthday} />}
            {p.email !== null && <Item icon={Mail} label="Work email" value={<a className="text-brand-700 hover:underline" href={`mailto:${p.email}`}>{p.email}</a>} />}
            {x.phone !== undefined && <Item icon={Phone} label="Phone" value={x.phone ? <a className="text-brand-700 hover:underline" href={`tel:${x.phone.replace(/\s/g, "")}`}>{x.phone}</a> : null} />}
            {p.department && <Item icon={Briefcase} label="Department" value={p.department} />}
            {p.roleDescription && (
              <div className="sm:col-span-2">
                <Item icon={Briefcase} label="Role description" value={<span className="whitespace-pre-line">{p.roleDescription}</span>} />
              </div>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Direct reports" description={p.directReports.length ? `${p.directReports.length} people` : undefined} />
          <CardBody className="space-y-2">
            {p.directReports.length === 0 && <p className="text-[13px] text-muted">No direct reports.</p>}
            {p.directReports.map((r) => (
              <Link key={r.id} href={`/directory/${r.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                <Avatar name={r.fullName} />
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">{r.fullName}</span>
                  <span className="block truncate text-[11.5px] text-muted">{r.jobTitle}</span>
                </span>
              </Link>
            ))}
          </CardBody>
        </Card>
      </div>

      {(showPersonal || showHr) && (
        <div className="grid gap-5 lg:grid-cols-2">
          {showPersonal && (
            <Card>
              <CardHeader title="Personal" description="Shown according to Directory privacy settings." />
              <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {x.birthDate !== undefined && <Item icon={Cake} label="Date of birth · age" value={x.birthDate ? `${formatDate(x.birthDate)}${x.age !== undefined ? ` · ${x.age} yrs` : ""}` : null} />}
                {x.birthPlace !== undefined && <Item icon={MapPin} label="Place of birth" value={x.birthPlace} />}
                {x.personalEmail !== undefined && <Item icon={Mail} label="Personal email" value={x.personalEmail} />}
                {x.addressKtp !== undefined && <Item icon={MapPin} label="Address (KTP)" value={x.addressKtp} wide />}
                {x.addressDomicile !== undefined && <Item icon={MapPin} label="Domicile address" value={x.addressDomicile} wide />}
                {x.emergencyContact !== undefined && (
                  <Item icon={ShieldAlert} label="Emergency contact" value={x.emergencyContact ? `${x.emergencyContact.name}${x.emergencyContact.relation ? ` (${x.emergencyContact.relation})` : ""} · ${x.emergencyContact.phone ?? "—"}` : null} wide />
                )}
              </CardBody>
            </Card>
          )}
          {showHr && (
            <Card>
              <CardHeader title="HR & payroll" description="Confidential. Identity and account numbers are encrypted; revealing them is logged." action={<Lock className="h-4 w-4 text-subtle" />} />
              <CardBody className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
                {x.nik !== undefined && <Sensitive label="NIK (KTP)" masked={x.nik} employeeId={p.id} field="nik" canReveal={p.canReveal} />}
                {x.npwp !== undefined && <Sensitive label="NPWP" masked={x.npwp} employeeId={p.id} field="npwp" canReveal={p.canReveal} />}
                {x.bank !== undefined && (
                  <>
                    <Item icon={Landmark} label="Bank" value={x.bank?.name ?? null} />
                    <Item icon={Landmark} label="Account holder" value={x.bank?.holder ?? null} />
                    <Sensitive label="Account number" masked={x.bank?.account ?? null} employeeId={p.id} field="bank" canReveal={p.canReveal} />
                  </>
                )}
                {x.maritalStatus !== undefined && (
                  <>
                    <Item icon={HeartHandshake} label="Marital status" value={x.maritalStatus ? MARITAL[x.maritalStatus] : null} />
                    <Item icon={Users2} label="Dependents (children)" value={String(x.dependents ?? 0)} />
                    <Item icon={Landmark} label="PTKP status (PPh 21)" value={x.ptkp ? <span className="font-semibold">{x.ptkp}</span> : null} />
                  </>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      )}
      {p.editable && <EditDialog open={edit} onOpenChange={setEdit} profile={p} />}
    </div>
  );
}

function Item({ icon: Icon, label, value, wide }: { icon: typeof Mail; label: string; value: React.ReactNode; wide?: boolean }) {
  return (
    <div className={`flex gap-2.5 ${wide ? "sm:col-span-2" : ""}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</div>
        <div className="break-words text-[14px] text-ink">{value ?? <span className="text-subtle">Not set</span>}</div>
      </div>
    </div>
  );
}

function Sensitive({ label, masked, employeeId, field, canReveal }: { label: string; masked: string | null; employeeId: string; field: "nik" | "npwp" | "bank"; canReveal: boolean }) {
  const [shown, setShown] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex gap-2.5">
      <IdCard className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
      <div className="min-w-0">
        <div className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</div>
        <div className="flex items-center gap-2 text-[14px] text-ink">
          <span className="font-mono tabular">{shown ?? masked ?? <span className="font-sans text-subtle">Not set</span>}</span>
          {masked && canReveal && (
            <button
              className="rounded-full p-1 text-muted hover:bg-brand-50 hover:text-brand-700 disabled:opacity-50"
              disabled={pending}
              aria-label={shown ? `Hide ${label}` : `Show ${label}`}
              onClick={() =>
                shown
                  ? setShown(null)
                  : start(async () => {
                      const r = await revealSensitiveAction(employeeId, field);
                      if (!r.ok) return void toast.error(r.error);
                      setShown(r.data!);
                      setTimeout(() => setShown(null), 30_000); // auto-hide
                    })
              }
            >
              {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function EditDialog({ open, onOpenChange, profile: p }: { open: boolean; onOpenChange: (o: boolean) => void; profile: Profile }) {
  const router = useRouter();
  const e = p.editable!;
  const hr = p.canEditAll;
  const [f, setF] = useState({ ...e, nik: "", npwp: "", bankAccountNumber: "" });
  const [pending, start] = useTransition();
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((s) => ({ ...s, [k]: v }));
  const save = () =>
    start(async () => {
      const selfFields = {
        phone: f.phone || null,
        personalEmail: f.personalEmail || null,
        addressDomicile: f.addressDomicile || null,
        emergencyContactName: f.emergencyContactName || null,
        emergencyContactRelation: f.emergencyContactRelation || null,
        emergencyContactPhone: f.emergencyContactPhone || null,
      };
      const payload = hr
        ? {
            ...selfFields,
            ...(f.joinDate && f.joinDate !== e.joinDate ? { joinDate: f.joinDate } : {}),
            birthDate: f.birthDate || null,
            birthPlace: f.birthPlace || null,
            addressKtp: f.addressKtp || null,
            bankName: f.bankName || null,
            bankAccountHolder: f.bankAccountHolder || null,
            maritalStatus: f.maritalStatus || null,
            dependents: Number(f.dependents) || 0,
            // sensitive numbers are only sent when (re)entered
            ...(f.nik ? { nik: f.nik } : {}),
            ...(f.npwp ? { npwp: f.npwp } : {}),
            ...(f.bankAccountNumber ? { bankAccountNumber: f.bankAccountNumber } : {}),
          }
        : selfFields;
      const r = await updatePersonalDataAction(p.id, payload);
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      onOpenChange(false);
      router.refresh();
    });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={hr ? `Personal data · ${p.name}` : "My details"}
      description={hr ? "Changes are audit-logged. Identity and bank numbers are encrypted." : "You can update your contact details. Identity, bank, family and birth details are maintained by HR."}
      className="sm:max-w-2xl"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button loading={pending} onClick={save}>Save</Button>
        </>
      }
    >
      <div className="space-y-5">
        {hr && (
          <Section title="Employment (HR)">
              <Field label="Join date" hint="Start of employment at MIL. Used for tenure; the employee's first level, team and leader records move with it.">
                <Input type="date" value={f.joinDate} onChange={(ev) => set("joinDate", ev.target.value)} />
              </Field>
            </Section>
        )}
        <Section title="Contact">
          <Field label="Phone"><Input value={f.phone} onChange={(ev) => set("phone", ev.target.value)} placeholder="+62 812-3456-7890" /></Field>
          <Field label="Personal email"><Input type="email" value={f.personalEmail} onChange={(ev) => set("personalEmail", ev.target.value)} /></Field>
          <Field label="Domicile address" className="sm:col-span-2"><Textarea value={f.addressDomicile} onChange={(ev) => set("addressDomicile", ev.target.value)} className="min-h-[60px]" /></Field>
        </Section>
        <Section title="Emergency contact">
          <Field label="Name"><Input value={f.emergencyContactName} onChange={(ev) => set("emergencyContactName", ev.target.value)} /></Field>
          <Field label="Relationship"><Input value={f.emergencyContactRelation} onChange={(ev) => set("emergencyContactRelation", ev.target.value)} placeholder="e.g. Spouse, Parent" /></Field>
          <Field label="Phone"><Input value={f.emergencyContactPhone} onChange={(ev) => set("emergencyContactPhone", ev.target.value)} /></Field>
        </Section>
        {hr && (
          <>
            <Section title="Personal (HR)">
              <Field label="Date of birth"><Input type="date" value={f.birthDate} onChange={(ev) => set("birthDate", ev.target.value)} /></Field>
              <Field label="Place of birth"><Input value={f.birthPlace} onChange={(ev) => set("birthPlace", ev.target.value)} /></Field>
              <Field label="Address (KTP)" className="sm:col-span-2"><Textarea value={f.addressKtp} onChange={(ev) => set("addressKtp", ev.target.value)} className="min-h-[60px]" /></Field>
            </Section>
            <Section title="Identity & tax">
              <Field label="NIK (16 digits)" hint={e.hasNik ? "Stored (encrypted). Leave empty to keep it; type to replace." : undefined}><Input inputMode="numeric" value={f.nik} onChange={(ev) => set("nik", ev.target.value)} placeholder={e.hasNik ? "•••• keep current" : "3171…"} autoComplete="off" /></Field>
              <Field label="NPWP" hint={e.hasNpwp ? "Stored (encrypted). Leave empty to keep it." : "15 or 16 digits"}><Input inputMode="numeric" value={f.npwp} onChange={(ev) => set("npwp", ev.target.value)} placeholder={e.hasNpwp ? "•••• keep current" : ""} autoComplete="off" /></Field>
              <Field label="Marital status">
                <Select value={f.maritalStatus} onChange={(ev) => set("maritalStatus", ev.target.value as typeof f.maritalStatus)}>
                  <option value="">Not set</option>
                  {Object.entries(MARITAL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </Field>
              <Field label="Dependents (children)" hint="Max 3 count for PTKP."><Input type="number" min={0} max={10} value={f.dependents} onChange={(ev) => set("dependents", Number(ev.target.value))} /></Field>
            </Section>
            <Section title="Bank account (salary)">
              <Field label="Bank"><Input value={f.bankName} onChange={(ev) => set("bankName", ev.target.value)} placeholder="e.g. BCA" /></Field>
              <Field label="Account holder"><Input value={f.bankAccountHolder} onChange={(ev) => set("bankAccountHolder", ev.target.value)} /></Field>
              <Field label="Account number" hint={e.hasBankAccount ? "Stored (encrypted). Leave empty to keep it." : undefined}><Input inputMode="numeric" value={f.bankAccountNumber} onChange={(ev) => set("bankAccountNumber", ev.target.value)} placeholder={e.hasBankAccount ? "•••• keep current" : ""} autoComplete="off" /></Field>
            </Section>
          </>
        )}
      </div>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}
