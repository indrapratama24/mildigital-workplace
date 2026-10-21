"use client";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Repeat, Users2, X, Globe2 } from "lucide-react";
import { createEventAction, previewParticipantsAction, publishEventAction, updateEventAction } from "@/server/actions/calendar";
import { describeRule, expandOccurrences, type Freq } from "@/lib/engine/recurrence";
import { addDays, WEEKDAY_SHORT } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { LOCATION_LABEL, WFO_LABEL } from "./labels";

type Opt = { id: string; name: string };
type RuleType = "ALL" | "DEPARTMENT" | "TEAM" | "LEVEL" | "EMPLOYEE";

export interface EventFormValues {
  title: string;
  categoryId: string;
  topic: string;
  description: string;
  date: string;
  startTime: string;
  endDate: string;
  endTime: string;
  locationType: "IN_OFFICE" | "ONLINE" | "HYBRID" | "EXTERNAL";
  locationDetail: string;
  meetingUrl: string;
  organizerId: string;
  attendanceRequirement: "MANDATORY" | "OPTIONAL";
  wfoRequirement: "IN_OFFICE_REQUIRED" | "REMOTE_ALLOWED" | "NONE";
  reminderMinutes: number[];
  allowOnOffDays: boolean;
  rules: { type: RuleType; targetId: string | null; dynamic: boolean }[];
  recurrence: { freq: Freq; interval: number; byWeekdays: number[]; untilDate: string };
}

export function EventForm({
  mode,
  eventId,
  status,
  isSeries,
  initial,
  categories,
  employees,
  teams,
  departments,
  levels,
  offDays,
}: {
  mode: "create" | "edit";
  eventId?: string;
  status?: "DRAFT" | "PUBLISHED" | "CANCELLED";
  isSeries?: boolean;
  initial: EventFormValues;
  categories: (Opt & { color: string })[];
  employees: Opt[];
  teams: Opt[];
  departments: Opt[];
  levels: Opt[];
  /** holidays & non-working days from Settings, keyed by date */
  offDays: Record<string, { label: string; kind: string }>;
}) {
  const router = useRouter();
  const [f, setF] = useState(initial);
  const [scope, setScope] = useState<"THIS" | "FOLLOWING" | "SERIES">("THIS");
  const [customReminder, setCustomReminder] = useState(() => String(initial.reminderMinutes.find((m) => m !== 1440 && m !== 60) ?? ""));
  const [preview, setPreview] = useState<{ count: number; names: string[]; teams: { name: string; count: number }[] } | null>(null);
  const [pending, start] = useTransition();
  const set = <K extends keyof EventFormValues>(k: K, v: EventFormValues[K]) => setF((p) => ({ ...p, [k]: v }));
  const setRec = (patch: Partial<EventFormValues["recurrence"]>) => setF((p) => ({ ...p, recurrence: { ...p.recurrence, ...patch } }));
  const dynamic = f.rules.some((r) => r.dynamic);

  // keep end date sensible
  useEffect(() => {
    if (f.endDate < f.date) set("endDate", f.date);
    if (f.recurrence.untilDate < f.date) setRec({ untilDate: f.date });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.date]);

  // live participant preview
  const rulesKey = JSON.stringify(f.rules);
  useEffect(() => {
    if (!f.rules.length) return setPreview({ count: 0, names: [], teams: [] });
    const t = setTimeout(async () => {
      const r = await previewParticipantsAction(f.rules);
      if (r.ok) setPreview(r.data!);
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesKey]);

  const recurrence = { ...f.recurrence, freq: f.recurrence.freq };
  const allDates = useMemo(() => {
    try {
      return expandOccurrences(f.date, recurrence);
    } catch {
      return [] as string[];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.date, JSON.stringify(f.recurrence)]);
  const skippedDates = f.allowOnOffDays ? [] : allDates.filter((d) => offDays[d]);
  const occurrences = allDates.length - skippedDates.length;
  const startOff = offDays[f.date];

  const hasRule = (type: RuleType, id: string | null) => f.rules.some((r) => r.type === type && r.targetId === id);
  const toggleRule = (type: RuleType, id: string | null) =>
    setF((p) => ({ ...p, rules: hasRule(type, id) ? p.rules.filter((r) => !(r.type === type && r.targetId === id)) : [...p.rules, { type, targetId: id, dynamic: type === "EMPLOYEE" ? false : dynamic }] }));
  const setDynamic = (on: boolean) => setF((p) => ({ ...p, rules: p.rules.map((r) => ({ ...r, dynamic: r.type === "EMPLOYEE" ? false : on })) }));

  const reminders = () => {
    const list: number[] = f.reminderMinutes.filter((m) => m === 1440 || m === 60);
    const c = Number(customReminder);
    if (customReminder && c >= 5) list.push(c);
    return [...new Set(list)];
  };
  const payload = () => ({
    ...f,
    description: f.description || null,
    locationDetail: f.locationDetail || null,
    meetingUrl: f.meetingUrl || null,
    reminderMinutes: reminders(),
    recurrence: f.recurrence.freq === "NONE" ? { ...f.recurrence, untilDate: f.date } : f.recurrence,
  });

  const submit = (publish: boolean) =>
    start(async () => {
      if (mode === "create") {
        const r = await createEventAction(payload(), publish);
        if (!r.ok) return void toast.error(r.error);
        toast.success(publish ? `Published${r.data!.occurrences > 1 ? ` · ${r.data!.occurrences} occurrences` : ""}` : "Draft saved");
        if (r.data!.skipped?.length) toast.info(`${r.data!.skipped.length} occurrence(s) skipped on holidays/off days: ${r.data!.skipped.map((x) => x.label).join(", ")}`, { duration: 8000 });
        router.push(`/internal-calendar/events/${r.data!.id}`);
      } else {
        const r = await updateEventAction(eventId!, payload(), isSeries ? scope : "THIS");
        if (!r.ok) return void toast.error(r.error);
        if (publish && status === "DRAFT") {
          const p = await publishEventAction(r.data!.id);
          if (!p.ok) return void toast.error(p.error);
        }
        toast.success(publish && status === "DRAFT" ? "Event published" : `Saved${r.data!.occurrences > 1 ? ` · ${r.data!.occurrences} occurrences updated` : ""}`);
        router.push(`/internal-calendar/events/${r.data!.id}`);
      }
      router.refresh();
    });

  const recurringLocked = mode === "edit" && !isSeries; // one-time events can't become a series
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Event information" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Event name" required className="sm:col-span-2">
              <Input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Weekly Performance Meeting" maxLength={140} />
            </Field>
            <Field label="Category" required>
              <Select value={f.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
            <Field label="Topic" required>
              <Input value={f.topic} onChange={(e) => set("topic", e.target.value)} placeholder="e.g. Retail Industry Insights" maxLength={200} />
            </Field>
            <Field label="Description / objective" className="sm:col-span-2" hint="Purpose, expected outcomes and agenda.">
              <Textarea value={f.description} onChange={(e) => set("description", e.target.value)} maxLength={4000} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Date & time" description="All times in Asia/Jakarta (WIB)." />
          <CardBody className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Start date" required><Input type="date" value={f.date} onChange={(e) => set("date", e.target.value)} /></Field>
              <Field label="Start time" required><Input type="time" value={f.startTime} onChange={(e) => set("startTime", e.target.value)} /></Field>
              <Field label="End date" required><Input type="date" value={f.endDate} min={f.date} onChange={(e) => set("endDate", e.target.value)} /></Field>
              <Field label="End time" required><Input type="time" value={f.endTime} onChange={(e) => set("endTime", e.target.value)} /></Field>
            </div>
            <div className="flex items-center gap-2 text-[12.5px] text-muted">
              <Globe2 className="h-3.5 w-3.5" /> Timezone: Asia/Jakarta
            </div>
            {startOff && f.recurrence.freq === "NONE" && !f.allowOnOffDays && (
              <Notice tone="warning" title={startOff.kind === "WEEKEND" ? "Non-working day" : `Holiday: ${startOff.label}`}>
                Events can't be scheduled on holidays or off days set in Settings. Pick another date, or allow it below (e.g. for a weekend company outing).
              </Notice>
            )}
            <Checkbox
              checked={f.allowOnOffDays}
              onChange={(e) => set("allowOnOffDays", e.target.checked)}
              label="Allow on holidays and off days"
              description="Off (default): occurrences on holidays, cuti bersama, company holidays or non-working days are skipped, and existing events are cancelled automatically if such a holiday is added later."
            />
            <div className="rounded-2xl border border-line-2 p-4">
              <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
                <Repeat className="h-4 w-4 text-brand-600" /> Recurrence
              </div>
              {recurringLocked ? (
                <p className="text-[13px] text-muted">One-time event. To make it repeat, duplicate it as a new recurring event.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Repeats">
                    <Select value={f.recurrence.freq} onChange={(e) => setRec({ freq: e.target.value as Freq, interval: 1 })}>
                      {mode === "create" && <option value="NONE">One-time</option>}
                      <option value="DAILY">Daily</option>
                      <option value="WEEKLY">Weekly</option>
                      <option value="MONTHLY">Monthly</option>
                      <option value="CUSTOM">Custom (every N weeks)</option>
                    </Select>
                  </Field>
                  {f.recurrence.freq !== "NONE" && (
                    <>
                      {f.recurrence.freq !== "WEEKLY" && (
                        <Field label={f.recurrence.freq === "DAILY" ? "Every N days" : f.recurrence.freq === "MONTHLY" ? "Every N months" : "Every N weeks"}>
                          <Input type="number" min={1} max={12} value={f.recurrence.interval} onChange={(e) => setRec({ interval: Math.max(1, Math.min(12, Number(e.target.value) || 1)) })} />
                        </Field>
                      )}
                      <Field label="Ends on">
                        <Input type="date" value={f.recurrence.untilDate} min={f.date} max={addDays(f.date, 365)} onChange={(e) => setRec({ untilDate: e.target.value })} />
                      </Field>
                      {f.recurrence.freq !== "MONTHLY" && (
                        <Field label={f.recurrence.freq === "DAILY" ? "Only on (optional)" : "On"} className="sm:col-span-3">
                          <div className="flex flex-wrap gap-1.5">
                            {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                              const on = f.recurrence.byWeekdays.includes(d);
                              return (
                                <button key={d} type="button" aria-pressed={on} onClick={() => setRec({ byWeekdays: on ? f.recurrence.byWeekdays.filter((x) => x !== d) : [...f.recurrence.byWeekdays, d].sort() })} className={cn("h-9 w-12 rounded-xl border text-[13px] font-medium", on ? "border-brand-700 bg-brand-700 text-white" : "border-line bg-white text-ink-2")}>
                                  {WEEKDAY_SHORT[d]}
                                </button>
                              );
                            })}
                          </div>
                        </Field>
                      )}
                      <p className="text-[12.5px] text-muted sm:col-span-3">
                        {describeRule(f.date, f.recurrence)} · <b className="text-ink">{occurrences}</b> occurrence(s)
                        {skippedDates.length > 0 && (
                          <span className="block text-warning">
                            {skippedDates.length} skipped on holidays/off days: {skippedDates.map((d) => `${d.slice(8)}/${d.slice(5, 7)} ${offDays[d].kind === "WEEKEND" ? "(off day)" : `(${offDays[d].label})`}`).join(", ")}
                          </span>
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Location & attendance" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <Field label="Attendance mode" required>
              <Select value={f.locationType} onChange={(e) => set("locationType", e.target.value as EventFormValues["locationType"])}>
                {Object.entries(LOCATION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </Field>
            <Field label="Organizer / PIC" required>
              <Select value={f.organizerId} onChange={(e) => set("organizerId", e.target.value)}>
                <option value="">Choose…</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </Select>
            </Field>
            {f.locationType !== "ONLINE" && (
              <Field label="Location" required>
                <Input value={f.locationDetail} onChange={(e) => set("locationDetail", e.target.value)} placeholder="e.g. MIL office · main room" />
              </Field>
            )}
            {f.locationType !== "IN_OFFICE" && f.locationType !== "EXTERNAL" && (
              <Field label="Meeting link" required hint="https:// link (Google Meet, Zoom…)">
                <Input value={f.meetingUrl} onChange={(e) => set("meetingUrl", e.target.value)} placeholder="https://meet.google.com/…" />
              </Field>
            )}
            <Field label="Attendance requirement" required>
              <Select value={f.attendanceRequirement} onChange={(e) => set("attendanceRequirement", e.target.value as EventFormValues["attendanceRequirement"])}>
                <option value="MANDATORY">Mandatory</option>
                <option value="OPTIONAL">Optional</option>
              </Select>
            </Field>
            <Field label="WFO requirement" required hint="Independent of the attendance requirement.">
              <Select value={f.wfoRequirement} onChange={(e) => set("wfoRequirement", e.target.value as EventFormValues["wfoRequirement"])}>
                {Object.entries(WFO_LABEL).map(([k, v]) => <option key={k} value={k} disabled={k === "IN_OFFICE_REQUIRED" && f.locationType === "ONLINE"}>{v}</option>)}
              </Select>
            </Field>
            {f.attendanceRequirement === "MANDATORY" && f.wfoRequirement === "IN_OFFICE_REQUIRED" && (
              <Notice tone="info" className="sm:col-span-2">Participants who planned WFH on this date get a schedule-conflict warning and are asked to switch to WFO or request an exception. Approved schedules are never changed automatically.</Notice>
            )}
            <Field label="Reminders" className="sm:col-span-2">
              <div className="flex flex-wrap items-center gap-4">
                {[[1440, "1 day before"], [60, "1 hour before"]].map(([m, l]) => (
                  <Checkbox key={m} checked={f.reminderMinutes.includes(m as number)} onChange={(e) => set("reminderMinutes", e.target.checked ? [...f.reminderMinutes, m as number] : f.reminderMinutes.filter((x) => x !== m))} label={l as string} />
                ))}
                <span className="flex items-center gap-2 text-sm text-ink">
                  Custom
                  <Input type="number" min={5} max={10080} value={customReminder} onChange={(e) => setCustomReminder(e.target.value)} className="h-9 w-24" placeholder="min" />
                  <span className="text-muted">minutes before</span>
                </span>
              </div>
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Participants" description="Combine groups and individuals — people in several groups are counted once." />
          <CardBody className="space-y-4">
            <Checkbox checked={hasRule("ALL", null)} onChange={() => toggleRule("ALL", null)} label="All employees" />
            <div className="grid gap-4 sm:grid-cols-2">
              <MultiPick label="Departments" options={departments} selected={f.rules.filter((r) => r.type === "DEPARTMENT").map((r) => r.targetId!)} onToggle={(id) => toggleRule("DEPARTMENT", id)} />
              <MultiPick label="Teams" options={teams} selected={f.rules.filter((r) => r.type === "TEAM").map((r) => r.targetId!)} onToggle={(id) => toggleRule("TEAM", id)} />
              <MultiPick label="Employee levels" options={levels} selected={f.rules.filter((r) => r.type === "LEVEL").map((r) => r.targetId!)} onToggle={(id) => toggleRule("LEVEL", id)} />
              <MultiPick label="Individual employees" options={employees} selected={f.rules.filter((r) => r.type === "EMPLOYEE").map((r) => r.targetId!)} onToggle={(id) => toggleRule("EMPLOYEE", id)} />
            </div>
            <Checkbox
              checked={dynamic}
              onChange={(e) => setDynamic(e.target.checked)}
              label="Keep group membership up to date (dynamic)"
              description="Off (default): participants are a snapshot taken when you save — predictable and auditable; use “Refresh participants” later. On: people joining a selected team/department/level are added automatically by the daily job."
            />
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-24 xl:self-start">
        <Card>
          <CardHeader title="Participant preview" />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-2">
              <Users2 className="h-5 w-5 text-brand-600" />
              <span className="font-display text-[26px] font-bold text-ink">{preview?.count ?? "—"}</span>
              <span className="text-[13px] text-muted">participant(s)</span>
            </div>
            {preview && preview.teams.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {preview.teams.map((t) => (
                  <span key={t.name} className="rounded-full bg-brand-50 px-2 py-0.5 text-[11.5px] font-medium text-brand-700">
                    {t.name} · {t.count}
                  </span>
                ))}
              </div>
            )}
            {preview && preview.names.length > 0 && (
              <p className="max-h-40 overflow-y-auto text-[12.5px] leading-relaxed text-ink-2">
                {preview.names.join(", ")}
                {preview.count > preview.names.length ? ` +${preview.count - preview.names.length} more` : ""}
              </p>
            )}
          </CardBody>
        </Card>

        {mode === "edit" && isSeries && (
          <Card>
            <CardHeader title="Apply changes to" />
            <CardBody className="space-y-2">
              {(
                [
                  ["THIS", "This occurrence only", "Becomes an individual exception."],
                  ["FOLLOWING", "This and following occurrences", "Earlier occurrences stay as they are."],
                  ["SERIES", "Entire series", "All upcoming occurrences (past ones keep their history). Edited single occurrences are left alone."],
                ] as const
              ).map(([v, l, d]) => (
                <label key={v} className={cn("flex cursor-pointer gap-2.5 rounded-xl border p-3", scope === v ? "border-brand-400 bg-brand-50/50" : "border-line-2")}>
                  <input type="radio" name="scope" checked={scope === v} onChange={() => setScope(v)} className="mt-1 accent-brand-700" />
                  <span>
                    <span className="block text-[13px] font-medium text-ink">{l}</span>
                    <span className="block text-[12px] text-muted">{d}</span>
                  </span>
                </label>
              ))}
              {scope === "THIS" && <p className="text-[12px] text-muted">To change how the event repeats, choose “this and following” or “entire series”.</p>}
            </CardBody>
          </Card>
        )}

        <div className="flex flex-col gap-2">
          {(mode === "create" || status === "DRAFT") && (
            <Button size="lg" loading={pending} onClick={() => submit(true)}>
              Publish event
            </Button>
          )}
          {mode === "edit" && status === "PUBLISHED" && (
            <Button size="lg" loading={pending} onClick={() => submit(false)}>
              Save changes
            </Button>
          )}
          {(mode === "create" || status === "DRAFT") && (
            <Button variant="secondary" disabled={pending} onClick={() => submit(false)}>
              {mode === "create" ? "Save draft" : "Save draft changes"}
            </Button>
          )}
          <Button variant="ghost" onClick={() => router.back()}>
            Cancel
          </Button>
          {mode === "edit" && status === "PUBLISHED" && <p className="text-[12px] text-muted">Participants are notified of time changes and new assignments. Changes are recorded in the event history.</p>}
        </div>
      </div>
    </div>
  );
}

function MultiPick({ label, options, selected, onToggle }: { label: string; options: Opt[]; selected: string[]; onToggle: (id: string) => void }) {
  const names = new Map(options.map((o) => [o.id, o.name]));
  return (
    <Field label={label}>
      <div className="space-y-2">
        <Select value="" onChange={(e) => e.target.value && onToggle(e.target.value)}>
          <option value="">Add {label.toLowerCase()}…</option>
          {options.filter((o) => !selected.includes(o.id)).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </Select>
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((id) => (
              <span key={id} className="inline-flex items-center gap-1 rounded-full bg-brand-50 py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-brand-700">
                {names.get(id) ?? "—"}
                <button type="button" onClick={() => onToggle(id)} className="rounded-full p-0.5 hover:bg-brand-100" aria-label={`Remove ${names.get(id)}`}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </Field>
  );
}
