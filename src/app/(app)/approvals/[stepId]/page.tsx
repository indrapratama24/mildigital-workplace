import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can, hasCompanyScope } from "@/server/authz";
import { getPlannerData } from "@/server/services/schedules";
import { describeChanges } from "@/server/services/revisions";
import { formatDateTime, formatMonth, toISO, WEEKDAY_SHORT } from "@/lib/dates";
import { evaluatePlan, type MonthRequirement } from "@/lib/engine/working-days";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { DayCell } from "@/components/app/planner/day-cell";
import { DecisionPanel, ReassignForm } from "@/components/app/requests/decision-panel";
import { ApprovalTimeline } from "@/components/app/requests/timeline";

export const metadata = { title: "Review" };

export default async function ReviewPage({ params }: { params: Promise<{ stepId: string }> }) {
  const me = await requirePageUser();
  const { stepId } = await params;
  const step = await db.approvalStep.findUnique({
    where: { id: stepId },
    include: {
      assignee: true,
      workflow: {
        include: {
          requester: true,
          steps: { include: { assignee: true, originalAssignee: true, decidedBy: true }, orderBy: { order: "asc" } },
          actions: { include: { actor: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!step) notFound();
  const wf = step.workflow;
  if (wf.subjectType === "REQUEST") redirect(`/requests/${wf.subjectId}`);
  const involved = wf.steps.some((s) => s.assigneeId === me.employeeId || s.originalAssigneeId === me.employeeId);
  if (!involved && !hasCompanyScope(me)) redirect("/approvals");
  if (wf.subjectType === "EVENT_EXCEPTION") {
    const ex = await db.internalEventConflictException.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { event: { include: { category: true, organizer: true } } } });
    const date = toISO(ex.date);
    const sched = await getPlannerData(me, wf.requesterId, Number(date.slice(0, 4)), Number(date.slice(5, 7)), { assignedApprover: involved });
    const day = sched.days.find((d) => d.date === date);
    const canDecideEx = step.status === "PENDING" && step.assigneeId === me.employeeId && wf.status === "PENDING";
    return (
      <>
        <PageHeader eyebrow="Event conflict exception" title={`${wf.requester.fullName} · ${ex.event.title}`} description={`${formatDateTime(ex.event.startAt)} · mandatory in-office event organised by ${ex.event.organizer.fullName}`} actions={<StatusBadge status={wf.status === "PENDING" ? step.status : wf.status} />} />
        <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
          <Card>
            <CardHeader title="Request" description={`Stay WFH on ${formatDateTime(ex.event.startAt).split(",")[0]} instead of attending in the office.`} />
            <CardBody className="space-y-3 text-sm">
              <div className="rounded-xl bg-canvas px-3 py-2 text-ink-2">“{ex.reason}”</div>
              <p className="text-muted">
                Their plan for that day: <b className="text-ink">{day?.approved ?? day?.planned ?? "not planned"}</b> · Event: {ex.event.topic} ({ex.event.category.name}).
              </p>
              <Notice tone="info">Approving keeps their WFH day and records an exception for this event date. Rejecting asks them to switch the day to WFO.</Notice>
            </CardBody>
          </Card>
          {canDecideEx ? (
            <Card className="border-brand-200">
              <CardHeader title="Your decision" />
              <CardBody>
                <DecisionPanel stepId={step.id} kind={step.kind} />
              </CardBody>
            </Card>
          ) : (
            <Notice tone="info">{step.status === "PENDING" ? `Waiting for ${step.assignee.fullName}.` : "This step has been decided."}</Notice>
          )}
        </div>
      </>
    );
  }

  const schedule =
    wf.subjectType === "SCHEDULE"
      ? await db.monthlySchedule.findUniqueOrThrow({ where: { id: wf.subjectId } })
      : (await db.scheduleRevision.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { schedule: true } })).schedule;
  const revision = wf.subjectType === "REVISION" ? await db.scheduleRevision.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { items: { orderBy: { date: "asc" } } } }) : null;
  // Assigned approvers see the plan even if the reporting line changed since (access checked above).
  const data = await getPlannerData(me, wf.requesterId, schedule.year, schedule.month, { assignedApprover: involved });
  const canDecide = step.status === "PENDING" && step.assigneeId === me.employeeId && wf.status === "PENDING";
  const showPlanned = wf.subjectType === "SCHEDULE";
  const changed = new Map(revision?.items.map((i) => [toISO(i.date), i.toMode]) ?? []);
  const modes = Object.fromEntries(data.days.map((d) => [d.date, (showPlanned ? d.planned : changed.get(d.date) ?? d.approved) as "WFO" | "WFH" | null]));
  const req = data.requirement ? ({ ...data.requirement, days: data.days } as unknown as MonthRequirement) : null;
  const ev = req ? evaluatePlan(req, modes) : null;
  const impact = (revision?.impact ?? null) as null | { plannedWfoBefore: number; plannedWfoAfter: number; minimumRequired: number; shortfall: number; mandatoryViolations: string[] };
  const first = data.days[0]?.weekday ?? 1;
  const candidates = can(me, "approval.reassign") && step.status === "PENDING"
    ? await db.employee.findMany({ where: { isActive: true, id: { notIn: [wf.requesterId, step.assigneeId] }, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
    : [];

  return (
    <>
      <PageHeader
        eyebrow={wf.subjectType === "SCHEDULE" ? "Work plan review" : "Schedule change review"}
        title={`${wf.requester.fullName} · ${formatMonth(schedule.year, schedule.month)}`}
        description={`${wf.requester.jobTitle} · ${data.policy ? `${data.policy.name} v${data.policy.version}` : "no policy"} · submitted ${formatDateTime(wf.createdAt)}`}
        actions={<StatusBadge status={wf.status === "PENDING" ? step.status : wf.status} />}
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          {revision && (
            <Card>
              <CardHeader title="Requested change" description={describeChanges(revision.items.map((i) => ({ date: toISO(i.date), toMode: i.toMode, isReplacement: i.isReplacement })))} />
              <CardBody className="space-y-3 text-sm">
                <div className="rounded-xl bg-canvas px-3 py-2 text-ink-2">“{revision.reason}”</div>
                {impact && (
                  <div className="grid grid-cols-3 gap-3 text-center">
                    <Num label="WFO before" v={impact.plannedWfoBefore} />
                    <Num label="WFO after" v={impact.plannedWfoAfter} tone={impact.plannedWfoAfter < impact.minimumRequired ? "danger" : "success"} />
                    <Num label="Minimum" v={impact.minimumRequired} />
                  </div>
                )}
                {revision.requiresException && (
                  <Notice tone="warning" title="Authorised exception requested">
                    {impact?.mandatoryViolations.length ? "Changes a mandatory WFO day. " : ""}
                    {impact?.shortfall ? `Leaves a ${impact.shortfall}-day WFO shortfall with no replacement available. ` : ""}
                    Approving records an explicit exception in the employee&apos;s attendance history.
                  </Notice>
                )}
              </CardBody>
            </Card>
          )}
          <Card className="p-3 sm:p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1">
              <div className="text-sm font-semibold text-ink">{showPlanned ? "Submitted plan" : "Approved plan with the change applied"}</div>
              {ev && data.requirement && (
                <div className="text-[13px] text-muted">
                  <b className="text-ink">{ev.plannedWfo}</b> WFO / min <b className="text-ink">{data.requirement.effectiveMinimumWfo}</b> · {ev.plannedPercent}% · {ev.compliant ? <span className="text-success">meets policy</span> : <span className="text-danger">{ev.violations.join("; ")}</span>}
                </div>
              )}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {[1, 2, 3, 4, 5, 6, 7].map((w) => (
                <div key={w} className="pb-1 text-center text-[11px] font-semibold uppercase text-muted">
                  {WEEKDAY_SHORT[w]}
                </div>
              ))}
              {Array.from({ length: first - 1 }).map((_, i) => (
                <div key={`e${i}`} />
              ))}
              {data.days.map((d) => (
                <div key={d.date} className={changed.has(d.date) ? "rounded-xl ring-2 ring-pending ring-offset-1" : undefined}>
                  <DayCell day={{ ...d, pendingChange: null }} mode={d.plannable ? modes[d.date] ?? null : null} approvedView={!showPlanned} compact />
                </div>
              ))}
            </div>
          </Card>
          {data.requirement && data.requirement.warnings.length > 0 && (
            <Notice tone="info" title="Policy notes">
              <ul className="list-disc pl-4">
                {data.requirement.warnings.map((w) => (
                  <li key={w.code}>{w.message}</li>
                ))}
              </ul>
            </Notice>
          )}
        </div>
        <div className="space-y-5">
          {canDecide ? (
            <Card className="border-brand-200">
              <CardHeader title="Your decision" description={step.kind === "HR" ? "HR exception approval" : "Approved plans become the official schedule."} />
              <CardBody>
                <DecisionPanel stepId={step.id} kind={step.kind} />
              </CardBody>
            </Card>
          ) : (
            <Notice tone="info">{step.status === "PENDING" ? `Waiting for ${step.assignee.fullName}.` : "This step has been decided."}</Notice>
          )}
          <Card>
            <CardHeader title="Workflow" />
            <CardBody>
              <ApprovalTimeline
                steps={wf.steps.map((s) => ({ id: s.id, order: s.order, kind: s.kind, status: s.status, assignee: s.assignee.fullName, originalAssignee: s.originalAssignee.fullName, decidedBy: s.decidedBy?.fullName ?? null, decidedAt: s.decidedAt, dueAt: s.dueAt, comment: s.comment, escalated: s.escalated }))}
                actions={wf.actions.map((a) => ({ at: a.createdAt, actor: a.actor?.fullName ?? null, action: a.action, comment: a.comment }))}
              />
            </CardBody>
          </Card>
          {candidates.length > 0 && (
            <Card>
              <CardHeader title="Reassign approval" />
              <CardBody>
                <ReassignForm stepId={step.id} candidates={candidates} />
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Num({ label, v, tone }: { label: string; v: number; tone?: "danger" | "success" }) {
  return (
    <div className="rounded-xl bg-canvas py-2">
      <div className={`font-display text-[22px] font-bold ${tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-ink"}`}>{v}</div>
      <div className="text-[11.5px] text-muted">{label}</div>
    </div>
  );
}
