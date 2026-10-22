"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";
import { createClientAction, updateClientAction } from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { collaborationPeriod, MAX_ADS_STRATEGISTS, validateTeam, type ClientStatusT } from "@/lib/engine/clients";
import { formatDate } from "@/lib/dates";
import type { ClientFormValues, TaxonomyOptions } from "./form-values";

type Person = { id: string; fullName: string; jobTitle: string };
type Pkg = { id: string; name: string; isActive: boolean };

export function ClientForm({
  mode,
  clientId,
  initial,
  packages,
  people,
  today,
  requirePrimary,
  canChangeCode,
  canEditSensitive,
  statusFrom,
  taxonomy,
}: {
  mode: "create" | "edit";
  clientId?: string;
  initial: ClientFormValues;
  packages: Pkg[];
  people: Person[];
  today: string;
  requirePrimary: boolean;
  canChangeCode: boolean;
  canEditSensitive: boolean;
  /** Start of the current status period (edit mode) — status changes must be after it. */
  statusFrom?: string;
  taxonomy: TaxonomyOptions;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [statusChange, setStatusChange] = useState({ effectiveDate: today, reason: "" });
  const [teamFrom, setTeamFrom] = useState(today);
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const saved = useRef(false);
  const set = <K extends keyof ClientFormValues>(k: K, v: ClientFormValues[K]) => setF((p) => ({ ...p, [k]: v }));
  const [newAd, setNewAd] = useState("");
  const industryOptions = taxonomy.industries.filter((i) => (f.categoryId ? i.categoryId === f.categoryId : true));
  const currentIndustry = industryOptions.find((i) => i.name.toLowerCase() === f.industryName.trim().toLowerCase());
  const subOptions = currentIndustry?.subIndustries ?? [];
  const adOptions = [...new Map([...taxonomy.adAccounts.filter((a) => a.isActive).map((a) => a.name), ...f.adAccounts].map((n) => [n.toLowerCase(), n])).values()];
  const addAd = () => {
    const n = newAd.trim();
    if (n && !f.adAccounts.some((a) => a.toLowerCase() === n.toLowerCase())) set("adAccounts", [...f.adAccounts, n]);
    setNewAd("");
  };
  const dirty = JSON.stringify(f) !== JSON.stringify(initial);
  const teamOf = (v: ClientFormValues) => JSON.stringify([v.primary, v.secondary, [...v.additional].filter(Boolean).sort(), [...v.adsStrategists].sort()]);
  const teamChanged = mode === "edit" && teamOf(f) !== teamOf(initial);
  const statusChanged = mode === "edit" && f.status !== initial.status;

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty && !saved.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const team = { primary: f.primary || null, secondary: f.secondary || null, additional: f.additional.filter(Boolean), adsStrategists: f.adsStrategists };
  const teamErrors = validateTeam(team, { status: f.status, requirePrimary, waived: f.waivePrimary });
  const errors: string[] = [];
  if (f.name.trim().length < 2) errors.push("Brand name is required.");
  if (!f.dateStart) errors.push("Date START is required.");
  if (!f.packageId) errors.push("Choose a package.");
  if (f.status === "INACTIVE" && (mode === "create" || statusChanged) && !f.dateOff) errors.push("Date OFF is required for inactive clients.");
  if (f.dateOff && f.dateStart && f.dateOff < f.dateStart) errors.push("Date OFF can't be earlier than Date START.");
  if (f.waivePrimary && !f.waiverReason.trim()) errors.push("Give a reason for the Consultant 1 exception.");
  errors.push(...teamErrors);

  const period = useMemo(() => {
    if (!f.dateStart) return null;
    const off = f.status === "INACTIVE" ? f.dateOff || null : null;
    return collaborationPeriod({ status: f.status, dateStart: f.dateStart, dateOff: off, history: [{ status: "ACTIVE", from: f.dateStart, to: off }] }, today);
  }, [f.dateStart, f.dateOff, f.status, today]);

  const taken = new Set([f.primary, f.secondary, ...f.additional, ...f.adsStrategists].filter(Boolean));
  const options = (keep: string) => people.filter((p) => p.id === keep || !taken.has(p.id));

  const submit = () =>
    start(async () => {
      const payload = {
        name: f.name,
        organizationName: f.organizationName || null,
        dateStart: f.dateStart,
        packageId: f.packageId,
        team,
        waivePrimary: f.waivePrimary,
        waiverReason: f.waiverReason || null,
        categoryId: f.categoryId || null,
        industryName: f.industryName.trim() || null,
        subIndustryName: f.subIndustryName.trim() || null,
        adAccounts: f.adAccounts,
        description: f.description || null,
        websiteUrl: f.websiteUrl || null,
        instagramUrl: f.instagramUrl || null,
        tiktokUrl: f.tiktokUrl || null,
        ...(canEditSensitive ? { picName: f.picName || null, picPhone: f.picPhone || null, picEmail: f.picEmail || null, internalNotes: f.internalNotes || null } : {}),
      };
      const r =
        mode === "create"
          ? await createClientAction({ ...payload, clientCode: f.clientCode || null, status: f.status, dateOff: f.dateOff || null, statusEffectiveDate: f.status === "FREEZE" ? statusChange.effectiveDate : null })
          : await updateClientAction(clientId!, {
              ...payload,
              clientCode: f.clientCode,
              teamEffectiveDate: teamChanged ? teamFrom : null,
              status: statusChanged
                ? { status: f.status, effectiveDate: f.status === "INACTIVE" ? null : statusChange.effectiveDate, dateOff: f.status === "INACTIVE" ? f.dateOff : null, reason: statusChange.reason || null }
                : null,
            });
      if (!r.ok) return void toast.error(r.error);
      saved.current = true;
      toast.success(r.message ?? "Saved");
      const id = mode === "create" ? (r.data as { id: string }).id : clientId!;
      router.push(`/clients/${id}`);
      router.refresh();
    });

  const onSave = () => (statusChanged || (mode === "edit" && f.clientCode !== initial.clientCode) ? setConfirm(true) : submit());

  return (
    <div className="space-y-5 pb-24">
      <Card>
        <CardHeader title="A. Brand information" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name" required>
            <Input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Kopi Senja" maxLength={120} />
          </Field>
          <Field
            label="Client ID"
            hint={mode === "create" ? "Leave empty to auto-generate (MIL-CL-0001, …). IDs are unique and never reused." : canChangeCode ? "Changing it retires the old ID permanently." : "Only administrators can change a Client ID."}
          >
            <Input value={f.clientCode} onChange={(e) => set("clientCode", e.target.value.toUpperCase())} placeholder="Auto" disabled={mode === "edit" && !canChangeCode} maxLength={30} />
          </Field>
          <Field label="Client organization (optional)" hint="Legal/business client that owns this brand. Brands of the same owner share it.">
            <Input value={f.organizationName} onChange={(e) => set("organizationName", e.target.value)} placeholder="e.g. PT Bumi Berkah Boga" />
          </Field>
          <Field label="Category">
            <Select value={f.categoryId} onChange={(e) => setF((p) => ({ ...p, categoryId: e.target.value, industryName: "", subIndustryName: "" }))}>
              <option value="">— Choose category —</option>
              {taxonomy.categories.filter((c) => c.isActive || c.id === initial.categoryId).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Industry" hint="Pick one or type a new one — it's saved for other brands.">
            <Input value={f.industryName} onChange={(e) => setF((p) => ({ ...p, industryName: e.target.value, subIndustryName: p.industryName === e.target.value ? p.subIndustryName : "" }))} list="client-industries" placeholder={f.categoryId ? "e.g. Apparel" : "Choose a category first"} disabled={!f.categoryId && !f.industryName} maxLength={80} />
            <datalist id="client-industries">{industryOptions.map((i) => <option key={i.id} value={i.name} />)}</datalist>
          </Field>
          <Field label="Sub-industry" hint="e.g. Women's apparel, Hijab. New values are saved for reuse.">
            <Input value={f.subIndustryName} onChange={(e) => set("subIndustryName", e.target.value)} list="client-subindustries" placeholder={f.industryName ? "e.g. Hijab" : "Choose an industry first"} disabled={!f.industryName.trim()} maxLength={80} />
            <datalist id="client-subindustries">{subOptions.map((x) => <option key={x.id} value={x.name} />)}</datalist>
          </Field>
          <Field label="Brand description" className="sm:col-span-2">
            <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} className="min-h-[70px]" />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="B. Collaboration details" description="Period is calculated automatically from Date START and status history." />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Status" required>
            <Select value={f.status} onChange={(e) => set("status", e.target.value as ClientStatusT)}>
              <option value="ACTIVE">Active</option>
              <option value="FREEZE" disabled={mode === "edit" && initial.status === "INACTIVE"}>Freeze</option>
              <option value="INACTIVE">Inactive</option>
            </Select>
          </Field>
          <Field label="Date START" required hint="First day of collaboration. Reactivation never changes it.">
            <Input type="date" value={f.dateStart} onChange={(e) => set("dateStart", e.target.value)} max={today} />
          </Field>
          {f.status === "INACTIVE" && (mode === "create" || statusChanged || initial.status === "INACTIVE") ? (
            <Field label="Date OFF" required hint="Last day of collaboration">
              <Input type="date" value={f.dateOff} onChange={(e) => set("dateOff", e.target.value)} min={f.dateStart || undefined} max={today} disabled={mode === "edit" && !statusChanged} />
            </Field>
          ) : (
            <Field label="Period">
              <div className="flex h-10 items-center rounded-xl border border-line-2 bg-canvas px-3 text-[14px] font-medium text-ink">{period?.label ?? "—"}</div>
            </Field>
          )}
          {f.status === "INACTIVE" && (mode === "create" || statusChanged || initial.status === "INACTIVE") && (
            <Field label="Period">
              <div className="flex h-10 items-center rounded-xl border border-line-2 bg-canvas px-3 text-[14px] font-medium text-ink">{period?.label ?? "—"}</div>
            </Field>
          )}
          {((mode === "create" && f.status === "FREEZE") || (statusChanged && f.status !== "INACTIVE")) && (
            <Field label={f.status === "FREEZE" ? "Freeze effective from" : "Reactivation date"} hint={statusFrom ? `After ${formatDate(statusFrom)}` : undefined}>
              <Input type="date" value={statusChange.effectiveDate} onChange={(e) => setStatusChange((s) => ({ ...s, effectiveDate: e.target.value }))} max={today} />
            </Field>
          )}
          {statusChanged && (
            <Field label="Reason for status change" className="sm:col-span-2">
              <Input value={statusChange.reason} onChange={(e) => setStatusChange((s) => ({ ...s, reason: e.target.value }))} placeholder="Optional" />
            </Field>
          )}
          {statusChanged && (
            <Notice tone="info" className="sm:col-span-3">
              Status changes are effective-dated: {initial.status.toLowerCase()} → {f.status.toLowerCase()} is added to the history and past monthly counts stay as they were.
            </Notice>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="C. Package & ad accounts" description="Options come from Settings → Packages & client rules." />
        <CardBody className="space-y-5">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Package">
            {packages.filter((p) => p.isActive || p.id === initial.packageId).map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={f.packageId === p.id}
                onClick={() => set("packageId", p.id)}
                className={`rounded-xl border px-4 py-2 text-[14px] font-medium ${f.packageId === p.id ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-2 hover:border-brand-300"}`}
              >
                {p.name}
                {!p.isActive && " (archived)"}
              </button>
            ))}
            {packages.length === 0 && <p className="text-[13px] text-muted">No packages configured yet.</p>}
          </div>
          <div>
            <div className="mb-2 text-[13px] font-medium text-ink-2">Ad accounts handled</div>
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Ad accounts handled">
              {adOptions.map((name) => {
                const on = f.adAccounts.some((a) => a.toLowerCase() === name.toLowerCase());
                return (
                  <button
                    key={name}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set("adAccounts", on ? f.adAccounts.filter((a) => a.toLowerCase() !== name.toLowerCase()) : [...f.adAccounts, name])}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium ${on ? "border-brand-700 bg-brand-50 text-brand-700" : "border-line bg-white text-ink-2 hover:border-brand-300"}`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />} {name}
                  </button>
                );
              })}
              <span className="inline-flex items-center gap-1">
                <Input value={newAd} onChange={(e) => setNewAd(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addAd())} placeholder="Other ad account…" className="h-8 w-[180px] text-[13px]" maxLength={60} />
                <Button size="sm" variant="secondary" disabled={!newAd.trim()} onClick={addAd}><Plus className="h-3.5 w-3.5" /> Add</Button>
              </span>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="D. Assigned team" description="People come from the Team Directory. Changes are kept in the assignment history." />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Consultant 1 (Primary)" required={f.status === "ACTIVE" && requirePrimary && !f.waivePrimary}>
            <PersonSelect value={f.primary} onChange={(v) => set("primary", v)} people={options(f.primary)} />
          </Field>
          <Field label="Consultant 2 (Secondary)">
            <PersonSelect value={f.secondary} onChange={(v) => set("secondary", v)} people={options(f.secondary)} />
          </Field>
          <Field label="Additional consultants" className="sm:col-span-2">
            <div className="space-y-2">
              {f.additional.map((id, i) => (
                <div key={i} className="flex gap-2">
                  <PersonSelect value={id} onChange={(v) => set("additional", f.additional.map((x, j) => (j === i ? v : x)))} people={options(id)} />
                  <Button variant="ghost" size="sm" onClick={() => set("additional", f.additional.filter((_, j) => j !== i))} aria-label="Remove consultant">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set("additional", [...f.additional, ""])}>
                <Plus className="h-3.5 w-3.5" /> Add consultant
              </Button>
            </div>
          </Field>
          <Field label={`Ads Strategists (${f.adsStrategists.length}/${MAX_ADS_STRATEGISTS})`} className="sm:col-span-2">
            <div className="flex flex-wrap items-center gap-2">
              {f.adsStrategists.map((id) => (
                <Badge key={id} tone="brand" className="gap-1 py-1 pl-2.5 pr-1">
                  {people.find((p) => p.id === id)?.fullName ?? "Unknown"}
                  <button type="button" onClick={() => set("adsStrategists", f.adsStrategists.filter((x) => x !== id))} className="rounded-full p-0.5 hover:bg-brand-100" aria-label="Remove Ads Strategist">
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
              {f.adsStrategists.length < MAX_ADS_STRATEGISTS && (
                <Select value="" onChange={(e) => e.target.value && set("adsStrategists", [...f.adsStrategists, e.target.value])} className="h-9 w-auto min-w-[220px]" aria-label="Add Ads Strategist">
                  <option value="">+ Add Ads Strategist…</option>
                  {options("").map((p) => <option key={p.id} value={p.id}>{p.fullName} — {p.jobTitle}</option>)}
                </Select>
              )}
            </div>
          </Field>
          {teamChanged && (
            <div className="rounded-xl border border-brand-200 bg-brand-50/50 p-3 sm:col-span-2">
              <Field label="Team change effective from" hint="New or changed people start on this date; removed people end the day before. Use a past date to record a change that already happened.">
                <Input type="date" value={teamFrom} max={today} min={f.dateStart || undefined} onChange={(e) => setTeamFrom(e.target.value)} className="max-w-[220px]" />
              </Field>
            </div>
          )}
          {f.status === "ACTIVE" && requirePrimary && (
            <div className="space-y-2 sm:col-span-2">
              <Checkbox checked={f.waivePrimary} onChange={(e) => set("waivePrimary", e.target.checked)} label="Exception: active without Consultant 1" description="Recorded with your name in the audit log." />
              {f.waivePrimary && <Input value={f.waiverReason} onChange={(e) => set("waiverReason", e.target.value)} placeholder="Reason for the exception" />}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="E. Additional information" description={canEditSensitive ? "PIC contact and internal notes are visible only to client managers and the assigned team." : "PIC contact and internal notes are restricted."} />
        <CardBody className="grid gap-4 sm:grid-cols-3">
          <Field label="Website URL"><Input value={f.websiteUrl} onChange={(e) => set("websiteUrl", e.target.value)} placeholder="https://" /></Field>
          <Field label="Instagram URL"><Input value={f.instagramUrl} onChange={(e) => set("instagramUrl", e.target.value)} placeholder="https://instagram.com/…" /></Field>
          <Field label="TikTok URL"><Input value={f.tiktokUrl} onChange={(e) => set("tiktokUrl", e.target.value)} placeholder="https://tiktok.com/@…" /></Field>
          {canEditSensitive && (
            <>
              <Field label="Client PIC name"><Input value={f.picName} onChange={(e) => set("picName", e.target.value)} /></Field>
              <Field label="Client PIC phone"><Input type="tel" value={f.picPhone} onChange={(e) => set("picPhone", e.target.value)} placeholder="+62 812-0000-0000" /></Field>
              <Field label="Client PIC email"><Input type="email" value={f.picEmail} onChange={(e) => set("picEmail", e.target.value)} placeholder="name@company.com" /></Field>
              <Field label="Internal notes" className="sm:col-span-3"><Textarea value={f.internalNotes} onChange={(e) => set("internalNotes", e.target.value)} className="min-h-[80px]" /></Field>
            </>
          )}
        </CardBody>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 backdrop-blur lg:left-[264px] lg:group-data-[sidebar=collapsed]/frame:left-[76px]">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <div className="min-w-0 text-[12.5px]">
            {errors.length ? <span className="text-danger">{errors[0]}{errors.length > 1 && ` (+${errors.length - 1} more)`}</span> : dirty ? <span className="text-muted">Unsaved changes</span> : <span className="text-subtle">No changes</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => (!dirty || confirmLeave() ? router.back() : undefined)}>Cancel</Button>
            <Button loading={pending} disabled={errors.length > 0 || (mode === "edit" && !dirty)} onClick={onSave}>
              {mode === "create" ? "Save client" : "Save changes"}
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Confirm changes"
        description={[
          statusChanged && `Status: ${initial.status.toLowerCase()} → ${f.status.toLowerCase()}${f.status === "INACTIVE" ? ` (Date OFF ${f.dateOff})` : ` from ${statusChange.effectiveDate}`}.`,
          f.clientCode !== initial.clientCode && `Client ID: ${initial.clientCode} → ${f.clientCode}. The old ID is retired permanently.`,
        ]
          .filter(Boolean)
          .join(" ")}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Back</Button>
            <Button loading={pending} onClick={() => { setConfirm(false); submit(); }}>Confirm & save</Button>
          </>
        }
      />
    </div>
  );
}

function confirmLeave() {
  return window.confirm("Discard unsaved changes?");
}

function PersonSelect({ value, onChange, people }: { value: string; onChange: (v: string) => void; people: Person[] }) {
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— None —</option>
      {people.map((p) => <option key={p.id} value={p.id}>{p.fullName} — {p.jobTitle}</option>)}
    </Select>
  );
}
