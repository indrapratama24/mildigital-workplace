// Mid-month schedule revisions. Approved schedules are never overwritten directly: changes are
// proposed per date, evaluated against the policy, and applied only to the affected dates on approval.
import type { ApprovalWorkflow, Prisma, RevisionKind } from "@prisma/client";
import { db, withTx, type Tx } from "../db";
import { formatDate, formatMonth, fromISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { computeRevisionImpact, evaluatePlan, type ChangeInput, type ModeMap, type WorkModeT } from "@/lib/engine/working-days";
import type { CurrentUser } from "../auth/session";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { loadMonthContext, pendingRevisionDates } from "./calendar";
import { notify } from "./notifications";
import { resolveApprover, resolveHrApprover } from "./org";
import { scheduleLink } from "./schedules";
import { cancelWorkflow, startWorkflow, type Outcome, type StepSpec } from "./workflow";
import { findConflicts } from "./events";
import { monthEnd, monthStart } from "@/lib/dates";

export interface RevisionInput {
  employeeId: string;
  year: number;
  month: number;
  kind: RevisionKind;
  changes: ChangeInput[];
  reason: string;
  requestException?: boolean;
  idempotencyKey: string;
}

export async function previewRevision(actor: CurrentUser, input: Omit<RevisionInput, "reason" | "idempotencyKey" | "kind">) {
  if (actor.employeeId !== input.employeeId) throw forbidden();
  const ctx = await loadMonthContext(input.employeeId, input.year, input.month);
  if (!ctx.requirement) throw badState("No policy assigned for this month.");
  const impact = computeRevisionImpact(ctx.requirement, ctx.approvedModes, input.changes, todayJakarta(), pendingRevisionDates(ctx));
  return withEventConflicts(impact, input.employeeId, input.year, input.month, ctx.approvedModes, input.changes);
}

/** Adds mandatory in-office event conflicts created by the proposed changes; they require an authorised exception. */
async function withEventConflicts<T extends ReturnType<typeof computeRevisionImpact>>(impact: T, employeeId: string, year: number, month: number, approved: ModeMap, changes: ChangeInput[], tx: Tx | typeof db = db) {
  const after: ModeMap = { ...approved };
  for (const c of changes) after[c.date] = c.toMode;
  const changed = new Set(changes.map((c) => c.date));
  const eventConflicts = (await findConflicts(tx, employeeId, monthStart(year, month), monthEnd(year, month), after)).filter((c) => changed.has(c.date) && !c.exception);
  return { ...impact, eventConflicts, requiresException: impact.requiresException || eventConflicts.length > 0 };
}

export function describeChanges(changes: { date: ISODate; toMode: string; isReplacement?: boolean }[]) {
  return changes.map((c) => `${formatDate(c.date)} → ${c.toMode}${c.isReplacement ? " (replacement)" : ""}`).join(", ");
}

export async function createRevision(actor: CurrentUser, input: RevisionInput, txIn?: Tx) {
  if (actor.employeeId !== input.employeeId) throw forbidden("You can only request changes to your own schedule.");
  if (input.reason.trim().length < 10) throw invalid("Please explain the reason (at least 10 characters).");
  if (!input.changes.length) throw invalid("Select at least one date to change.");
  const run = async (tx: Tx) => {
    const existing = await tx.scheduleRevision.findUnique({ where: { employeeId_idempotencyKey: { employeeId: input.employeeId, idempotencyKey: input.idempotencyKey } } });
    if (existing) return existing; // idempotent re-submit
    const ctx = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    if (!ctx.schedule || !ctx.requirement || !ctx.policy) throw badState("There is no approved schedule for this month yet — edit your draft instead.");
    if (!["APPROVED", "REVISION_PENDING"].includes(ctx.schedule.status)) throw badState("Only approved schedules can be revised. Edit your draft instead.");
    const impact = await withEventConflicts(
      computeRevisionImpact(ctx.requirement, ctx.approvedModes, input.changes, todayJakarta(), pendingRevisionDates(ctx)),
      input.employeeId,
      input.year,
      input.month,
      ctx.approvedModes,
      input.changes,
      tx,
    );
    if (impact.invalid.length) throw invalid(`${formatDate(impact.invalid[0].date)}: ${impact.invalid[0].reason}`, { impact });
    if (impact.shortfall > 0 && !impact.requiresException)
      throw invalid(
        `Planned WFO would drop to ${impact.plannedWfoAfter}, below the minimum of ${impact.minimumRequired}. Add ${impact.replacementRequired} replacement WFO day(s) — suggested: ${impact.suggestions.map(formatDate).join(", ")}.`,
        { impact, needsReplacement: true },
      );
    if (impact.requiresException && !input.requestException)
      throw invalid(
        impact.eventConflicts.length
          ? `Schedule Conflict: you are assigned to a mandatory in-office event (${impact.eventConflicts.map((c) => `${c.event.title}, ${formatDate(c.date)}`).join("; ")}). Tick “Request an authorised exception” to send it for approval.`
          : impact.mandatoryViolations.length
          ? "This changes a mandatory WFO day. Tick “Request an authorised exception” to send it for exception approval."
          : "No replacement WFO date is available. Tick “Request an authorised exception” to send it for exception approval.",
        { impact, needsException: true },
      );

    const revision = await tx.scheduleRevision.create({
      data: {
        scheduleId: ctx.schedule.id,
        employeeId: input.employeeId,
        kind: input.kind,
        reason: input.reason.trim(),
        requiresException: impact.requiresException,
        impact: impact as unknown as Prisma.InputJsonValue,
        idempotencyKey: input.idempotencyKey,
        items: {
          create: input.changes.map((c) => ({
            date: fromISO(c.date),
            fromMode: (ctx.approvedModes[c.date] ?? null) as WorkModeT | null,
            toMode: c.toMode,
            isReplacement: !!c.isReplacement,
          })),
        },
      },
    });
    const leader = await resolveApprover(tx, input.employeeId);
    const steps: StepSpec[] = [{ kind: "LEADER", assigneeId: leader.assigneeId }];
    if (impact.requiresException && ctx.policy.version.exceptionsRequireHr)
      steps.push({ kind: "HR", assigneeId: await resolveHrApprover(tx, [input.employeeId, leader.assigneeId]) });
    await startWorkflow(tx, { subjectType: "REVISION", subjectId: revision.id, requesterId: input.employeeId, steps, actorEmployeeId: actor.employeeId, comment: input.reason });
    await tx.monthlySchedule.update({ where: { id: ctx.schedule.id }, data: { status: "REVISION_PENDING" } });
    await notify(tx, {
      employeeId: leader.assigneeId,
      type: "REVISION_SUBMITTED",
      title: `${actor.fullName} requested a schedule change`,
      body: `${describeChanges(input.changes)}. WFO ${impact.plannedWfoBefore} → ${impact.plannedWfoAfter} (min ${impact.minimumRequired})${impact.requiresException ? " · requires exception" : ""}.`,
      link: "/approvals",
    });
    await audit(tx, { actorUserId: actor.userId, action: "revision.create", entityType: "ScheduleRevision", entityId: revision.id, after: { ...input, impact } });
    return revision;
  };
  return txIn ? run(txIn) : withTx(run);
}

async function refreshScheduleStatus(tx: Tx, scheduleId: string) {
  const open = await tx.scheduleRevision.count({ where: { scheduleId, status: "PENDING" } });
  await tx.monthlySchedule.update({ where: { id: scheduleId }, data: { status: open ? "REVISION_PENDING" : "APPROVED" } });
}

export async function cancelRevision(actor: CurrentUser, revisionId: string) {
  return withTx(async (tx) => {
    const rev = await tx.scheduleRevision.findUnique({ where: { id: revisionId } });
    if (!rev) throw notFound("Revision");
    if (rev.employeeId !== actor.employeeId) throw forbidden();
    if (rev.status !== "PENDING") throw conflict("Only pending revisions can be cancelled.");
    await tx.scheduleRevision.update({ where: { id: rev.id }, data: { status: "CANCELLED", decidedAt: new Date() } });
    const wf = await tx.approvalWorkflow.findFirst({ where: { subjectType: "REVISION", subjectId: rev.id, status: "PENDING" } });
    if (wf) await cancelWorkflow(tx, wf.id, actor.employeeId, "Cancelled by requester");
    await refreshScheduleStatus(tx, rev.scheduleId);
  });
}

export async function onRevisionWorkflow(tx: Tx, wf: ApprovalWorkflow, outcome: Outcome, actor: CurrentUser, comment?: string) {
  const rev = await tx.scheduleRevision.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { items: true, schedule: true } });
  const { schedule } = rev;
  const link = scheduleLink(schedule.year, schedule.month);
  if (outcome === "APPROVED") {
    const ctx = await loadMonthContext(rev.employeeId, schedule.year, schedule.month, tx);
    const after: ModeMap = { ...ctx.approvedModes };
    for (const i of rev.items) {
      after[toISO(i.date)] = i.toMode;
      await tx.scheduleDay.upsert({
        where: { scheduleId_date: { scheduleId: schedule.id, date: i.date } },
        create: { scheduleId: schedule.id, date: i.date, plannedMode: i.toMode, approvedMode: i.toMode },
        update: { plannedMode: i.toMode, approvedMode: i.toMode },
      });
    }
    // Authorised exceptions are recorded explicitly — the employee is never silently marked compliant.
    if (rev.requiresException && ctx.requirement) {
      const mandatory = new Set(ctx.requirement.mandatoryDates);
      for (const i of rev.items) {
        if (mandatory.has(toISO(i.date)) && i.toMode !== "WFO")
          await tx.attendanceException.create({
            data: { employeeId: rev.employeeId, year: schedule.year, month: schedule.month, date: i.date, kind: "MANDATORY_DAY_WAIVER", days: 1, reason: rev.reason, approvedById: actor.employeeId, sourceType: "REVISION", sourceId: rev.id },
          });
      }
      // event conflicts approved through this revision become approved conflict exceptions
      const evConflicts = ((rev.impact as { eventConflicts?: { date: string; event: { id: string } }[] }).eventConflicts ?? []);
      for (const c of evConflicts)
        await tx.internalEventConflictException.create({
          data: { eventId: c.event.id, employeeId: rev.employeeId, date: fromISO(c.date), reason: `Approved via schedule revision: ${rev.reason}`, status: "APPROVED", decidedAt: new Date() },
        });
      const shortfall = Math.max(0, ctx.requirement.effectiveMinimumWfo - evaluatePlan(ctx.requirement, after).plannedWfo);
      if (shortfall > 0)
        await tx.attendanceException.create({
          data: { employeeId: rev.employeeId, year: schedule.year, month: schedule.month, kind: "WFO_REDUCTION", days: shortfall, reason: rev.reason, approvedById: actor.employeeId, sourceType: "REVISION", sourceId: rev.id },
        });
    }
    const days = await tx.scheduleDay.findMany({ where: { scheduleId: schedule.id } });
    const last = await tx.scheduleVersion.findFirst({ where: { scheduleId: schedule.id }, orderBy: { version: "desc" } });
    const version = (last?.version ?? 0) + 1;
    await tx.scheduleVersion.create({
      data: {
        scheduleId: schedule.id,
        version,
        kind: "REVISION_APPLIED",
        days: days.map((d) => ({ date: toISO(d.date), planned: d.plannedMode, approved: d.approvedMode })) as unknown as Prisma.InputJsonValue,
        policyVersionId: schedule.policyVersionId,
        actorId: actor.employeeId,
        note: `${describeChanges(rev.items.map((i) => ({ date: toISO(i.date), toMode: i.toMode, isReplacement: i.isReplacement })))}${comment ? ` — ${comment}` : ""}`,
      },
    });
    await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { currentVersion: version } });
    await tx.scheduleRevision.update({ where: { id: rev.id }, data: { status: "APPROVED", decidedAt: new Date() } });
  } else if (outcome === "REJECTED" || outcome === "CHANGES_REQUESTED") {
    await tx.scheduleRevision.update({ where: { id: rev.id }, data: { status: outcome, decidedAt: new Date() } });
  } else return;
  await refreshScheduleStatus(tx, schedule.id);
  await notify(tx, {
    employeeId: rev.employeeId,
    type: "REVISION_DECIDED",
    title: `Schedule change ${outcome === "APPROVED" ? "approved" : outcome === "REJECTED" ? "rejected" : "needs changes"} — ${formatMonth(schedule.year, schedule.month)}`,
    body: comment || describeChanges(rev.items.map((i) => ({ date: toISO(i.date), toMode: i.toMode, isReplacement: i.isReplacement }))),
    link,
  });
}

export async function listMyRevisions(employeeId: string) {
  return db.scheduleRevision.findMany({ where: { employeeId }, include: { items: { orderBy: { date: "asc" } }, schedule: true }, orderBy: { createdAt: "desc" }, take: 50 });
}
