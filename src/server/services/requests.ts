// Leave & permission requests with optional peer delegation and two-layer approval
// (Layer 1: delegate accepts coverage; Layer 2: leader approves entitlement).
import type { ApprovalStep, ApprovalWorkflow, DurationType, Prisma, Request, RequestStatus } from "@prisma/client";
import { db, withTx, type DbOrTx, type Tx } from "../db";
import { addMonths, eachDate, formatDate, formatDateRange, fromISO, isValidISO, monthEnd, monthStart, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { evaluatePlan, type LeaveDay } from "@/lib/engine/working-days";
import type { CurrentUser } from "../auth/session";
import { can, hasCompanyScope } from "../authz";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { countRequestDays, getHolidays, loadMonthContext, portionOf, type RequestWithType } from "./calendar";
import { notify } from "./notifications";
import { isLeaderOf, resolveApprover } from "./org";
import { getSettings } from "./settings";
import { cancelWorkflow, startWorkflow, type Outcome, type StepSpec } from "./workflow";

export const ACTIVE_STATUSES: RequestStatus[] = ["PENDING_DELEGATE", "PENDING_LEADER", "APPROVED"];
export const EDITABLE_REQUEST_STATUSES: RequestStatus[] = ["DRAFT", "CHANGES_REQUESTED"];

export interface DelegationInput {
  delegateId: string;
  handoverNotes: string;
  tasks: { task: string; deadline?: string }[];
  coverageStart: ISODate;
  coverageEnd: ISODate;
  attachmentId?: string | null;
}

export interface RequestInput {
  id?: string;
  requestTypeId: string;
  startDate: ISODate;
  endDate: ISODate;
  durationType: DurationType;
  startTime?: string | null;
  endTime?: string | null;
  reason: string;
  documentId?: string | null;
  /** One or more peer delegates (each with their own coverage, notes and tasks). */
  delegations?: DelegationInput[] | null;
  idempotencyKey: string;
}

export const MAX_DELEGATES = 5;

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

// ───────────────────────────── Validation ─────────────────────────────

function compatible(a: { durationType: DurationType; startTime?: string | null; endTime?: string | null }, b: typeof a) {
  const halves = new Set([a.durationType, b.durationType]);
  if (halves.has("HALF_DAY_AM") && halves.has("HALF_DAY_PM") && halves.size === 2) return true;
  if (a.durationType === "HOURLY" && b.durationType === "HOURLY" && a.startTime && a.endTime && b.startTime && b.endTime)
    return a.endTime <= b.startTime || b.endTime <= a.startTime;
  return false;
}

export async function findConflicts(tx: DbOrTx, employeeId: string, input: Pick<RequestInput, "startDate" | "endDate" | "durationType" | "startTime" | "endTime" | "id">) {
  const overlapping = await tx.request.findMany({
    where: {
      employeeId,
      id: input.id ? { not: input.id } : undefined,
      status: { in: [...ACTIVE_STATUSES, "CHANGES_REQUESTED"] },
      startDate: { lte: fromISO(input.endDate) },
      endDate: { gte: fromISO(input.startDate) },
    },
    include: { requestType: true },
  });
  return overlapping.filter((r) => !(toISO(r.startDate) === toISO(r.endDate) && input.startDate === input.endDate && compatible(input, r)));
}

export async function leaveBalance(tx: DbOrTx, employeeId: string, requestTypeId: string, year: number, excludeRequestId?: string) {
  const type = await tx.requestType.findUniqueOrThrow({ where: { id: requestTypeId } });
  if (!type.deductsBalance) return null;
  const bal = await tx.leaveBalance.findUnique({ where: { employeeId_requestTypeId_year: { employeeId, requestTypeId, year } } });
  const entitled = (bal?.entitledDays ?? type.defaultEntitlement ?? 0) + (bal?.adjustedDays ?? 0);
  const rows = await tx.request.findMany({
    where: { employeeId, requestTypeId, id: excludeRequestId ? { not: excludeRequestId } : undefined, status: { in: ACTIVE_STATUSES }, startDate: { gte: fromISO(`${year}-01-01`), lte: fromISO(`${year}-12-31`) } },
  });
  const used = rows.filter((r) => r.status === "APPROVED").reduce((s, r) => s + r.workingDays, 0);
  const pending = rows.filter((r) => r.status !== "APPROVED").reduce((s, r) => s + r.workingDays, 0);
  return { entitled, used, pending, remaining: entitled - used - pending };
}

async function validate(tx: Tx, actor: CurrentUser, input: RequestInput, submitting: boolean) {
  const type = await tx.requestType.findUnique({ where: { id: input.requestTypeId } });
  if (!type || !type.isActive) throw invalid("Choose a valid request type.");
  if (type.category === "ADDITIONAL_WFH" || type.category === "SCHEDULE_CHANGE") throw badState("WFH / schedule changes are submitted as schedule revisions.");
  if (!isValidISO(input.startDate) || !isValidISO(input.endDate)) throw invalid("Enter valid dates.");
  if (input.endDate < input.startDate) throw invalid("End date must be on or after the start date.");
  if (eachDate(input.startDate, input.endDate).length > 60) throw invalid("A single request can cover at most 60 days.");
  if (input.durationType !== "FULL_DAY" && input.startDate !== input.endDate) throw invalid("Half-day and hourly requests must be on a single date.");
  if ((input.durationType === "HALF_DAY_AM" || input.durationType === "HALF_DAY_PM") && !type.allowHalfDay) throw invalid(`${type.name} cannot be taken as a half day.`);
  if (input.durationType === "HOURLY") {
    if (!type.allowHourly) throw invalid(`${type.name} cannot be requested by the hour.`);
    if (!input.startTime || !input.endTime || !TIME.test(input.startTime) || !TIME.test(input.endTime) || input.endTime <= input.startTime)
      throw invalid("Enter a valid time range (HH:MM, end after start).");
  }
  if (input.reason.trim().length < type.reasonMinLength) throw invalid(`Reason must be at least ${type.reasonMinLength} characters.`);
  if (input.documentId) {
    const doc = await tx.storedFile.findUnique({ where: { id: input.documentId } });
    if (!doc || doc.ownerId !== actor.userId) throw invalid("Invalid supporting document.");
  }
  const today = todayJakarta();
  if (submitting) {
    if (type.documentRequirement === "REQUIRED" && !input.documentId) throw invalid(`${type.name} requires a supporting document.`);
    const leadDays = eachDate(today, input.startDate).length - 1;
    if (type.advanceNoticeDays > 0 && (input.startDate < today || leadDays < type.advanceNoticeDays))
      throw invalid(`${type.name} must be requested at least ${type.advanceNoticeDays} day(s) in advance.`);
    if (type.advanceNoticeDays === 0 && input.startDate < today && eachDate(input.startDate, today).length > 31)
      throw invalid("Back-dated requests are limited to the last 30 days.");
  }
  const settings = await getSettings(tx);
  const holidays = await getHolidays(tx, input.startDate, input.endDate);
  const { dates, days } = countRequestDays(input.startDate, input.endDate, input.durationType, holidays, settings);
  if (!dates.length) throw invalid("The selected period has no working days (weekends/holidays only).");

  const conflicts = await findConflicts(tx, actor.employeeId, input);
  if (conflicts.length)
    throw conflict(`Overlaps your ${conflicts[0].requestType.name.toLowerCase()} (${formatDateRange(toISO(conflicts[0].startDate), toISO(conflicts[0].endDate))}, ${conflicts[0].status.replace(/_/g, " ").toLowerCase()}).`);

  if (type.deductsBalance && submitting) {
    const bal = await leaveBalance(tx, actor.employeeId, type.id, Number(input.startDate.slice(0, 4)), input.id);
    if (bal && bal.remaining < days) throw invalid(`Insufficient ${type.name.toLowerCase()} balance: ${bal.remaining} day(s) remaining, ${days} requested.`);
  }

  let delegations = (input.delegations ?? []).filter((d) => d.delegateId || d.handoverNotes.trim());
  if (type.delegation === "NONE") delegations = [];
  if (type.delegation === "REQUIRED" && !delegations.length && submitting) throw invalid(`${type.name} requires a delegate to cover your work.`);
  if (delegations.length > MAX_DELEGATES) throw invalid(`Choose at most ${MAX_DELEGATES} delegates.`);
  const seenDelegates = new Set<string>();
  for (const delegation of delegations) {
    if (!delegation.delegateId) throw invalid("Choose a colleague for every delegate entry (or remove the empty one).");
    if (delegation.delegateId === actor.employeeId) throw invalid("You cannot delegate to yourself.");
    if (seenDelegates.has(delegation.delegateId)) throw invalid("Each colleague can only be added once as a delegate.");
    seenDelegates.add(delegation.delegateId);
    const delegate = await tx.employee.findUnique({ where: { id: delegation.delegateId } });
    if (!delegate?.isActive) throw invalid("The selected delegate is not an active employee.");
    if (!isValidISO(delegation.coverageStart) || !isValidISO(delegation.coverageEnd) || delegation.coverageEnd < delegation.coverageStart)
      throw invalid(`Enter a valid coverage period for ${delegate.fullName}.`);
    if (submitting && delegation.handoverNotes.trim().length < 10) throw invalid(`Handover notes for ${delegate.fullName} must be at least 10 characters.`);
    if (delegation.tasks.length > 20) throw invalid("List at most 20 handover tasks per delegate.");
    // Delegate must be available for the coverage period
    const away = await tx.request.findFirst({
      where: {
        employeeId: delegation.delegateId,
        status: { in: ACTIVE_STATUSES },
        durationType: "FULL_DAY",
        requestType: { category: "LEAVE" },
        startDate: { lte: fromISO(delegation.coverageEnd) },
        endDate: { gte: fromISO(delegation.coverageStart) },
      },
    });
    if (away) throw conflict(`${delegate.fullName} has leave during the coverage period. Choose another delegate.`);
    // Circular delegation: the delegate is themselves away and has delegated to me for an overlapping period
    const circular = await tx.delegationAssignment.findFirst({
      where: {
        delegatorId: delegation.delegateId,
        delegateId: actor.employeeId,
        status: { in: ["PENDING", "ACCEPTED", "CLARIFICATION_REQUESTED"] },
        request: { status: { in: ACTIVE_STATUSES } },
        coverageStart: { lte: fromISO(delegation.coverageEnd) },
        coverageEnd: { gte: fromISO(delegation.coverageStart) },
      },
    });
    if (circular) throw conflict(`${delegate.fullName} has delegated their work to you for an overlapping period — circular delegation is not allowed.`);
    if (delegation.attachmentId) {
      const f = await tx.storedFile.findUnique({ where: { id: delegation.attachmentId } });
      if (!f || f.ownerId !== actor.userId) throw invalid("Invalid handover attachment.");
    }
  }
  return { type, days, dates, delegations };
}

// ───────────────────────────── Impact preview ─────────────────────────────

export async function computeRequestImpact(actor: CurrentUser, input: Omit<RequestInput, "idempotencyKey" | "reason">) {
  const type = await db.requestType.findUnique({ where: { id: input.requestTypeId } });
  if (!type || !isValidISO(input.startDate) || !isValidISO(input.endDate) || input.endDate < input.startDate) return null;
  const settings = await getSettings();
  const holidays = await getHolidays(db, input.startDate, input.endDate);
  const { days, dates } = countRequestDays(input.startDate, input.endDate, input.durationType, holidays, settings);
  const today = todayJakarta();
  const months: { year: number; month: number }[] = [];
  for (let m = { year: Number(input.startDate.slice(0, 4)), month: Number(input.startDate.slice(5, 7)) }; monthStart(m.year, m.month) <= input.endDate; m = addMonths(m.year, m.month, 1))
    months.push(m);
  const perMonth = [];
  for (const { year, month } of months.slice(0, 3)) {
    const from = monthStart(year, month),
      to = monthEnd(year, month);
    const inMonth = dates.filter((d) => d >= from && d <= to);
    const extraLeaves: LeaveDay[] =
      type.category === "LEAVE" || type.category === "PERMISSION"
        ? inMonth.map((date) => ({ date, portion: portionOf(input.durationType), category: type.category as "LEAVE" | "PERMISSION", label: type.name, typeCode: type.code }))
        : [];
    const extraOffsite = type.category === "OFFSITE" && input.durationType === "FULL_DAY" ? inMonth : [];
    const [before, after] = await Promise.all([
      loadMonthContext(actor.employeeId, year, month, db, { excludeRequestId: input.id }),
      loadMonthContext(actor.employeeId, year, month, db, { excludeRequestId: input.id, extraLeaves, extraOffsite }),
    ]);
    if (!before.requirement || !after.requirement) continue;
    const modes = Object.keys(before.approvedModes).length ? before.approvedModes : before.plannedModes;
    const hasPlan = Object.keys(modes).length > 0;
    const pb = evaluatePlan(before.requirement, modes);
    const pa = evaluatePlan(after.requirement, modes);
    // without a plan there is nothing to replace yet — the employee simply plans around the leave
    const replacement = hasPlan ? Math.max(0, after.requirement.effectiveMinimumWfo - pa.plannedWfo) : 0;
    const blocked = new Set(inMonth);
    perMonth.push({
      year,
      month,
      planSource: Object.keys(before.approvedModes).length ? "approved" : Object.keys(before.plannedModes).length ? "draft" : "none",
      currentTarget: before.requirement.effectiveMinimumWfo,
      projectedTarget: after.requirement.effectiveMinimumWfo,
      currentPlannedWfo: pb.plannedWfo,
      projectedPlannedWfo: pa.plannedWfo,
      replacementRequired: replacement,
      suggestions:
        replacement > 0
          ? after.requirement.days.filter((d) => d.plannable && d.date > today && modes[d.date] === "WFH" && !blocked.has(d.date)).slice(0, 5).map((d) => d.date)
          : [],
      notes: after.requirement.warnings.filter((w) => w.code === "LEAVE_EXCLUDED" || w.code === "UNACHIEVABLE").map((w) => w.message),
    });
  }
  const balance = type.deductsBalance ? await leaveBalance(db, actor.employeeId, type.id, Number(input.startDate.slice(0, 4)), input.id) : null;
  const conflicts = await findConflicts(db, actor.employeeId, input);
  return {
    workingDays: days,
    perMonth,
    balance: balance ? { ...balance, afterApproval: balance.remaining - days } : null,
    conflicts: conflicts.map((c) => `${c.requestType.name} ${formatDateRange(toISO(c.startDate), toISO(c.endDate))} (${c.status.replace(/_/g, " ").toLowerCase()})`),
  };
}

// ───────────────────────────── Save / submit ─────────────────────────────

async function upsertDraft(tx: Tx, actor: CurrentUser, input: RequestInput, workingDays: number, delegations: DelegationInput[], status: RequestStatus) {
  const data = {
    requestTypeId: input.requestTypeId,
    startDate: fromISO(input.startDate),
    endDate: fromISO(input.endDate),
    durationType: input.durationType,
    startTime: input.durationType === "HOURLY" ? input.startTime : null,
    endTime: input.durationType === "HOURLY" ? input.endTime : null,
    reason: input.reason.trim(),
    workingDays,
    documentId: input.documentId || null,
    status,
  };
  let request: Request;
  if (input.id) {
    const existing = await tx.request.findUnique({ where: { id: input.id } });
    if (!existing) throw notFound("Request");
    if (existing.employeeId !== actor.employeeId) throw forbidden();
    if (!EDITABLE_REQUEST_STATUSES.includes(existing.status)) throw badState("This request can no longer be edited.");
    request = await tx.request.update({ where: { id: input.id }, data });
  } else {
    const dup = await tx.request.findUnique({ where: { employeeId_idempotencyKey: { employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey } } });
    if (dup) return { request: dup, duplicate: true };
    request = await tx.request.create({ data: { ...data, employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey } });
  }
  // Sync delegations: one row per delegate. On (re)submission every delegate is asked again.
  const keep = delegations.map((d) => d.delegateId);
  await tx.delegationAssignment.deleteMany({ where: { requestId: request.id, delegateId: { notIn: keep } } });
  for (const delegation of delegations) {
    const d = {
      delegatorId: actor.employeeId,
      handoverNotes: delegation.handoverNotes.trim(),
      tasks: delegation.tasks.filter((t) => t.task.trim()) as unknown as Prisma.InputJsonValue,
      coverageStart: fromISO(delegation.coverageStart),
      coverageEnd: fromISO(delegation.coverageEnd),
      attachmentId: delegation.attachmentId || null,
      status: "PENDING" as const,
      responseComment: null,
      respondedAt: null,
    };
    await tx.delegationAssignment.upsert({
      where: { requestId_delegateId: { requestId: request.id, delegateId: delegation.delegateId } },
      create: { ...d, requestId: request.id, delegateId: delegation.delegateId },
      update: d,
    });
  }
  return { request, duplicate: false };
}

export async function saveRequestDraft(actor: CurrentUser, input: RequestInput) {
  return withTx(async (tx) => {
    const { days, delegations } = await validate(tx, actor, input, false);
    const { request } = await upsertDraft(tx, actor, input, days, delegations, "DRAFT");
    return request;
  });
}

export async function submitRequest(actor: CurrentUser, input: RequestInput) {
  return withTx(async (tx) => {
    if (!input.id) {
      const dup = await tx.request.findUnique({ where: { employeeId_idempotencyKey: { employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey } } });
      if (dup && dup.status !== "DRAFT") return dup; // duplicate submission → return the original
      if (dup) input = { ...input, id: dup.id };
    }
    const { type, days, delegations } = await validate(tx, actor, input, true);
    const status: RequestStatus = delegations.length ? "PENDING_DELEGATE" : "PENDING_LEADER";
    const { request } = await upsertDraft(tx, actor, input, days, delegations, status);
    const leader = await resolveApprover(tx, actor.employeeId, input.startDate < todayJakarta() ? todayJakarta() : input.startDate);
    // Layer 1: all delegates are asked in parallel. Layer 2: the leader, once every delegate accepted.
    // If the leader is also a delegate, acceptance and approval still remain separate steps.
    const steps: StepSpec[] = delegations.map((d) => ({ kind: "DELEGATE" as const, assigneeId: d.delegateId }));
    steps.push({ kind: "LEADER", assigneeId: leader.assigneeId });
    await startWorkflow(tx, { subjectType: "REQUEST", subjectId: request.id, requesterId: actor.employeeId, steps, actorEmployeeId: actor.employeeId, comment: input.reason });
    await tx.request.update({ where: { id: request.id }, data: { submittedAt: new Date() } });
    const range = formatDateRange(input.startDate, input.endDate);
    for (const delegation of delegations)
      await notify(tx, {
        employeeId: delegation.delegateId,
        type: "DELEGATION_ASSIGNED",
        title: `${actor.fullName} asked you to cover their work`,
        body: `Coverage ${formatDateRange(delegation.coverageStart, delegation.coverageEnd)}${delegations.length > 1 ? ` (shared with ${delegations.length - 1} other colleague${delegations.length > 2 ? "s" : ""})` : ""}. Please accept, decline or ask for clarification.`,
        link: "/approvals?tab=delegations",
      });
    if (!delegations.length)
      await notify(tx, {
        employeeId: leader.assigneeId,
        type: "REQUEST_PENDING",
        title: `${actor.fullName} requested ${type.name.toLowerCase()}`,
        body: `${range} · ${days} working day(s).`,
        link: "/approvals",
      });
    await audit(tx, { actorUserId: actor.userId, action: "request.submit", entityType: "Request", entityId: request.id, after: { ...input, workingDays: days } });
    return tx.request.findUniqueOrThrow({ where: { id: request.id } });
  });
}

export async function cancelRequest(actor: CurrentUser, requestId: string) {
  return withTx(async (tx) => {
    const r = await tx.request.findUnique({ where: { id: requestId }, include: { delegations: true } });
    if (!r) throw notFound("Request");
    if (r.employeeId !== actor.employeeId) throw forbidden();
    if (!["DRAFT", "PENDING_DELEGATE", "PENDING_LEADER", "CHANGES_REQUESTED"].includes(r.status))
      throw badState("Approved or closed requests cannot be cancelled here. Ask HR for an attendance correction.");
    await tx.request.update({ where: { id: r.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    await tx.delegationAssignment.updateMany({ where: { requestId: r.id }, data: { status: "CANCELLED" } });
    const wf = await tx.approvalWorkflow.findFirst({ where: { subjectType: "REQUEST", subjectId: r.id, status: "PENDING" } });
    if (wf) await cancelWorkflow(tx, wf.id, actor.employeeId, "Cancelled by requester");
    await audit(tx, { actorUserId: actor.userId, action: "request.cancel", entityType: "Request", entityId: r.id });
  });
}

// ───────────────────────────── Workflow effects ─────────────────────────────

export async function onRequestWorkflow(tx: Tx, wf: ApprovalWorkflow, outcome: Outcome, step: ApprovalStep, nextStep: ApprovalStep | null, actor: CurrentUser, comment?: string) {
  const r = await tx.request.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { requestType: true, delegations: true, employee: true } });
  const range = formatDateRange(toISO(r.startDate), toISO(r.endDate));
  const link = `/requests/${r.id}`;
  if (step.kind === "DELEGATE") {
    const mine = r.delegations.find((d) => d.delegateId === step.assigneeId);
    if (!mine) return;
    if (outcome === "ADVANCED" || outcome === "PARTIAL") {
      await tx.delegationAssignment.update({ where: { id: mine.id }, data: { status: "ACCEPTED", respondedAt: new Date(), responseComment: comment } });
      const waiting = r.delegations.filter((d) => d.id !== mine.id && d.status !== "ACCEPTED").length;
      if (outcome === "ADVANCED") await tx.request.update({ where: { id: r.id }, data: { status: "PENDING_LEADER" } });
      await notify(tx, {
        employeeId: r.employeeId,
        type: "DELEGATION_ACCEPTED",
        title: `${actor.fullName} accepted your delegation`,
        body: outcome === "ADVANCED" ? `All delegates accepted — ${r.requestType.name} ${range} is now with your leader.` : `Waiting for ${waiting} more delegate(s) to respond.`,
        link,
      });
      if (outcome === "ADVANCED" && nextStep)
        await notify(tx, {
          employeeId: nextStep.assigneeId,
          type: "REQUEST_PENDING",
          title: `${r.employee.fullName} requested ${r.requestType.name.toLowerCase()}`,
          body: `${range} · ${r.workingDays} working day(s). ${r.delegations.length > 1 ? `All ${r.delegations.length} delegates` : `Delegate ${actor.fullName}`} accepted the handover.`,
          link: "/approvals",
        });
    } else if (outcome === "REJECTED") {
      await tx.delegationAssignment.update({ where: { id: mine.id }, data: { status: "DECLINED", respondedAt: new Date(), responseComment: comment } });
      // other delegates who haven't answered yet are withdrawn; everyone is asked again on resubmission
      await tx.delegationAssignment.updateMany({ where: { requestId: r.id, id: { not: mine.id }, status: { in: ["PENDING", "CLARIFICATION_REQUESTED"] } }, data: { status: "CANCELLED" } });
      await tx.request.update({ where: { id: r.id }, data: { status: "CHANGES_REQUESTED" } });
      await notify(tx, {
        employeeId: r.employeeId,
        type: "DELEGATION_DECLINED",
        title: `${actor.fullName} declined your delegation`,
        body: `${comment ?? ""} Replace this delegate and resubmit.`.trim(),
        link,
      });
    } else if (outcome === "CLARIFICATION") {
      await tx.delegationAssignment.update({ where: { id: mine.id }, data: { status: "CLARIFICATION_REQUESTED", responseComment: comment } });
      await notify(tx, { employeeId: r.employeeId, type: "DELEGATION_CLARIFICATION", title: `${actor.fullName} has a question about your handover`, body: comment ?? "", link });
    }
    return;
  }
  if (outcome === "ADVANCED" && nextStep) {
    await notify(tx, { employeeId: nextStep.assigneeId, type: "REQUEST_PENDING", title: `HR approval needed: ${r.employee.fullName}`, body: `${r.requestType.name} ${range}`, link: "/approvals" });
    return;
  }
  if (outcome === "APPROVED") {
    await tx.request.update({ where: { id: r.id }, data: { status: "APPROVED", decidedAt: new Date() } });
    await notify(tx, { employeeId: r.employeeId, type: "REQUEST_APPROVED", title: `${r.requestType.name} approved`, body: `${range}${comment ? ` — ${comment}` : ""}`, link });
    for (const d of r.delegations.filter((x) => x.status === "ACCEPTED"))
      await notify(tx, { employeeId: d.delegateId, type: "REQUEST_APPROVED", title: `${r.employee.fullName}'s time off is confirmed`, body: `You are covering ${formatDateRange(toISO(d.coverageStart), toISO(d.coverageEnd))}.`, link: `/delegations/${d.id}` });
    // Approved leave changes the month's denominator; flag any WFO replacement now needed.
    for (const m of monthsBetween(toISO(r.startDate), toISO(r.endDate))) {
      const ctx = await loadMonthContext(r.employeeId, m.year, m.month, tx);
      if (!ctx.requirement || !Object.keys(ctx.approvedModes).length) continue;
      const ev = evaluatePlan(ctx.requirement, ctx.approvedModes);
      if (ev.shortfall > 0) {
        await notify(tx, {
          employeeId: r.employeeId,
          type: "REPLACEMENT_REQUIRED",
          title: `Replacement WFO required: ${ev.shortfall} day(s)`,
          body: `After your approved ${r.requestType.name.toLowerCase()}, your plan has ${ev.plannedWfo} of ${ctx.requirement.effectiveMinimumWfo} required WFO days. Submit a schedule change to add replacement days.`,
          link: `/calendar?month=${m.year}-${String(m.month).padStart(2, "0")}`,
          dedupeKey: `replacement:${r.id}:${m.year}-${m.month}`,
        });
        await notify(tx, {
          employeeId: actor.employeeId,
          type: "WFO_SHORTFALL",
          title: `${r.employee.fullName}: WFO shortfall of ${ev.shortfall} day(s)`,
          body: `Detected after approving ${r.requestType.name.toLowerCase()} ${range}.`,
          link: "/compliance",
          dedupeKey: `shortfall-leader:${r.id}:${m.year}-${m.month}`,
        });
      }
    }
  } else if (outcome === "REJECTED" || outcome === "CHANGES_REQUESTED") {
    await tx.request.update({ where: { id: r.id }, data: { status: outcome, decidedAt: outcome === "REJECTED" ? new Date() : null } });
    await notify(tx, {
      employeeId: r.employeeId,
      type: outcome === "REJECTED" ? "REQUEST_REJECTED" : "REQUEST_CHANGES_REQUESTED",
      title: `${r.requestType.name} ${outcome === "REJECTED" ? "rejected" : "needs changes"}`,
      body: comment ?? "",
      link,
    });
    if (outcome === "REJECTED")
      for (const d of r.delegations.filter((x) => x.status === "ACCEPTED"))
        await notify(tx, { employeeId: d.delegateId, type: "REQUEST_REJECTED", title: `Coverage no longer needed`, body: `${r.employee.fullName}'s request for ${range} was not approved.`, link: `/delegations/${d.id}` });
  }
}

function monthsBetween(a: ISODate, b: ISODate) {
  const out: { year: number; month: number }[] = [];
  for (let m = { year: Number(a.slice(0, 4)), month: Number(a.slice(5, 7)) }; monthStart(m.year, m.month) <= b; m = addMonths(m.year, m.month, 1)) out.push(m);
  return out;
}

// ───────────────────────────── Read models ─────────────────────────────

/** Full request detail — requester, assigned approvers, HR, and leaders within scope. */
export async function getRequestDetail(viewer: CurrentUser, id: string) {
  const r = await db.request.findUnique({
    where: { id },
    include: {
      requestType: true,
      employee: { select: { id: true, fullName: true, jobTitle: true } },
      document: true,
      delegations: { include: { delegate: { select: { id: true, fullName: true } }, attachment: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!r) throw notFound("Request");
  const workflows = await db.approvalWorkflow.findMany({
    where: { subjectType: "REQUEST", subjectId: id },
    include: {
      steps: { include: { assignee: { select: { fullName: true } }, originalAssignee: { select: { fullName: true } }, decidedBy: { select: { fullName: true } } }, orderBy: { order: "asc" } },
      actions: { include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });
  const isOwner = r.employeeId === viewer.employeeId;
  const isApprover = workflows.some((w) => w.steps.some((s) => s.kind !== "DELEGATE" && (s.assigneeId === viewer.employeeId || s.originalAssigneeId === viewer.employeeId)));
  const inScope = can(viewer, "team.view") && (await isLeaderOf(db, viewer.employeeId, r.employeeId));
  if (!isOwner && !isApprover && !hasCompanyScope(viewer) && !inScope) {
    if (r.delegations.some((d) => d.delegateId === viewer.employeeId)) throw forbidden("DELEGATE_VIEW");
    throw forbidden();
  }
  const canSeeDocument = isOwner || isApprover || can(viewer, "company.view");
  const open = workflows.flatMap((w) => (w.status === "PENDING" ? w.steps : []));
  const pendingStep = open.find((s) => s.status === "PENDING" && s.kind !== "DELEGATE") ?? open.find((s) => s.status === "PENDING" || s.status === "CLARIFICATION_REQUESTED");
  const clarificationSteps = open.filter((s) => s.status === "CLARIFICATION_REQUESTED");
  return { request: r, workflows, isOwner, canSeeDocument, pendingStep: pendingStep ?? null, clarificationSteps };
}

/** Limited view for the peer delegate: handover information only (no reason, no documents, no leave type detail). */
export async function getDelegationForDelegate(viewer: CurrentUser, delegationId: string) {
  const d = await db.delegationAssignment.findUnique({
    where: { id: delegationId },
    include: { delegator: { select: { fullName: true, jobTitle: true } }, attachment: true, request: { select: { status: true, startDate: true, endDate: true, durationType: true, requestType: { select: { category: true } } } } },
  });
  if (!d) throw notFound("Delegation");
  if (d.delegateId !== viewer.employeeId && d.delegatorId !== viewer.employeeId) throw forbidden();
  const wf = await db.approvalWorkflow.findFirst({ where: { subjectType: "REQUEST", subjectId: d.requestId }, orderBy: { createdAt: "desc" }, include: { steps: true, actions: { include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } } });
  const step = wf?.steps.find((s) => s.kind === "DELEGATE" && s.assigneeId === viewer.employeeId && (s.status === "PENDING" || s.status === "CLARIFICATION_REQUESTED"));
  // each delegate only sees their own conversation; the requester sees this delegate's thread
  const myStepIds = new Set((wf?.steps ?? []).filter((s) => s.kind === "DELEGATE" && s.assigneeId === d.delegateId).map((s) => s.id));
  const coDelegates = await db.delegationAssignment.findMany({ where: { requestId: d.requestId, id: { not: d.id }, status: { not: "CANCELLED" } }, select: { delegate: { select: { fullName: true } }, status: true } });
  return {
    id: d.id,
    delegator: d.delegator,
    awayLabel: d.request.requestType.category === "OFFSITE" ? "Offsite duty" : "Time off",
    awayFrom: toISO(d.request.startDate),
    awayTo: toISO(d.request.endDate),
    requestStatus: d.request.status,
    coverageStart: toISO(d.coverageStart),
    coverageEnd: toISO(d.coverageEnd),
    handoverNotes: d.handoverNotes,
    tasks: d.tasks as { task: string; deadline?: string }[],
    attachment: d.attachment ? { id: d.attachment.id, name: d.attachment.originalName } : null,
    status: d.status,
    responseComment: d.responseComment,
    stepId: step?.status === "PENDING" ? step.id : null,
    awaitingClarification: step?.status === "CLARIFICATION_REQUESTED",
    coDelegates: coDelegates.map((c) => ({ name: c.delegate.fullName, status: c.status })),
    thread: (wf?.actions ?? []).filter((a) => a.stepId && myStepIds.has(a.stepId) && ["ACCEPT", "DECLINE", "REQUEST_CLARIFICATION", "CLARIFICATION_PROVIDED"].includes(a.action)).map((a) => ({ at: a.createdAt.toISOString(), actor: a.actor?.fullName ?? "", action: a.action, comment: a.comment })),
  };
}

export async function listMyRequests(employeeId: string) {
  return db.request.findMany({
    where: { employeeId },
    include: { requestType: true, delegations: { include: { delegate: { select: { fullName: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

export async function requestTypesForForm() {
  return db.requestType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
}

export async function balancesFor(employeeId: string, year: number) {
  const types = await db.requestType.findMany({ where: { isActive: true, deductsBalance: true }, orderBy: { sortOrder: "asc" } });
  return Promise.all(types.map(async (t) => ({ type: t, ...(await leaveBalance(db, employeeId, t.id, year))! })));
}

export type { RequestWithType };
export { formatDate };
