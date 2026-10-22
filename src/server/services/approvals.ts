import type { StepKind } from "@prisma/client";
// Decision entry point: every approval/delegation decision runs in ONE serializable transaction
// that records the immutable action, advances the workflow and applies the subject's effects.
import { db, withTx } from "../db";
import { formatDateRange, formatMonth, toISO } from "@/lib/dates";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden, notFound } from "../errors";
import { audit } from "./audit";
import { notify } from "./notifications";
import { onRequestWorkflow } from "./requests";
import { onRevisionWorkflow, describeChanges } from "./revisions";
import { onScheduleWorkflow } from "./schedules";
import { onEventExceptionWorkflow } from "./events";
import { formatDate, formatTimeRange } from "@/lib/dates";
import { decideStep, escalateStep, reassignStep, respondToClarification, type Decision } from "./workflow";

export async function decide(actor: CurrentUser, stepId: string, decision: Decision, comment?: string) {
  if (!can(actor, "self.use")) throw forbidden();
  return withTx(async (tx) => {
    const result = await decideStep(tx, actor, stepId, decision, comment?.trim() || undefined);
    const { workflow, outcome, step, nextStep } = result;
    if (workflow.subjectType === "SCHEDULE") await onScheduleWorkflow(tx, workflow, outcome, actor, comment);
    else if (workflow.subjectType === "REVISION") await onRevisionWorkflow(tx, workflow, outcome, actor, comment);
    else if (workflow.subjectType === "EVENT_EXCEPTION") await onEventExceptionWorkflow(tx, workflow, outcome, actor, comment);
    else await onRequestWorkflow(tx, workflow, outcome, step, nextStep, actor, comment);
    await audit(tx, {
      actorUserId: actor.userId,
      action: `approval.${decision.toLowerCase()}`,
      entityType: workflow.subjectType,
      entityId: workflow.subjectId,
      metadata: { stepId, outcome, comment },
    });
    return { outcome };
  });
}

export async function clarify(actor: CurrentUser, stepId: string, comment: string) {
  return withTx(async (tx) => {
    const step = await respondToClarification(tx, actor, stepId, comment);
    if (step.workflow.subjectType === "REQUEST") {
      const d = await tx.delegationAssignment.findUnique({ where: { requestId_delegateId: { requestId: step.workflow.subjectId, delegateId: step.assigneeId } } });
      if (d) {
        await tx.delegationAssignment.update({ where: { id: d.id }, data: { status: "PENDING", handoverNotes: `${d.handoverNotes}\n\nClarification (${actor.fullName}): ${comment.trim()}` } });
        await notify(tx, { employeeId: d.delegateId, type: "DELEGATION_ASSIGNED", title: `${actor.fullName} answered your question`, body: comment.trim(), link: `/delegations/${d.id}` });
      }
    }
  });
}

export async function reassign(actor: CurrentUser, stepId: string, newAssigneeId: string, reason: string) {
  return withTx(async (tx) => {
    const r = await reassignStep(tx, actor, stepId, newAssigneeId, reason);
    await notify(tx, { employeeId: r.to, type: "APPROVAL_REASSIGNED", title: "An approval was reassigned to you", body: reason, link: "/approvals" });
    await audit(tx, { actorUserId: actor.userId, action: "approval.reassign", entityType: "ApprovalStep", entityId: stepId, before: { assigneeId: r.from }, after: { assigneeId: r.to }, metadata: { reason } });
  });
}

/** Escalates overdue leader/HR steps; delegates who miss the deadline trigger a reminder to the requester. */
export async function escalateOverdue(now = new Date()) {
  const overdue = await db.approvalStep.findMany({ where: { status: "PENDING", dueAt: { lt: now }, escalated: false }, include: { workflow: true } });
  let escalated = 0;
  for (const s of overdue) {
    try {
      await withTx(async (tx) => {
        if (s.kind === "DELEGATE") {
          await tx.approvalStep.update({ where: { id: s.id }, data: { escalated: true } });
          await notify(tx, { employeeId: s.workflow.requesterId, type: "DELEGATION_CLARIFICATION", title: "Your delegate hasn't responded yet", body: "Consider choosing another delegate (cancel and resubmit).", link: `/requests/${s.workflow.subjectId}` });
          return;
        }
        const to = await escalateStep(tx, s);
        await notify(tx, { employeeId: to, type: "APPROVAL_REASSIGNED", title: "An overdue approval was escalated to you", body: "The original approver did not respond before the deadline.", link: "/approvals" });
        escalated++;
      });
    } catch (e) {
      console.warn("[escalation] skipped step", s.id, (e as Error).message);
    }
  }
  return { checked: overdue.length, escalated };
}

// ───────────────────────────── Inbox read model ─────────────────────────────

export interface InboxItem {
  stepId: string;
  kind: StepKind;
  subjectType: "SCHEDULE" | "REVISION" | "REQUEST" | "EVENT_EXCEPTION";
  subjectId: string;
  status: string;
  requester: { id: string; fullName: string; jobTitle: string };
  title: string;
  summary: string;
  flags: string[];
  submittedAt: string;
  dueAt: string | null;
  escalated: boolean;
  reassigned: boolean;
  link: string;
}

export async function inboxFor(employeeId: string, kinds: StepKind[]): Promise<InboxItem[]> {
  const steps = await db.approvalStep.findMany({
    where: { assigneeId: employeeId, kind: { in: kinds }, status: { in: ["PENDING", "CLARIFICATION_REQUESTED"] }, workflow: { status: "PENDING" } },
    include: { workflow: { include: { requester: { select: { id: true, fullName: true, jobTitle: true } } } } },
    orderBy: { activatedAt: "asc" },
  });
  return Promise.all(steps.map((s) => describeStep(s)));
}

export async function allPendingSteps() {
  const steps = await db.approvalStep.findMany({
    where: { status: { in: ["PENDING", "CLARIFICATION_REQUESTED"] }, workflow: { status: "PENDING" } },
    include: { workflow: { include: { requester: { select: { id: true, fullName: true, jobTitle: true } } } }, assignee: { select: { fullName: true } } },
    orderBy: { dueAt: "asc" },
  });
  return Promise.all(steps.map(async (s) => ({ ...(await describeStep(s)), assigneeName: s.assignee.fullName })));
}

type StepRow = Awaited<ReturnType<typeof db.approvalStep.findMany<{ include: { workflow: { include: { requester: { select: { id: true; fullName: true; jobTitle: true } } } } } }>>>[number];

async function describeStep(s: StepRow): Promise<InboxItem> {
  const wf = s.workflow;
  const base = {
    stepId: s.id,
    kind: s.kind,
    subjectType: wf.subjectType,
    subjectId: wf.subjectId,
    status: s.status,
    requester: wf.requester,
    submittedAt: wf.createdAt.toISOString(),
    dueAt: s.dueAt?.toISOString() ?? null,
    escalated: s.escalated,
    reassigned: s.assigneeId !== s.originalAssigneeId,
  };
  if (wf.subjectType === "SCHEDULE") {
    const sch = await db.monthlySchedule.findUnique({ where: { id: wf.subjectId }, include: { days: true } });
    const wfo = sch?.days.filter((d) => d.plannedMode === "WFO").length ?? 0;
    const wfh = sch?.days.filter((d) => d.plannedMode === "WFH").length ?? 0;
    return { ...base, title: `Work plan · ${sch ? formatMonth(sch.year, sch.month) : ""}`, summary: `${wfo} WFO · ${wfh} WFH planned`, flags: [], link: `/approvals/${s.id}` };
  }
  if (wf.subjectType === "REVISION") {
    const rev = await db.scheduleRevision.findUnique({ where: { id: wf.subjectId }, include: { items: true, schedule: true } });
    const impact = (rev?.impact ?? {}) as { plannedWfoBefore?: number; plannedWfoAfter?: number; minimumRequired?: number };
    return {
      ...base,
      title: `Schedule change · ${rev ? formatMonth(rev.schedule.year, rev.schedule.month) : ""}`,
      summary: rev ? describeChanges(rev.items.map((i) => ({ date: toISO(i.date), toMode: i.toMode, isReplacement: i.isReplacement }))) : "",
      flags: [
        ...(rev?.requiresException ? ["Exception requested"] : []),
        ...(impact.plannedWfoAfter !== undefined ? [`WFO ${impact.plannedWfoBefore} → ${impact.plannedWfoAfter} / min ${impact.minimumRequired}`] : []),
      ],
      link: `/approvals/${s.id}`,
    };
  }
  if (wf.subjectType === "EVENT_EXCEPTION") {
    const ex = await db.internalEventConflictException.findUnique({ where: { id: wf.subjectId }, include: { event: true } });
    return {
      ...base,
      title: `Stay WFH during ${ex?.event.title ?? "event"}`,
      summary: ex ? `${formatDate(toISO(ex.date))} · ${formatTimeRange(ex.event.startAt, ex.event.endAt)} WIB · mandatory in-office event` : "",
      flags: ["Event conflict"],
      link: `/approvals/${s.id}`,
    };
  }
  const r = await db.request.findUnique({ where: { id: wf.subjectId }, include: { requestType: true, delegations: true } });
  if (!r) throw notFound("Request");
  if (s.kind === "DELEGATE") {
    const mine = r.delegations.find((d) => d.delegateId === s.assigneeId);
    return {
      ...base,
      title: "Delegation request",
      summary: mine ? `Cover ${formatDateRange(toISO(mine.coverageStart), toISO(mine.coverageEnd))}${r.delegations.length > 1 ? ` · 1 of ${r.delegations.length} delegates` : ""}` : "",
      flags: s.status === "CLARIFICATION_REQUESTED" ? ["Awaiting clarification"] : [],
      link: mine ? `/delegations/${mine.id}` : "#",
    };
  }
  const accepted = r.delegations.filter((d) => d.status === "ACCEPTED").length;
  return {
    ...base,
    title: r.requestType.name,
    summary: `${formatDateRange(toISO(r.startDate), toISO(r.endDate))} · ${r.workingDays} day(s)`,
    flags: r.delegations.length ? [`${accepted}/${r.delegations.length} delegate${r.delegations.length > 1 ? "s" : ""} accepted`] : [],
    link: `/requests/${r.id}`,
  };
}
