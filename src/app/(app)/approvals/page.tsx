import Link from "next/link";
import { CheckCircle2, ArrowRight, AlertTriangle } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { allPendingSteps, inboxFor, type InboxItem } from "@/server/services/approvals";
import { formatDateTime } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader, Avatar } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { RequestTabs } from "@/components/app/requests/tabs";

export const metadata = { title: "Approvals" };

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const me = await requirePageUser();
  const { tab } = await searchParams;
  const active = tab === "delegations" ? "delegations" : tab === "all" && can(me, "approval.reassign") ? "all" : "approvals";
  const [approvals, delegations] = await Promise.all([inboxFor(me.employeeId, ["LEADER", "HR"]), inboxFor(me.employeeId, ["DELEGATE"])]);
  const all = active === "all" ? await allPendingSteps() : [];
  const items: (InboxItem & { assigneeName?: string })[] = active === "approvals" ? approvals : active === "delegations" ? delegations : all;
  const now = Date.now();
  return (
    <>
      <PageHeader eyebrow="Requests & Approvals" title={active === "delegations" ? "Delegations" : active === "all" ? "All pending approvals" : "Approvals"} description={active === "delegations" ? "Colleagues asking you to cover their work. You confirm coverage — not their leave entitlement." : "Plans, schedule changes and requests waiting for your decision."} />
      <RequestTabs active={active} approvals={approvals.length} delegations={delegations.length} showAll={can(me, "approval.reassign")} />
      {items.length === 0 ? (
        <EmptyState icon={CheckCircle2} title="All clear" description="Nothing is waiting for you right now." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {items.map((a) => {
            const overdue = a.dueAt && new Date(a.dueAt).getTime() < now;
            return (
              <Link key={a.stepId} href={a.link}>
                <Card className="flex h-full items-start gap-3 p-4 transition-all hover:-translate-y-px hover:border-brand-200">
                  <Avatar name={a.requester.fullName} className="h-10 w-10" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">{a.requester.fullName}</span>
                      <span className="text-[12px] text-muted">{a.requester.jobTitle}</span>
                    </div>
                    <div className="mt-0.5 text-[14px] font-medium text-brand-700">{a.title}</div>
                    <div className="mt-0.5 text-[13px] text-ink-2">{a.summary}</div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone={a.kind === "DELEGATE" ? "leave" : a.kind === "HR" ? "warning" : "brand"}>{a.kind === "DELEGATE" ? "Peer delegation" : a.kind === "HR" ? "HR exception" : "Leader approval"}</Badge>
                      {a.flags.map((f) => (
                        <Badge key={f} tone={f.includes("xception") ? "warning" : "neutral"}>
                          {f}
                        </Badge>
                      ))}
                      {a.reassigned && <Badge tone="neutral">{a.escalated ? "Escalated" : "Reassigned"}</Badge>}
                      {"assigneeName" in a && a.assigneeName && <Badge tone="neutral">With {a.assigneeName}</Badge>}
                      {overdue && (
                        <Badge tone="danger">
                          <AlertTriangle className="h-3 w-3" /> Overdue
                        </Badge>
                      )}
                    </div>
                    <div className="mt-2 text-[11.5px] text-subtle">Submitted {formatDateTime(new Date(a.submittedAt))}{a.dueAt ? ` · due ${formatDateTime(new Date(a.dueAt))}` : ""}</div>
                  </div>
                  <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-subtle" />
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
