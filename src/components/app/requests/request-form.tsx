"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarClock, FileUp, Paperclip, Plus, Trash2, X, Users2, Info, ArrowRight } from "lucide-react";
import { previewRequestAction, saveRequestDraftAction, submitRequestAction, uploadAction } from "@/server/actions/requests";
import { Button, buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { addDays, formatDate, formatMonth } from "@/lib/dates";
import type { computeRequestImpact } from "@/server/services/requests";
import { cn } from "@/lib/cn";

export interface RequestTypeDTO {
  id: string;
  code: string;
  name: string;
  category: "LEAVE" | "PERMISSION" | "OFFSITE" | "ADDITIONAL_WFH" | "SCHEDULE_CHANGE";
  description: string | null;
  documentRequirement: "NONE" | "OPTIONAL" | "REQUIRED";
  delegation: "NONE" | "OPTIONAL" | "REQUIRED";
  reasonMinLength: number;
  advanceNoticeDays: number;
  allowHalfDay: boolean;
  allowHourly: boolean;
  deductsBalance: boolean;
  isSensitive: boolean;
}

export interface RequestFormInitial {
  id?: string;
  requestTypeId: string;
  startDate: string;
  endDate: string;
  durationType: "FULL_DAY" | "HALF_DAY_AM" | "HALF_DAY_PM" | "HOURLY";
  startTime: string;
  endTime: string;
  reason: string;
  document: { id: string; name: string } | null;
  /** Peer delegates. Empty coverage dates mean "same as the request dates". */
  delegations: DelegateEntry[];
}

export interface DelegateEntry {
  delegateId: string;
  handoverNotes: string;
  tasks: { task: string; deadline?: string }[];
  coverageStart: string;
  coverageEnd: string;
  attachment: { id: string; name: string } | null;
  /** status from a previous submission, e.g. DECLINED (shown as a hint) */
  previousStatus?: string;
}

const MAX_DELEGATES = 5;
const emptyDelegate = (): DelegateEntry => ({ delegateId: "", handoverNotes: "", tasks: [{ task: "" }], coverageStart: "", coverageEnd: "", attachment: null });

type Impact = NonNullable<Awaited<ReturnType<typeof computeRequestImpact>>>;

const CATEGORY_LABEL: Record<RequestTypeDTO["category"], string> = { LEAVE: "Leave", PERMISSION: "Permission", OFFSITE: "Offsite", ADDITIONAL_WFH: "Schedule", SCHEDULE_CHANGE: "Schedule" };

export function RequestForm({ types, colleagues, initial, employeeName, today }: { types: RequestTypeDTO[]; colleagues: { id: string; fullName: string; team: string | null }[]; initial: RequestFormInitial; employeeName: string; today: string }) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [delegationOn, setDelegationOn] = useState(initial.delegations.length > 0);
  const [impact, setImpact] = useState<Impact | null>(null);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idemKey = useRef(crypto.randomUUID());
  const type = types.find((t) => t.id === f.requestTypeId);
  const isSchedule = type?.category === "ADDITIONAL_WFH" || type?.category === "SCHEDULE_CHANGE";
  const singleDay = f.durationType !== "FULL_DAY";
  const set = <K extends keyof RequestFormInitial>(k: K, v: RequestFormInitial[K]) => setF((p) => ({ ...p, [k]: v }));
  const delegations = f.delegations.length ? f.delegations : [emptyDelegate()];
  const setD = (i: number, patch: Partial<DelegateEntry>) => setF((p) => {
    const list = p.delegations.length ? [...p.delegations] : [emptyDelegate()];
    list[i] = { ...list[i], ...patch };
    return { ...p, delegations: list };
  });
  const addDelegate = () => setF((p) => ({ ...p, delegations: [...(p.delegations.length ? p.delegations : [emptyDelegate()]), emptyDelegate()] }));
  const removeDelegate = (i: number) => setF((p) => ({ ...p, delegations: p.delegations.filter((_, j) => j !== i) }));

  // keep type-dependent fields consistent
  useEffect(() => {
    if (!type) return;
    if (type.delegation === "REQUIRED") setDelegationOn(true);
    if (type.delegation === "NONE") setDelegationOn(false);
    if (f.durationType === "HOURLY" && !type.allowHourly) set("durationType", "FULL_DAY");
    if ((f.durationType === "HALF_DAY_AM" || f.durationType === "HALF_DAY_PM") && !type.allowHalfDay) set("durationType", "FULL_DAY");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type?.id]);
  useEffect(() => {
    if (singleDay && f.endDate !== f.startDate) set("endDate", f.startDate);
    if (f.endDate < f.startDate) set("endDate", f.startDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.startDate, f.durationType]);

  const payload = useMemo(
    () => ({
      id: f.id,
      requestTypeId: f.requestTypeId,
      startDate: f.startDate,
      endDate: singleDay ? f.startDate : f.endDate,
      durationType: f.durationType,
      startTime: f.durationType === "HOURLY" ? f.startTime : null,
      endTime: f.durationType === "HOURLY" ? f.endTime : null,
      reason: f.reason,
      documentId: f.document?.id ?? null,
      delegations: delegationOn
        ? delegations.map((d) => ({
            delegateId: d.delegateId,
            handoverNotes: d.handoverNotes,
            tasks: d.tasks.filter((t) => t.task.trim()),
            coverageStart: d.coverageStart || f.startDate,
            coverageEnd: d.coverageEnd || (singleDay ? f.startDate : f.endDate),
            attachmentId: d.attachment?.id ?? null,
          }))
        : [],
      idempotencyKey: idemKey.current,
    }),
    [f, delegationOn, delegations, singleDay],
  );

  // Impact preview depends only on type, dates and duration (not on delegation or reason).
  const previewKey = `${f.id ?? ""}|${f.requestTypeId}|${payload.startDate}|${payload.endDate}|${f.durationType}|${payload.startTime ?? ""}|${payload.endTime ?? ""}`;
  useEffect(() => {
    if (!type || isSchedule || !payload.startDate || !payload.endDate) return;
    const t = setTimeout(async () => {
      const r = await previewRequestAction({ id: f.id, requestTypeId: f.requestTypeId, startDate: payload.startDate, endDate: payload.endDate, durationType: f.durationType, startTime: payload.startTime, endTime: payload.endTime });
      if (r.ok) setImpact(r.data ?? null);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewKey, isSchedule]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!type) e.type = "Choose a request type.";
    if (!f.startDate) e.startDate = "Choose a start date.";
    if (type && f.reason.trim().length < type.reasonMinLength) e.reason = `At least ${type.reasonMinLength} characters (${f.reason.trim().length}/${type.reasonMinLength}).`;
    if (type?.documentRequirement === "REQUIRED" && !f.document) e.document = "A supporting document is required for this request type.";
    if (f.durationType === "HOURLY" && (!f.startTime || !f.endTime || f.endTime <= f.startTime)) e.time = "Enter a valid time range.";
    if (delegationOn) {
      const seen = new Set<string>();
      delegations.forEach((d, i) => {
        if (!d.delegateId) e[`delegate-${i}`] = "Choose a delegate.";
        else if (seen.has(d.delegateId)) e[`delegate-${i}`] = "This colleague is already added.";
        seen.add(d.delegateId);
        if (d.handoverNotes.trim().length < 10) e[`handover-${i}`] = "Handover notes must be at least 10 characters.";
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = (asDraft: boolean) =>
    start(async () => {
      if (!asDraft && !validate()) return void toast.error("Please fix the highlighted fields.");
      const r = asDraft ? await saveRequestDraftAction(payload) : await submitRequestAction(payload);
      if (!r.ok) return void toast.error(r.error);
      toast.success(asDraft ? "Draft saved" : payload.delegations.length ? `Submitted — waiting for ${payload.delegations.length > 1 ? `${payload.delegations.length} delegates` : "your delegate"} to accept.` : "Submitted to your leader.");
      router.push(`/requests/${r.data!.id}`);
      router.refresh();
    });

  const grouped = (["LEAVE", "PERMISSION", "OFFSITE", "ADDITIONAL_WFH"] as const).map((c) => ({ c, items: types.filter((t) => (c === "ADDITIONAL_WFH" ? t.category === "ADDITIONAL_WFH" || t.category === "SCHEDULE_CHANGE" : t.category === c)) }));

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Request details" description={`Employee: ${employeeName}`} />
          <CardBody className="space-y-4">
            <Field label="Request type" required error={errors.type} htmlFor="type">
              <Select
                id="type"
                value={f.requestTypeId}
                onChange={(e) => {
                  const t = types.find((x) => x.id === e.target.value);
                  // new requests start no earlier than the type's notice period allows
                  const earliest = t && t.advanceNoticeDays > 0 ? addDays(today, t.advanceNoticeDays) : null;
                  setF((p) => (!p.id && earliest && p.startDate < earliest ? { ...p, requestTypeId: e.target.value, startDate: earliest, endDate: p.endDate < earliest ? earliest : p.endDate } : { ...p, requestTypeId: e.target.value }));
                }}
              >
                <option value="">Choose…</option>
                {grouped.map((g) =>
                  g.items.length ? (
                    <optgroup key={g.c} label={CATEGORY_LABEL[g.c]}>
                      {g.items.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </optgroup>
                  ) : null,
                )}
              </Select>
            </Field>
            {type?.description && (
              <p className="-mt-2 flex gap-1.5 text-[12.5px] text-muted">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {type.description}
              </p>
            )}

            {isSchedule ? (
              <Notice tone="info" title="Schedule changes are made on your calendar">
                <p className="mb-2">Open your approved plan, select the date(s) to change, then choose <b>Request revision</b>. You&apos;ll see the WFO impact and suggested replacement days before submitting.</p>
                <Link href="/calendar" className={buttonClass("primary", "sm")}>
                  Go to my calendar <ArrowRight className="h-4 w-4" />
                </Link>
              </Notice>
            ) : (
              type && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Duration" required>
                      <Select value={f.durationType} onChange={(e) => set("durationType", e.target.value as RequestFormInitial["durationType"])}>
                        <option value="FULL_DAY">Full day(s)</option>
                        {type.allowHalfDay && <option value="HALF_DAY_AM">Half day — morning</option>}
                        {type.allowHalfDay && <option value="HALF_DAY_PM">Half day — afternoon</option>}
                        {type.allowHourly && <option value="HOURLY">Hourly permission</option>}
                      </Select>
                    </Field>
                    <div className="hidden sm:block" />
                    <Field label={singleDay ? "Date" : "Start date"} required error={errors.startDate}>
                      <Input type="date" value={f.startDate} min={type.advanceNoticeDays > 0 ? addDays(today, type.advanceNoticeDays) : undefined} onChange={(e) => set("startDate", e.target.value)} />
                    </Field>
                    {!singleDay && (
                      <Field label="End date" required>
                        <Input type="date" value={f.endDate} min={f.startDate} onChange={(e) => set("endDate", e.target.value)} />
                      </Field>
                    )}
                    {f.durationType === "HOURLY" && (
                      <Field label="Time range" required error={errors.time}>
                        <div className="flex items-center gap-2">
                          <Input type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} aria-label="From" />
                          <span className="text-muted">–</span>
                          <Input type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} aria-label="Until" />
                        </div>
                      </Field>
                    )}
                  </div>
                  <Field label="Reason" required error={errors.reason} hint={`Minimum ${type.reasonMinLength} characters.${type.isSensitive ? " Visible only to your approvers and HR — never to your delegate." : ""}`}>
                    <Textarea value={f.reason} onChange={(e) => set("reason", e.target.value)} maxLength={2000} />
                  </Field>
                  {type.documentRequirement !== "NONE" && (
                    <Field label={`Supporting document${type.documentRequirement === "REQUIRED" ? "" : " (optional)"}`} required={type.documentRequirement === "REQUIRED"} error={errors.document} hint="PDF, PNG, JPEG or WEBP · max 5 MB · stored privately.">
                      <Upload value={f.document} onChange={(d) => set("document", d)} sensitive={type.isSensitive} />
                    </Field>
                  )}
                </>
              )
            )}
          </CardBody>
        </Card>

        {type && !isSchedule && type.delegation !== "NONE" && (
          <Card>
            <CardHeader
              title="Delegation"
              description="Your delegate(s) confirm they'll cover your work (layer 1). Then your leader approves the request (layer 2). You can add several delegates."
              action={type.delegation === "REQUIRED" ? <span className="rounded-full bg-brand-50 px-2.5 py-1 text-[12px] font-medium text-brand-700">Required for {type.name}</span> : null}
            />
            <CardBody className="space-y-4">
              {type.delegation === "OPTIONAL" && <Checkbox checked={delegationOn} onChange={(e) => setDelegationOn(e.target.checked)} label="Delegation required" description="Untick to skip the peer step and go straight to your leader." />}
              {delegationOn && (
                <div className="space-y-4">
                  {delegations.map((d, i) => {
                    const taken = new Set(delegations.filter((_, j) => j !== i).map((x) => x.delegateId));
                    return (
                      <div key={i} className={cn("space-y-4", delegations.length > 1 && "rounded-2xl border border-line-2 bg-canvas/40 p-4")}>
                        {delegations.length > 1 && (
                          <div className="flex items-center justify-between">
                            <span className="text-[13px] font-semibold text-ink">Delegate {i + 1}</span>
                            <Button variant="ghost" size="sm" onClick={() => removeDelegate(i)} aria-label={`Remove delegate ${i + 1}`}>
                              <X className="h-4 w-4" /> Remove
                            </Button>
                          </div>
                        )}
                        {d.previousStatus === "DECLINED" && <Notice tone="warning">This colleague declined last time — choose someone else or remove this entry.</Notice>}
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Delegated employee" required error={errors[`delegate-${i}`]}>
                            <Select value={d.delegateId} onChange={(e) => setD(i, { delegateId: e.target.value, previousStatus: undefined })}>
                              <option value="">Choose a colleague…</option>
                              {colleagues.map((c) => (
                                <option key={c.id} value={c.id} disabled={taken.has(c.id)}>
                                  {c.fullName}
                                  {c.team ? ` — ${c.team}` : ""}
                                </option>
                              ))}
                            </Select>
                          </Field>
                          <Field label="Coverage period" required hint={delegations.length > 1 ? "Split the coverage between delegates if needed." : undefined}>
                            <div className="flex items-center gap-2">
                              <Input type="date" value={d.coverageStart || f.startDate} onChange={(e) => setD(i, { coverageStart: e.target.value })} aria-label="Coverage start" />
                              <span className="text-muted">–</span>
                              <Input type="date" value={d.coverageEnd || (singleDay ? f.startDate : f.endDate)} min={d.coverageStart || f.startDate} onChange={(e) => setD(i, { coverageEnd: e.target.value })} aria-label="Coverage end" />
                            </div>
                          </Field>
                        </div>
                        <Field label="Handover notes" required error={errors[`handover-${i}`]} hint="What this delegate needs to know. They won't see your reason or documents.">
                          <Textarea value={d.handoverNotes} onChange={(e) => setD(i, { handoverNotes: e.target.value })} maxLength={4000} />
                        </Field>
                        <div className="space-y-2">
                          <div className="text-[13px] font-medium text-ink-2">Relevant tasks & deadlines</div>
                          {d.tasks.map((t, k) => (
                            <div key={k} className="flex gap-2">
                              <Input value={t.task} placeholder={`Task ${k + 1}`} onChange={(e) => setD(i, { tasks: d.tasks.map((x, j) => (j === k ? { ...x, task: e.target.value } : x)) })} />
                              <Input type="date" className="w-[170px]" value={t.deadline ?? ""} onChange={(e) => setD(i, { tasks: d.tasks.map((x, j) => (j === k ? { ...x, deadline: e.target.value } : x)) })} aria-label="Deadline" />
                              <Button variant="ghost" size="sm" className="h-10 px-2.5" onClick={() => setD(i, { tasks: d.tasks.filter((_, j) => j !== k) })} aria-label="Remove task">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ))}
                          {d.tasks.length < 20 && (
                            <Button variant="ghost" size="sm" onClick={() => setD(i, { tasks: [...d.tasks, { task: "" }] })}>
                              <Plus className="h-4 w-4" /> Add task
                            </Button>
                          )}
                        </div>
                        <Field label="Handover attachment (optional)">
                          <Upload value={d.attachment} onChange={(a) => setD(i, { attachment: a })} sensitive={false} />
                        </Field>
                      </div>
                    );
                  })}
                  {delegations.length < MAX_DELEGATES && (
                    <Button variant="secondary" size="sm" onClick={addDelegate}>
                      <Users2 className="h-4 w-4" /> Add delegate
                    </Button>
                  )}
                  {delegations.length > 1 && <p className="text-[12px] text-muted">All {delegations.length} delegates are asked at the same time. Your leader is asked once every delegate has accepted; if one declines, the request comes back to you.</p>}
                </div>
              )}
            </CardBody>
          </Card>
        )}

        {!isSchedule && (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={() => router.back()}>
              Cancel
            </Button>
            <Button variant="secondary" onClick={() => submit(true)} disabled={pending || !type}>
              Save draft
            </Button>
            <Button onClick={() => submit(false)} loading={pending} disabled={!type}>
              Submit request
            </Button>
          </div>
        )}
      </div>

      {/* Impact */}
      {!isSchedule && (
        <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <Card>
            <CardHeader title="Impact" description="Calculated live from your policy and approved plan." />
            <CardBody className="space-y-4">
              {!impact && <p className="text-[13px] text-muted">Choose a type and dates to see the impact.</p>}
              {impact && (
                <>
                  <div className="flex items-center justify-between rounded-xl bg-canvas px-3 py-2.5 text-[13px]">
                    <span className="flex items-center gap-2 text-muted">
                      <CalendarClock className="h-4 w-4" /> Working days
                    </span>
                    <b className="text-ink tabular">{impact.workingDays}</b>
                  </div>
                  {impact.ruleIssues.length > 0 && (
                    <Notice tone="danger" title="Doesn't meet the leave rules">
                      <ul className="list-disc space-y-0.5 pl-4">{impact.ruleIssues.map((x) => <li key={x}>{x}</li>)}</ul>
                    </Notice>
                  )}
                  {impact.conflicts.length > 0 && (
                    <Notice tone="danger" title="Conflicts with another request">
                      {impact.conflicts.join("; ")}
                    </Notice>
                  )}
                  {impact.balance && (
                    <div className="rounded-xl border border-line-2 p-3 text-[13px]">
                      <div className="mb-1.5 font-medium text-ink">{type?.name} balance</div>
                      {impact.balance.monthlyAccrual && (
                        <p className="mb-1.5 text-[11.5px] text-muted">
                          {impact.balance.eligible && impact.balance.eligibleSince
                            ? `Earned 1 day per month (${impact.balance.yearly}/year) — counted up to ${formatDate(impact.balance.asOf)}, when this leave starts.`
                            : "Annual leave is earned by full-time employees only."}
                        </p>
                      )}
                      <Row label={impact.balance.monthlyAccrual ? `Earned by ${formatDate(impact.balance.asOf).replace(/ \d{4}$/, "")}` : "Entitled"} value={impact.balance.entitled} />
                      <Row label="Used" value={impact.balance.used} />
                      <Row label="Pending" value={impact.balance.pending} />
                      <Row label="Remaining" value={impact.balance.remaining} />
                      <Row label="After approval" value={impact.balance.afterApproval} strong tone={impact.balance.afterApproval < 0 ? "danger" : undefined} />
                    </div>
                  )}
                  {impact.balance && impact.balance.unpaidDays > 0 && (
                    <Notice tone="danger" title={`${impact.balance.unpaidDays} day(s) would be unpaid leave`}>
                      This request is more than your remaining {type?.name.toLowerCase()} balance. The extra {impact.balance.unpaidDays} day(s) will be taken as <b>unpaid leave</b>, and the request is likely to be declined by your leader. Please reconsider the dates or the number of days.
                    </Notice>
                  )}
                  {impact.perMonth.map((m) => (
                    <div key={`${m.year}-${m.month}`} className="rounded-xl border border-line-2 p-3 text-[13px]">
                      <div className="mb-1.5 font-medium text-ink">{formatMonth(m.year, m.month)}</div>
                      <Row label="Current WFO target" value={m.currentTarget} />
                      <Row label="Projected target" value={m.projectedTarget} />
                      {m.planSource === "none" ? (
                        <p className="mt-1 text-[12px] text-muted">No plan for this month yet — the leave will be excluded when you plan.</p>
                      ) : (
                        <>
                          <Row label={`Planned WFO (${m.planSource})`} value={m.currentPlannedWfo} />
                          <Row label="Projected planned WFO" value={m.projectedPlannedWfo} />
                          <Row label="Replacement days required" value={m.replacementRequired} strong tone={m.replacementRequired ? "danger" : undefined} />
                        </>
                      )}
                      {m.suggestions.length > 0 && <div className="mt-2 text-[12px] text-muted">Suggested replacements: {m.suggestions.map((d) => formatDate(d)).join(", ")}</div>}
                      {m.notes.map((n) => (
                        <p key={n} className="mt-2 text-[12px] text-muted">
                          {n}
                        </p>
                      ))}
                    </div>
                  ))}
                  <p className="text-[12px] text-muted">Leave is not counted as WFH or as an absence. Full-day leave is excluded from your attendance-eligible days.</p>
                </>
              )}
            </CardBody>
          </Card>
          {delegationOn && (
            <Notice tone="info">
              <span className="flex gap-2">
                <Users2 className="mt-0.5 h-4 w-4 shrink-0" />
                Your delegate sees only dates, handover notes, tasks and the handover attachment.
              </span>
            </Notice>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, strong, tone }: { label: string; value: number; strong?: boolean; tone?: "danger" }) {
  return (
    <div className="flex justify-between py-0.5">
      <span className="text-muted">{label}</span>
      <span className={cn("tabular", strong && "font-semibold", tone === "danger" ? "text-danger" : "text-ink")}>{value}</span>
    </div>
  );
}

function Upload({ value, onChange, sensitive }: { value: { id: string; name: string } | null; onChange: (v: { id: string; name: string } | null) => void; sensitive: boolean }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  if (value)
    return (
      <div className="flex items-center justify-between rounded-xl border border-line bg-canvas px-3 py-2 text-[13px]">
        <span className="flex items-center gap-2 truncate text-ink">
          <Paperclip className="h-4 w-4 text-subtle" /> {value.name}
        </span>
        <button type="button" className="rounded-full p-1 text-muted hover:bg-white" onClick={() => onChange(null)} aria-label="Remove file">
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  return (
    <>
      <input
        ref={input}
        type="file"
        className="sr-only"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setBusy(true);
          const fd = new FormData();
          fd.set("file", file);
          fd.set("sensitive", String(sensitive));
          const r = await uploadAction(fd);
          setBusy(false);
          e.target.value = "";
          if (!r.ok) return void toast.error(r.error);
          onChange({ id: r.data!.id, name: r.data!.name });
        }}
      />
      <Button type="button" variant="secondary" onClick={() => input.current?.click()} loading={busy}>
        <FileUp className="h-4 w-4" /> Upload file
      </Button>
    </>
  );
}
