import { formatDateTime } from "@/lib/dates";
import { StatusBadge } from "@/components/ui/status";
import { cn } from "@/lib/cn";

export interface TimelineStep {
  id: string;
  order: number;
  kind: string;
  status: string;
  assignee: string;
  originalAssignee: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  dueAt: Date | null;
  comment: string | null;
  escalated: boolean;
}

const KIND: Record<string, string> = { DELEGATE: "Layer 1 · Peer delegate", LEADER: "Layer 2 · Leader approval", HR: "Layer 3 · HR exception approval" };

export function ApprovalTimeline({ steps, actions }: { steps: TimelineStep[]; actions: { at: Date; actor: string | null; action: string; comment: string | null }[] }) {
  return (
    <div className="space-y-5">
      <ol className="space-y-3">
        {steps.map((s) => (
          <li key={s.id} className={cn("rounded-xl border px-4 py-3", s.status === "PENDING" ? "border-pending/40 bg-pending-soft/50" : "border-line-2")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[12px] font-medium uppercase tracking-wide text-muted">{KIND[s.kind] ?? s.kind}</div>
                <div className="text-sm font-semibold text-ink">
                  {s.assignee}
                  {s.originalAssignee !== s.assignee && <span className="ml-1.5 text-[12px] font-normal text-muted">(originally {s.originalAssignee}{s.escalated ? ", escalated" : ""})</span>}
                </div>
              </div>
              <StatusBadge status={s.status} />
            </div>
            {s.decidedAt && (
              <div className="mt-1 text-[12px] text-muted">
                {s.decidedBy} · {formatDateTime(s.decidedAt)}
              </div>
            )}
            {s.status === "PENDING" && s.dueAt && <div className="mt-1 text-[12px] text-muted">Due {formatDateTime(s.dueAt)}</div>}
            {s.comment && <div className="mt-2 rounded-lg bg-white px-3 py-2 text-[13px] text-ink-2">“{s.comment}”</div>}
          </li>
        ))}
      </ol>
      <div>
        <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">Audit trail</div>
        <ol className="relative space-y-3 border-l border-line pl-4">
          {actions.map((a, i) => (
            <li key={i} className="text-[12.5px]">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-brand-300" />
              <span className="font-medium capitalize text-ink">{a.action.replace(/_/g, " ").toLowerCase()}</span>
              <span className="text-muted"> · {a.actor ?? "System"} · {formatDateTime(a.at)}</span>
              {a.comment && <div className="text-muted">“{a.comment}”</div>}
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
