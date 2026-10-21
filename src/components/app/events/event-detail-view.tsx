"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CalendarDays, Clock, Copy, Download, ExternalLink, MapPin, Pencil, RefreshCw, Repeat, Send, Trash2, UserRound, Users2, XCircle, Building2 } from "lucide-react";
import type { EventDetail } from "@/server/services/events";
import { cancelEventAction, deleteDraftAction, publishEventAction, refreshParticipantsAction } from "@/server/actions/calendar";
import { Button, buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog } from "@/components/ui/dialog";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";
import { formatDateTime } from "@/lib/dates";
import { ACTION_LABEL, ATTENDANCE_LABEL, LOCATION_LABEL, SOURCE_LABEL, WFO_LABEL } from "./labels";

export function EventDetailView({ e, compact, onDone }: { e: EventDetail; compact?: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [cancelOpen, setCancelOpen] = useState(false);
  const [scope, setScope] = useState<"THIS" | "FOLLOWING" | "SERIES">("THIS");
  const [reason, setReason] = useState("");
  const [showAll, setShowAll] = useState(false);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, after?: () => void) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) return void toast.error(r.error);
      if (r.message) toast.success(r.message);
      after?.();
      router.refresh();
    });
  const officeMandatory = e.attendanceRequirement === "MANDATORY" && e.wfoRequirement === "IN_OFFICE_REQUIRED";
  const people = showAll ? e.participants : e.participants.slice(0, 12);
  const teams = [...new Set(e.participants.map((p) => p.team ?? "No team"))];
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral">
          <span className="h-2 w-2 rounded-full" style={{ background: e.category.color }} /> {e.category.name}
        </Badge>
        {e.status !== "PUBLISHED" && <Badge tone={e.status === "DRAFT" ? "pending" : "danger"}>{e.status === "DRAFT" ? "Draft" : "Cancelled"}</Badge>}
        <Badge tone={e.attendanceRequirement === "MANDATORY" ? "brand" : "neutral"}>{ATTENDANCE_LABEL[e.attendanceRequirement]}</Badge>
        {officeMandatory && (
          <Badge tone="brand">
            <Building2 className="h-3 w-3" /> In office required
          </Badge>
        )}
        {e.recurrence && (
          <Badge tone="neutral">
            <Repeat className="h-3 w-3" /> {e.recurrence.rule}
            {e.isException ? " · edited occurrence" : ""}
          </Badge>
        )}
        {e.isParticipant && <Badge tone="success">You&apos;re assigned</Badge>}
      </div>
      {e.status === "CANCELLED" && <Notice tone="danger" title="This event was cancelled">{e.cancelReason}</Notice>}

      <dl className="grid gap-3 text-sm sm:grid-cols-2">
        <Item icon={CalendarDays} label="Date & time" value={e.timeLabel} />
        <Item icon={MapPin} label={LOCATION_LABEL[e.locationType]} value={
          <span className="space-y-0.5">
            {e.locationDetail && <span className="block">{e.locationDetail}</span>}
            {e.meetingUrl && (
              <a href={e.meetingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline">
                Join meeting <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {!e.locationDetail && !e.meetingUrl && <span className="text-subtle">Not set</span>}
          </span>
        } />
        <Item icon={UserRound} label="Organizer / PIC" value={`${e.organizer.fullName} · ${e.organizer.jobTitle}`} />
        <Item icon={Building2} label="WFO requirement" value={WFO_LABEL[e.wfoRequirement]} />
        <Item icon={Clock} label="Reminders" value={e.reminderMinutes.length ? e.reminderMinutes.map((m) => (m >= 1440 ? `${m / 1440} day before` : m >= 60 ? `${m / 60} hour before` : `${m} min before`)).join(", ") : "None"} />
        <Item icon={Users2} label="Assigned to" value={e.rules.map((r) => r.label).join(" · ") || "—"} />
      </dl>

      {e.description && <p className="whitespace-pre-line rounded-xl bg-canvas px-4 py-3 text-[13.5px] text-ink-2">{e.description}</p>}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">
            Participants ({e.participants.length}) <span className="font-normal text-muted">· {teams.length} team(s)</span>
          </span>
          {e.participants.length > 12 && (
            <button className="text-[12.5px] font-medium text-brand-700 hover:underline" onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show fewer" : "View all participants"}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {people.map((p) => (
            <span key={p.id} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2" title={`${p.team ?? "No team"} · via ${SOURCE_LABEL[p.source]}`}>
              {p.name}
            </span>
          ))}
          {!e.participants.length && <span className="text-[13px] text-muted">No participants yet.</span>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-line-2 pt-4">
        {e.status !== "DRAFT" && (
          <a href={`/api/calendar/events/${e.id}/ics`} className={buttonClass("secondary", "sm")}>
            <Download className="h-4 w-4" /> Add to my calendar (.ics)
          </a>
        )}
        {compact && (
          <Link href={`/internal-calendar/events/${e.id}`} className={buttonClass("ghost", "sm")} onClick={onDone}>
            Open full page
          </Link>
        )}
        {e.perms.canEdit && e.status !== "CANCELLED" && (
          <Link href={`/internal-calendar/events/${e.id}/edit`} className={buttonClass("secondary", "sm")} onClick={onDone}>
            <Pencil className="h-4 w-4" /> Edit event
          </Link>
        )}
        {e.perms.canEdit && (
          <Link href={`/internal-calendar/events/new?from=${e.id}`} className={buttonClass("secondary", "sm")} onClick={onDone}>
            <Copy className="h-4 w-4" /> Duplicate
          </Link>
        )}
        {e.perms.canEdit && e.status === "DRAFT" && (
          <Button size="sm" loading={pending} onClick={() => run(() => publishEventAction(e.id), onDone)}>
            <Send className="h-4 w-4" /> Publish
          </Button>
        )}
        {e.perms.canManage && e.status === "PUBLISHED" && (
          <Button size="sm" variant="ghost" loading={pending} onClick={() => run(async () => {
            const r = await refreshParticipantsAction(e.id, e.seriesId ? "SERIES" : "THIS");
            if (r.ok) toast.success(`Participants refreshed: +${r.data!.added} / −${r.data!.removed}`);
            return { ...r, message: undefined };
          })}>
            <RefreshCw className="h-4 w-4" /> Refresh participants
          </Button>
        )}
        {e.perms.canManage && e.status === "PUBLISHED" && (
          <Button size="sm" variant="danger-outline" onClick={() => setCancelOpen(true)}>
            <XCircle className="h-4 w-4" /> Cancel event
          </Button>
        )}
        {(e.perms.canManage || e.perms.canEdit) && e.status === "DRAFT" && (
          <Button size="sm" variant="danger-outline" loading={pending} onClick={() => run(() => deleteDraftAction(e.id, e.seriesId ? "SERIES" : "THIS"), onDone)}>
            <Trash2 className="h-4 w-4" /> Delete draft
          </Button>
        )}
      </div>

      {!compact && e.history.length > 0 && (
        <div>
          <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Change history</div>
          <ol className="space-y-1.5 text-[12.5px]">
            {e.history.map((h, i) => (
              <li key={i} className="flex justify-between gap-3 border-b border-line-2 pb-1.5">
                <span className="text-ink">{ACTION_LABEL[h.action] ?? h.action}</span>
                <span className="text-muted">
                  {h.by} · {formatDateTime(new Date(h.at))}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={`Cancel “${e.title}”?`}
        description="Participants are notified. The event stays in the history as cancelled."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelOpen(false)}>Keep event</Button>
            <Button variant="danger" loading={pending} disabled={reason.trim().length < 3} onClick={() => run(() => cancelEventAction(e.id, scope, reason), () => { setCancelOpen(false); onDone?.(); })}>
              Cancel event
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          {e.recurrence && (
            <Field label="Which occurrences?">
              <Select value={scope} onChange={(ev) => setScope(ev.target.value as typeof scope)}>
                <option value="THIS">This occurrence only</option>
                <option value="FOLLOWING">This and following occurrences</option>
                <option value="SERIES">All upcoming occurrences in the series</option>
              </Select>
            </Field>
          )}
          <Field label="Reason" required>
            <Textarea value={reason} onChange={(ev) => setReason(ev.target.value)} className="min-h-[70px]" placeholder="e.g. Speaker unavailable — rescheduling" />
          </Field>
        </div>
      </Dialog>
    </div>
  );
}

function Item({ icon: Icon, label, value }: { icon: typeof CalendarDays; label: string; value: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-subtle" />
      <div className="min-w-0">
        <dt className="text-[11.5px] font-medium uppercase tracking-wide text-muted">{label}</dt>
        <dd className="text-ink">{value}</dd>
      </div>
    </div>
  );
}
