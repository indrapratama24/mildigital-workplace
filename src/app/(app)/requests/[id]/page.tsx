import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Paperclip, Pencil } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { getRequestDetail, leaveBalance } from "@/server/services/requests";
import { unpaidDays } from "@/lib/engine/leave";
import { DomainError } from "@/server/errors";
import { formatDateRange, formatDateTime, toISO, formatDate } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { buttonClass } from "@/components/ui/button";
import { ApprovalTimeline } from "@/components/app/requests/timeline";
import { CancelButton, ClarifyForm, DecisionPanel, ReassignForm } from "@/components/app/requests/decision-panel";

export const metadata = { title: "Request" };

const DURATION: Record<string, string> = { FULL_DAY: "Full day", HALF_DAY_AM: "Half day (morning)", HALF_DAY_PM: "Half day (afternoon)", HOURLY: "Hourly" };

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  let detail;
  try {
    detail = await getRequestDetail(me, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    if (e instanceof DomainError && e.message === "DELEGATE_VIEW") {
      const d = await db.delegationAssignment.findFirst({ where: { requestId: id, delegateId: me.employeeId } });
      if (d) redirect(`/delegations/${d.id}`);
    }
    if (e instanceof DomainError && e.code === "FORBIDDEN") redirect("/requests");
    throw e;
  }
  const { request: r, workflows, isOwner, canSeeDocument, pendingStep, clarificationSteps } = detail;
  const latest = workflows.at(-1);
  const myStep = pendingStep && pendingStep.assigneeId === me.employeeId && pendingStep.status === "PENDING" && pendingStep.kind !== "DELEGATE" ? pendingStep : null;
  const clarifySteps = isOwner ? clarificationSteps : [];
  const candidates = can(me, "approval.reassign") && pendingStep && pendingStep.kind !== "DELEGATE"
    ? await db.employee.findMany({ where: { isActive: true, id: { not: r.employeeId }, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
    : [];
  const declined = r.delegations.filter((d) => d.status === "DECLINED");
  // Balance at the leave date (excluding this request) — the part not covered is unpaid leave.
  const open = ["DRAFT", "PENDING_DELEGATE", "PENDING_LEADER", "CHANGES_REQUESTED"].includes(r.status);
  const bal = open && r.requestType.deductsBalance ? await leaveBalance(db, r.employeeId, r.requestTypeId, r.startDate.getUTCFullYear(), r.id, toISO(r.startDate)) : null;
  const unpaid = bal ? unpaidDays(bal.remaining, r.workingDays) : 0;

  return (
    <>
      <PageHeader
        eyebrow={isOwner ? "My request" : `Request from ${r.employee.fullName}`}
        title={r.requestType.name}
        description={`${formatDateRange(toISO(r.startDate), toISO(r.endDate))} · ${DURATION[r.durationType]}${r.durationType === "HOURLY" ? ` ${r.startTime}–${r.endTime}` : ""} · ${r.workingDays} working day(s)`}
        actions={
          <>
            <StatusBadge status={r.status} />
            {isOwner && ["DRAFT", "CHANGES_REQUESTED"].includes(r.status) && (
              <Link href={`/requests/new?id=${r.id}`} className={buttonClass("primary", "sm")}>
                <Pencil className="h-4 w-4" /> {r.status === "DRAFT" ? "Edit & submit" : "Edit & resubmit"}
              </Link>
            )}
            {isOwner && ["DRAFT", "PENDING_DELEGATE", "PENDING_LEADER", "CHANGES_REQUESTED"].includes(r.status) && <CancelButton id={r.id} kind="request" />}
          </>
        }
      />
      {r.status === "CHANGES_REQUESTED" && declined.length > 0 && isOwner && (
        <Notice tone="warning" className="mb-5" title={`${declined.map((d) => d.delegate.fullName).join(", ")} declined the delegation`}>
          {declined.map((d) => d.responseComment).filter(Boolean).join(" · ")} — replace the delegate and resubmit. Every delegate is asked again on resubmission.
        </Notice>
      )}
      {bal && unpaid > 0 && (
        <Notice tone="danger" className="mb-5" title={`${unpaid} of ${r.workingDays} day(s) would be unpaid leave`}>
          {isOwner ? "You" : r.employee.fullName} will have {Math.max(0, bal.remaining)} {r.requestType.name.toLowerCase()} day(s) available on {formatDate(toISO(r.startDate))}
          {bal.monthlyAccrual ? " (earned 1 per month)" : ""}. The rest is taken as unpaid leave{isOwner ? " — this is likely to be declined; please reconsider." : ". Please consider whether to approve."}
        </Notice>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {myStep && (
            <Card className="border-brand-200">
              <CardHeader title="Your decision" description={myStep.kind === "FINAL" ? "Final approval after the leader." : myStep.kind === "HR" ? "HR exception approval" : "Leader approval — you're confirming entitlement and team coverage."} />
              <CardBody>
                <DecisionPanel stepId={myStep.id} kind={myStep.kind} />
              </CardBody>
            </Card>
          )}
          {clarifySteps.map((cs) => (
            <Card key={cs.id} className="border-warning/40">
              <CardHeader title={`${cs.assignee.fullName} asked for clarification`} description={cs.comment ?? ""} />
              <CardBody>
                <ClarifyForm stepId={cs.id} />
              </CardBody>
            </Card>
          ))}
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-4 text-sm">
              <Detail label="Employee" value={`${r.employee.fullName} · ${r.employee.jobTitle}`} />
              <Detail label="Reason" value={r.reason} />
              {r.document && (
                <Detail
                  label="Supporting document"
                  value={
                    canSeeDocument ? (
                      <a href={`/api/files/${r.document.id}`} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline">
                        <Paperclip className="h-4 w-4" /> {r.document.originalName}
                      </a>
                    ) : (
                      <span className="text-muted">Restricted (sensitive document)</span>
                    )
                  }
                />
              )}
              <Detail label="Submitted" value={r.submittedAt ? formatDateTime(r.submittedAt) : "Not submitted"} />
            </CardBody>
          </Card>
          {r.delegations.length > 0 && (
            <Card>
              <CardHeader
                title={r.delegations.length > 1 ? `Delegation · ${r.delegations.length} delegates` : "Delegation"}
                description={`${r.delegations.filter((d) => d.status === "ACCEPTED").length} of ${r.delegations.length} accepted`}
              />
              <CardBody className="space-y-4 text-sm">
                {r.delegations.map((d) => {
                  const tasks = (d.tasks as { task: string; deadline?: string }[] | undefined) ?? [];
                  return (
                    <div key={d.id} className="space-y-3 rounded-xl border border-line-2 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="font-semibold text-ink">{d.delegate.fullName}</div>
                          <div className="text-[12px] text-muted">Coverage {formatDateRange(toISO(d.coverageStart), toISO(d.coverageEnd))}</div>
                        </div>
                        <StatusBadge status={d.status} />
                      </div>
                      <Detail label="Handover notes" value={<span className="whitespace-pre-line">{d.handoverNotes}</span>} />
                      {tasks.length > 0 && (
                        <Detail
                          label="Tasks"
                          value={
                            <ul className="space-y-1">
                              {tasks.map((t, i) => (
                                <li key={i}>
                                  • {t.task}
                                  {t.deadline && <span className="text-muted"> — due {formatDate(t.deadline)}</span>}
                                </li>
                              ))}
                            </ul>
                          }
                        />
                      )}
                      {d.attachment && (
                        <Detail
                          label="Attachment"
                          value={
                            <a href={`/api/files/${d.attachment.id}`} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline">
                              <Paperclip className="h-4 w-4" /> {d.attachment.originalName}
                            </a>
                          }
                        />
                      )}
                      {d.responseComment && <Detail label="Response" value={`“${d.responseComment}”`} />}
                    </div>
                  );
                })}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Approval workflow" description={workflows.length > 1 ? `${workflows.length} submissions` : undefined} />
            <CardBody>
              {latest ? (
                <ApprovalTimeline
                  steps={latest.steps.map((s) => ({
                    id: s.id,
                    order: s.order,
                    kind: s.kind,
                    status: s.status,
                    assignee: s.assignee.fullName,
                    originalAssignee: s.originalAssignee.fullName,
                    decidedBy: s.decidedBy?.fullName ?? null,
                    decidedAt: s.decidedAt,
                    dueAt: s.dueAt,
                    comment: s.comment,
                    escalated: s.escalated,
                  }))}
                  actions={workflows.flatMap((w) => w.actions.map((a) => ({ at: a.createdAt, actor: a.actor?.fullName ?? null, action: a.action, comment: a.comment })))}
                />
              ) : (
                <p className="text-sm text-muted">Not submitted yet.</p>
              )}
            </CardBody>
          </Card>
          {candidates.length > 0 && pendingStep && (
            <Card>
              <CardHeader title="Reassign approval" description="HR / Admin: move this approval when the approver is unavailable." />
              <CardBody>
                <ReassignForm stepId={pendingStep.id} candidates={candidates.filter((c) => c.id !== pendingStep.assigneeId)} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[160px_1fr]">
      <div className="text-[12.5px] font-medium text-muted">{label}</div>
      <div className="text-ink">{value}</div>
    </div>
  );
}
