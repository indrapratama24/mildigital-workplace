import { Badge, type Tone } from "./badge";

const MAP: Record<string, [string, Tone]> = {
  DRAFT: ["Draft", "neutral"],
  NOT_STARTED: ["Not started", "neutral"],
  SUBMITTED: ["Submitted", "brand"],
  PENDING_LEADER_APPROVAL: ["Pending leader approval", "pending"],
  PENDING_DELEGATE: ["Waiting for delegate", "pending"],
  PENDING_LEADER: ["Pending leader approval", "pending"],
  PENDING: ["Pending", "pending"],
  APPROVED: ["Approved", "success"],
  ACCEPTED: ["Accepted", "success"],
  REJECTED: ["Rejected", "danger"],
  DECLINED: ["Declined", "danger"],
  CHANGES_REQUESTED: ["Changes requested", "warning"],
  CLARIFICATION_REQUESTED: ["Clarification requested", "warning"],
  REVISION_PENDING: ["Revision pending", "pending"],
  SUPERSEDED: ["Superseded", "neutral"],
  CANCELLED: ["Cancelled", "neutral"],
  WAITING: ["Waiting", "neutral"],
  SKIPPED: ["Skipped", "neutral"],
  COMPLIANT: ["Compliant", "success"],
  NON_COMPLIANT: ["Non-compliant", "danger"],
  PENDING_VERIFICATION: ["Pending verification", "warning"],
  ON_TRACK: ["On track", "success"],
  AT_RISK: ["At risk", "warning"],
  PROJECTED_SHORTFALL: ["Projected shortfall", "danger"],
  NO_PLAN: ["No approved plan", "neutral"],
  NO_POLICY: ["No policy", "danger"],
  VERIFIED: ["Verified", "success"],
  UNVERIFIED: ["Unverified", "warning"],
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const [label, tone] = MAP[status] ?? [status.replace(/_/g, " ").toLowerCase(), "neutral" as Tone];
  return (
    <Badge tone={tone} dot className={className}>
      {label}
    </Badge>
  );
}

export const statusLabel = (s: string) => MAP[s]?.[0] ?? s;
