// Generic sequential approval workflow (peer delegate → leader → optional HR).
// Subject-specific effects (schedule, revision, request) are applied by approvals.ts in the same transaction.
import type { ApprovalStep, ApprovalWorkflow, StepKind, WorkflowSubject } from "@prisma/client";
import type { Tx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import { getSettings } from "./settings";
import { resolveApprover, resolveHrApprover } from "./org";
import { todayJakarta } from "@/lib/dates";

export type Decision = "APPROVE" | "REJECT" | "REQUEST_CHANGES" | "ACCEPT" | "DECLINE" | "REQUEST_CLARIFICATION";
/** PARTIAL = one of several parallel delegates accepted; others are still pending. */
export type Outcome = "ADVANCED" | "PARTIAL" | "APPROVED" | "REJECTED" | "CHANGES_REQUESTED" | "CLARIFICATION";

export const DECISIONS_BY_KIND: Record<StepKind, Decision[]> = {
  DELEGATE: ["ACCEPT", "DECLINE", "REQUEST_CLARIFICATION"],
  LEADER: ["APPROVE", "REJECT", "REQUEST_CHANGES"],
  HR: ["APPROVE", "REJECT", "REQUEST_CHANGES"],
  FINAL: ["APPROVE", "REJECT", "REQUEST_CHANGES"],
};

export interface StepSpec {
  kind: StepKind;
  assigneeId: string;
}

async function dueAt(tx: Tx, kind: StepKind) {
  const s = await getSettings(tx);
  const hours = kind === "DELEGATE" ? s.delegateDeadlineHours : s.leaderDeadlineHours;
  return new Date(Date.now() + hours * 3600_000);
}

export async function startWorkflow(
  tx: Tx,
  input: { subjectType: WorkflowSubject; subjectId: string; requesterId: string; steps: StepSpec[]; actorEmployeeId: string; comment?: string },
) {
  if (!input.steps.length) throw badState("A workflow needs at least one step.");
  if (input.steps.some((s) => s.assigneeId === input.requesterId)) throw forbidden("Requesters cannot approve their own submissions.");
  const existing = await tx.approvalWorkflow.findFirst({ where: { subjectType: input.subjectType, subjectId: input.subjectId, status: "PENDING" } });
  if (existing) throw conflict("This item already has an active approval.");
  const now = new Date();
  // Leading DELEGATE steps run in parallel: every delegate is asked at once.
  const parallel = input.steps.findIndex((s) => s.kind !== "DELEGATE");
  const firstBatch = input.steps[0].kind === "DELEGATE" ? (parallel === -1 ? input.steps.length : parallel) : 1;
  const wf = await tx.approvalWorkflow.create({
    data: {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      requesterId: input.requesterId,
      steps: {
        create: await Promise.all(
          input.steps.map(async (s, i) => ({
            order: i + 1,
            kind: s.kind,
            assigneeId: s.assigneeId,
            originalAssigneeId: s.assigneeId,
            status: i < firstBatch ? ("PENDING" as const) : ("WAITING" as const),
            activatedAt: i < firstBatch ? now : null,
            dueAt: i < firstBatch ? await dueAt(tx, s.kind) : null,
          })),
        ),
      },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await tx.approvalAction.create({ data: { workflowId: wf.id, actorId: input.actorEmployeeId, action: "SUBMITTED", comment: input.comment } });
  return wf;
}

export interface DecisionResult {
  workflow: ApprovalWorkflow;
  step: ApprovalStep;
  outcome: Outcome;
  nextStep: ApprovalStep | null;
}

export async function decideStep(tx: Tx, actor: CurrentUser, stepId: string, decision: Decision, comment?: string): Promise<DecisionResult> {
  const step = await tx.approvalStep.findUnique({ where: { id: stepId }, include: { workflow: true } });
  if (!step) throw notFound("Approval step");
  const wf = step.workflow;
  if (wf.requesterId === actor.employeeId) throw forbidden("You cannot approve your own request.");
  if (step.assigneeId !== actor.employeeId) throw forbidden("This approval is assigned to someone else.");
  if (wf.status !== "PENDING") throw conflict("This approval has already been completed.");
  if (step.status !== "PENDING") throw conflict(step.status === "CLARIFICATION_REQUESTED" ? "Waiting for the requester's clarification." : "This step has already been decided.");
  if (!DECISIONS_BY_KIND[step.kind].includes(decision)) throw invalid(`"${decision}" is not a valid action for this step.`);
  const needsComment: Decision[] = ["REJECT", "REQUEST_CHANGES", "DECLINE", "REQUEST_CLARIFICATION"];
  if (needsComment.includes(decision) && !comment?.trim()) throw invalid("Please add a comment explaining your decision.");

  const now = new Date();
  const newStatus = ({
    APPROVE: "APPROVED",
    ACCEPT: "APPROVED",
    REJECT: "REJECTED",
    DECLINE: "REJECTED",
    REQUEST_CHANGES: "CHANGES_REQUESTED",
    REQUEST_CLARIFICATION: "CLARIFICATION_REQUESTED",
  } as const)[decision];
  // Optimistic concurrency guard: a double click / concurrent approver cannot decide twice.
  const res = await tx.approvalStep.updateMany({
    where: { id: step.id, status: "PENDING", assigneeId: actor.employeeId },
    data: decision === "REQUEST_CLARIFICATION" ? { status: newStatus, comment } : { status: newStatus, decidedAt: now, decidedById: actor.employeeId, comment },
  });
  if (res.count !== 1) throw conflict("This step was decided by someone else just now.");
  await tx.approvalAction.create({ data: { workflowId: wf.id, stepId: step.id, actorId: actor.employeeId, action: decision, comment } });

  let outcome: Outcome;
  let nextStep: ApprovalStep | null = null;
  if (decision === "APPROVE" || decision === "ACCEPT") {
    const openDelegates =
      step.kind === "DELEGATE"
        ? await tx.approvalStep.count({ where: { workflowId: wf.id, kind: "DELEGATE", id: { not: step.id }, status: { in: ["PENDING", "CLARIFICATION_REQUESTED", "WAITING"] } } })
        : 0;
    const next = openDelegates ? null : await tx.approvalStep.findFirst({ where: { workflowId: wf.id, status: "WAITING" }, orderBy: { order: "asc" } });
    if (openDelegates) {
      outcome = "PARTIAL";
    } else if (next) {
      nextStep = await tx.approvalStep.update({ where: { id: next.id }, data: { status: "PENDING", activatedAt: now, dueAt: await dueAt(tx, next.kind) } });
      await tx.approvalWorkflow.update({ where: { id: wf.id }, data: { currentStepOrder: next.order } });
      outcome = "ADVANCED";
    } else {
      await tx.approvalWorkflow.update({ where: { id: wf.id }, data: { status: "APPROVED", completedAt: now } });
      outcome = "APPROVED";
    }
  } else if (decision === "REQUEST_CLARIFICATION") {
    outcome = "CLARIFICATION";
  } else {
    await tx.approvalWorkflow.update({ where: { id: wf.id }, data: { status: decision === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED", completedAt: now } });
    // also withdraws other parallel delegates that haven't answered yet
    await tx.approvalStep.updateMany({ where: { workflowId: wf.id, status: { in: ["WAITING", "PENDING", "CLARIFICATION_REQUESTED"] } }, data: { status: "CANCELLED" } });
    outcome = decision === "REQUEST_CHANGES" ? "CHANGES_REQUESTED" : "REJECTED";
  }
  const workflow = await tx.approvalWorkflow.findUniqueOrThrow({ where: { id: wf.id } });
  const updatedStep = await tx.approvalStep.findUniqueOrThrow({ where: { id: step.id } });
  return { workflow, step: updatedStep, outcome, nextStep };
}

/** Requester answers a delegate's clarification question; the step returns to PENDING. */
export async function respondToClarification(tx: Tx, actor: CurrentUser, stepId: string, comment: string) {
  const step = await tx.approvalStep.findUnique({ where: { id: stepId }, include: { workflow: true } });
  if (!step) throw notFound("Approval step");
  if (step.workflow.requesterId !== actor.employeeId) throw forbidden();
  if (step.status !== "CLARIFICATION_REQUESTED") throw conflict("No clarification is pending.");
  if (!comment.trim()) throw invalid("Please add your clarification.");
  await tx.approvalStep.update({ where: { id: step.id }, data: { status: "PENDING", dueAt: await dueAt(tx, step.kind) } });
  await tx.approvalAction.create({ data: { workflowId: step.workflowId, stepId: step.id, actorId: actor.employeeId, action: "CLARIFICATION_PROVIDED", comment } });
  return step;
}

export async function reassignStep(tx: Tx, actor: CurrentUser, stepId: string, newAssigneeId: string, reason: string) {
  if (!can(actor, "approval.reassign")) throw forbidden();
  const step = await tx.approvalStep.findUnique({ where: { id: stepId }, include: { workflow: true } });
  if (!step) throw notFound("Approval step");
  if (!["PENDING", "WAITING"].includes(step.status) || step.workflow.status !== "PENDING") throw conflict("Only open approvals can be reassigned.");
  if (step.kind === "DELEGATE") throw invalid("Delegate steps cannot be reassigned — the requester chooses their delegate.");
  if (newAssigneeId === step.workflow.requesterId) throw forbidden("An approval cannot be reassigned to the requester.");
  if (newAssigneeId === step.assigneeId) throw invalid("Already assigned to this person.");
  const target = await tx.employee.findUnique({ where: { id: newAssigneeId }, include: { user: true } });
  if (!target?.isActive || !target.user || !["LEADER", "HR", "SUPER_ADMIN"].includes(target.user.role)) throw invalid("The new approver must be an active Leader, HR or Admin.");
  if (!reason.trim()) throw invalid("A reason is required.");
  await tx.approvalStep.update({ where: { id: step.id }, data: { assigneeId: newAssigneeId } });
  await tx.approvalAction.create({
    data: { workflowId: step.workflowId, stepId: step.id, actorId: actor.employeeId, action: "REASSIGNED", comment: reason, metadata: { from: step.assigneeId, to: newAssigneeId } },
  });
  return { step, from: step.assigneeId, to: newAssigneeId };
}

export async function cancelWorkflow(tx: Tx, workflowId: string, actorEmployeeId: string, reason: string) {
  const wf = await tx.approvalWorkflow.findUnique({ where: { id: workflowId } });
  if (!wf || wf.status !== "PENDING") return;
  await tx.approvalWorkflow.update({ where: { id: wf.id }, data: { status: "CANCELLED", completedAt: new Date() } });
  await tx.approvalStep.updateMany({ where: { workflowId: wf.id, status: { in: ["PENDING", "WAITING", "CLARIFICATION_REQUESTED"] } }, data: { status: "CANCELLED" } });
  await tx.approvalAction.create({ data: { workflowId: wf.id, actorId: actorEmployeeId, action: "CANCELLED", comment: reason } });
}

/** Moves overdue leader/HR steps to the next approver in the fallback chain. */
export async function escalateStep(tx: Tx, step: ApprovalStep & { workflow: ApprovalWorkflow }) {
  const s = await getSettings(tx);
  const exclude = [step.assigneeId];
  let target: string;
  if (s.escalation === "HR") target = await resolveHrApprover(tx, [step.workflow.requesterId, ...exclude]);
  else target = (await resolveApprover(tx, step.workflow.requesterId, todayJakarta(), exclude)).assigneeId;
  await tx.approvalStep.update({ where: { id: step.id }, data: { assigneeId: target, escalated: true, dueAt: await dueAt(tx, step.kind) } });
  await tx.approvalAction.create({
    data: { workflowId: step.workflowId, stepId: step.id, action: "ESCALATED", comment: "Approval deadline passed", metadata: { from: step.assigneeId, to: target } },
  });
  return target;
}
