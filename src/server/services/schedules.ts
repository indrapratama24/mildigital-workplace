import type { ApprovalWorkflow, Prisma, WorkMode } from "@prisma/client";
import { db, withTx, type Tx } from "../db";
import { addDays, currentMonthJakarta, formatDate, formatMonth, fromISO, monthEnd, monthStart, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { evaluateAttendance, evaluatePlan, generatePlan, type ModeMap, type WorkModeT } from "@/lib/engine/working-days";
import type { CurrentUser } from "../auth/session";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { loadMonthContext, pendingRevisionDates, type MonthContext } from "./calendar";
import { notify } from "./notifications";
import { assertCanViewEmployee, resolveApprover } from "./org";
import { startWorkflow, type Outcome } from "./workflow";
import { eventsForEmployee, findConflicts, isOfficeMandatory, officeEventDates } from "./events";
import { formatTimeRange, utcToJakarta } from "@/lib/dates";

export const EDITABLE_STATUSES = ["DRAFT", "CHANGES_REQUESTED", "REJECTED"] as const;
const isEditable = (s: string | undefined) => !s || (EDITABLE_STATUSES as readonly string[]).includes(s);

function isPastMonth(year: number, month: number) {
  const c = currentMonthJakarta();
  return year * 12 + month < c.year * 12 + c.month;
}

export function scheduleLink(year: number, month: number, employeeId?: string) {
  const m = `${year}-${String(month).padStart(2, "0")}`;
  return employeeId ? `/calendar?month=${m}&employee=${employeeId}` : `/calendar?month=${m}`;
}

// ───────────────────────────── Read model for the planner ─────────────────────────────

export async function getPlannerData(viewer: CurrentUser, employeeId: string, year: number, month: number, opts: { assignedApprover?: boolean } = {}) {
  if (!opts.assignedApprover) await assertCanViewEmployee(viewer, employeeId);
  const [employee, ctx] = await Promise.all([
    db.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, jobTitle: true, employeeCode: true } }),
    loadMonthContext(employeeId, year, month),
  ]);
  if (!employee) throw notFound("Employee");
  const today = todayJakarta();
  const req = ctx.requirement;
  const isSelf = viewer.employeeId === employeeId;
  const status = ctx.schedule?.status;
  const pendingByDate = new Map<ISODate, { toMode: WorkMode; revisionId: string }>();
  for (const r of ctx.pendingRevisions) for (const i of r.items) pendingByDate.set(toISO(i.date), { toMode: i.toMode, revisionId: r.id });
  const recByDate = new Map(ctx.records.map((r) => [toISO(r.date), r]));
  const pendingRequests = ctx.requests.filter((r) => r.status === "PENDING_DELEGATE" || r.status === "PENDING_LEADER");

  const days = (req?.days ?? []).map((d) => {
    const pendingReq = pendingRequests.find((r) => toISO(r.startDate) <= d.date && toISO(r.endDate) >= d.date);
    const rec = recByDate.get(d.date);
    const offsiteReq = ctx.requests.find((r) => r.status === "APPROVED" && r.requestType.category === "OFFSITE" && toISO(r.startDate) <= d.date && toISO(r.endDate) >= d.date);
    return {
      date: d.date,
      weekday: d.weekday,
      kind: d.kind,
      holidayName: d.holiday?.name ?? null,
      holidayType: d.holiday?.type ?? null,
      leave: d.leave ? { label: d.leave.label, portion: d.leave.portion, category: d.leave.category, typeCode: d.leave.typeCode } : null,
      offsiteLabel: offsiteReq?.requestType.name ?? null,
      pendingRequest: pendingReq ? { id: pendingReq.id, label: pendingReq.requestType.name, status: pendingReq.status } : null,
      mandatory: d.mandatory,
      waived: d.waived,
      plannable: d.plannable,
      planned: (ctx.plannedModes[d.date] ?? null) as WorkModeT | null,
      approved: (ctx.approvedModes[d.date] ?? null) as WorkModeT | null,
      pendingChange: pendingByDate.get(d.date) ?? null,
      attendance: rec ? { mode: rec.mode, verified: rec.verification === "VERIFIED", clockInAt: rec.clockInAt?.toISOString() ?? null } : null,
      isPast: d.date < today,
      isToday: d.date === today,
      events: [] as PlannerEvent[],
    };
  });


  const history = ctx.schedule ? await scheduleHistory(ctx.schedule.id) : [];
  // Internal Calendar events assigned to this employee (published only)
  const events = await eventsForEmployee(employeeId, monthStart(year, month), monthEnd(year, month));
  const eventDays = new Map<ISODate, PlannerEvent[]>();
  for (const e of events) {
    const first = utcToJakarta(e.startAt).date,
      last = toISO(e.localEndDate);
    for (let d = first; d <= last; d = addDays(d, 1)) {
      if (!eventDays.has(d)) eventDays.set(d, []);
      eventDays.get(d)!.push({
        id: e.id,
        title: e.title,
        topic: e.topic,
        color: e.category.color,
        time: formatTimeRange(e.startAt, e.endAt),
        attendance: e.attendanceRequirement,
        wfo: e.wfoRequirement,
        locationType: e.locationType,
        officeMandatory: isOfficeMandatory(e),
      });
    }
  }
  const displayModes = status === "APPROVED" || status === "REVISION_PENDING" ? ctx.approvedModes : ctx.plannedModes;
  const eventConflicts = await findConflicts(db, employeeId, monthStart(year, month), monthEnd(year, month), displayModes);
  const exceptions = await db.internalEventConflictException.findMany({
    where: { employeeId, date: { gte: fromISO(monthStart(year, month)), lte: fromISO(monthEnd(year, month)) }, status: { in: ["PENDING", "APPROVED"] } },
    select: { eventId: true, date: true, status: true },
  });
  for (const d of days) d.events = eventDays.get(d.date) ?? [];
  return {
    employee,
    year,
    month,
    today,
    isSelf,
    eventConflicts,
    eventExceptions: exceptions.map((x) => ({ eventId: x.eventId, date: toISO(x.date), status: x.status })),
    policy: ctx.policy
      ? {
          name: ctx.policy.version.policy.name,
          version: ctx.policy.version.version,
          source: ctx.policy.source,
          levelName: ctx.policy.levelName,
          wfoPercent: ctx.policy.version.wfoPercent,
          mandatoryWeekdays: ctx.policy.version.mandatoryWeekdays,
          evaluationPeriod: ctx.policy.version.evaluationPeriod,
          submissionDeadlineDay: ctx.policy.version.submissionDeadlineDay,
          requiresLeaderApproval: ctx.policy.version.requiresLeaderApproval,
          offsiteCountsAsWfo: ctx.policy.version.offsiteCountsAsWfo,
        }
      : null,
    requirement: req
      ? {
          baseScheduledDays: req.baseScheduledDays,
          holidayDays: req.holidayDays,
          eligibleWorkingDays: req.eligibleWorkingDays,
          fullLeaveDays: req.fullLeaveDays,
          offsiteDays: req.offsiteDays,
          attendanceEligibleDays: req.attendanceEligibleDays,
          percentMinimum: req.percentMinimum,
          mandatoryCount: req.mandatoryCount,
          effectiveMinimumWfo: req.effectiveMinimumWfo,
          maxWfhDays: req.maxWfhDays,
          effectiveWfoPercent: req.effectiveWfoPercent,
          targetPercent: req.targetPercent,
          offsiteCredit: req.offsiteCredit,
          warnings: req.warnings,
        }
      : null,
    days,
    schedule: ctx.schedule
      ? {
          id: ctx.schedule.id,
          status: ctx.schedule.status,
          submittedAt: ctx.schedule.submittedAt?.toISOString() ?? null,
          approvedAt: ctx.schedule.approvedAt?.toISOString() ?? null,
          lastComment: ctx.schedule.lastComment,
          currentVersion: ctx.schedule.currentVersion,
        }
      : null,
    draftEval: req ? evaluatePlan(req, ctx.plannedModes) : null,
    approvedEval: req && Object.keys(ctx.approvedModes).length ? evaluatePlan(req, ctx.approvedModes) : null,
    attendanceEval: req && Object.keys(ctx.approvedModes).length ? evaluateAttendance(req, ctx.approvedModes, attendanceInputs(ctx), today) : null,
    canEdit: isSelf && !!req && isEditable(status) && !isPastMonth(year, month),
    canRevise: isSelf && !!req && (status === "APPROVED" || status === "REVISION_PENDING") && monthEnd(year, month) >= today,
    pendingRevisions: ctx.pendingRevisions.map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, dates: r.items.map((i) => toISO(i.date)) })),
    history,
  };
}
export type PlannerData = Awaited<ReturnType<typeof getPlannerData>>;

export interface PlannerEvent {
  id: string;
  title: string;
  topic: string;
  color: string;
  time: string;
  attendance: "MANDATORY" | "OPTIONAL";
  wfo: "IN_OFFICE_REQUIRED" | "REMOTE_ALLOWED" | "NONE";
  locationType: "IN_OFFICE" | "ONLINE" | "HYBRID" | "EXTERNAL";
  officeMandatory: boolean;
}

export function attendanceInputs(ctx: MonthContext) {
  return ctx.records.map((r) => ({ date: toISO(r.date), mode: r.mode as WorkModeT, verified: r.verification === "VERIFIED" }));
}

export async function scheduleHistory(scheduleId: string) {
  const [versions, workflows] = await Promise.all([
    db.scheduleVersion.findMany({ where: { scheduleId }, orderBy: { version: "asc" } }),
    db.approvalWorkflow.findMany({
      where: { OR: [{ subjectType: "SCHEDULE", subjectId: scheduleId }, { subjectType: "REVISION", subjectId: { in: (await db.scheduleRevision.findMany({ where: { scheduleId }, select: { id: true } })).map((r) => r.id) } }] },
      include: { actions: { include: { actor: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } } },
    }),
  ]);
  const events = [
    ...versions.map((v) => ({ at: v.createdAt.toISOString(), kind: "version" as const, label: `Version ${v.version} · ${v.kind.replace(/_/g, " ").toLowerCase()}`, comment: v.note, actor: null as string | null, versionId: v.id })),
    ...workflows.flatMap((w) =>
      w.actions.map((a) => ({
        at: a.createdAt.toISOString(),
        kind: "action" as const,
        label: `${w.subjectType === "REVISION" ? "Revision" : "Schedule"} · ${a.action.replace(/_/g, " ").toLowerCase()}`,
        comment: a.comment,
        actor: a.actor?.fullName ?? "System",
        versionId: null,
      })),
    ),
  ];
  return events.sort((a, b) => (a.at < b.at ? -1 : 1));
}

// ───────────────────────────── Draft editing ─────────────────────────────

async function ensureSchedule(tx: Tx, ctx: MonthContext) {
  if (ctx.schedule) return ctx.schedule;
  return tx.monthlySchedule.create({
    data: { employeeId: ctx.employeeId, year: ctx.year, month: ctx.month, status: "DRAFT", policyVersionId: ctx.policy?.version.id },
    include: { days: true },
  });
}

function assertSelf(actor: CurrentUser, employeeId: string) {
  if (actor.employeeId !== employeeId) throw forbidden("Only the employee can edit their own work plan.");
}

function guardEditable(ctx: MonthContext) {
  if (!ctx.requirement || !ctx.policy) throw badState("No WFO policy is assigned to you for this month. Contact HR.");
  const status = ctx.schedule?.status;
  if (status === "APPROVED" || status === "REVISION_PENDING")
    throw badState("This schedule is approved and cannot be overwritten. Submit a revision request for the dates you want to change.");
  if (status === "PENDING_LEADER_APPROVAL" || status === "SUBMITTED") throw badState("This schedule is waiting for approval and is locked.");
  if (status === "SUPERSEDED") throw badState("This schedule version is superseded.");
  if (isPastMonth(ctx.year, ctx.month)) throw badState("Past months cannot be edited.");
}

export function validateDraftModes(ctx: MonthContext, modes: Record<ISODate, WorkModeT | null>) {
  const req = ctx.requirement!;
  const byDate = new Map(req.days.map((d) => [d.date, d]));
  const errors: string[] = [];
  for (const [date, mode] of Object.entries(modes)) {
    const d = byDate.get(date);
    if (!d) errors.push(`${date} is outside ${formatMonth(ctx.year, ctx.month)}.`);
    else if (!d.plannable) {
      if (mode) errors.push(`${date} is not a plannable working day.`);
    } else if (mode && mode !== "WFO" && mode !== "WFH") errors.push(`Invalid status for ${date}.`);
    else if (d.mandatory && mode === "WFH") errors.push(`${date} is a mandatory WFO day and is locked.`);
  }
  if (errors.length) throw invalid(errors[0], { errors });
}

/** Mandatory WFO days are always WFO in a draft — they are pre-filled, never left unplanned. */
async function lockMandatoryDays(tx: Tx, ctx: MonthContext, scheduleId: string) {
  for (const date of ctx.requirement?.mandatoryDates ?? []) {
    if (ctx.plannedModes[date] === "WFO") continue;
    const day = ctx.requirement!.days.find((d) => d.date === date);
    if (!day?.plannable) continue; // mandatory offsite days are already credited
    await tx.scheduleDay.upsert({
      where: { scheduleId_date: { scheduleId, date: fromISO(date) } },
      create: { scheduleId, date: fromISO(date), plannedMode: "WFO" },
      update: { plannedMode: "WFO" },
    });
    ctx.plannedModes[date] = "WFO";
  }
}

async function writeDraft(tx: Tx, scheduleId: string, modes: Record<ISODate, WorkModeT | null>) {
  for (const [date, mode] of Object.entries(modes)) {
    await tx.scheduleDay.upsert({
      where: { scheduleId_date: { scheduleId, date: fromISO(date) } },
      create: { scheduleId, date: fromISO(date), plannedMode: mode },
      update: { plannedMode: mode },
    });
  }
}

export async function saveDraft(actor: CurrentUser, input: { employeeId: string; year: number; month: number; modes: Record<ISODate, WorkModeT | null> }) {
  assertSelf(actor, input.employeeId);
  return withTx(async (tx) => {
    const ctx = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    guardEditable(ctx);
    validateDraftModes(ctx, input.modes);
    const schedule = await ensureSchedule(tx, ctx);
    await writeDraft(tx, schedule.id, input.modes);
    await lockMandatoryDays(tx, { ...ctx, plannedModes: { ...ctx.plannedModes, ...input.modes } }, schedule.id);
    // a draft always follows the currently applicable policy version
    await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { policyVersionId: ctx.policy!.version.id } });
    const after = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    return evaluatePlan(after.requirement!, after.plannedModes);
  });
}

export async function autoGenerateDraft(actor: CurrentUser, input: { employeeId: string; year: number; month: number; mode: "generate" | "balance" }) {
  assertSelf(actor, input.employeeId);
  return withTx(async (tx) => {
    const ctx = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    guardEditable(ctx);
    const seedWfo = input.mode === "balance" ? Object.entries(ctx.plannedModes).filter(([, m]) => m === "WFO").map(([d]) => d) : [];
    const eventDates = await officeEventDates(tx, input.employeeId, input.year, input.month);
    const plan = generatePlan(ctx.requirement!, { seedWfo, preferWfo: eventDates });
    const byDate = new Map(ctx.requirement!.days.map((d) => [d.date, d]));
    const warnings = eventDates
      .filter((d) => !byDate.get(d)?.plannable)
      .map((d) => `${formatDate(d)}: you're assigned to a mandatory in-office event but the day is ${byDate.get(d)?.kind === "LEAVE" ? "on approved leave" : byDate.get(d)?.kind === "HOLIDAY" ? "a holiday" : "not a working day"} — tell the organizer.`);
    const schedule = await ensureSchedule(tx, ctx);
    const modes: Record<ISODate, WorkModeT | null> = {};
    for (const d of ctx.requirement!.days) if (d.plannable) modes[d.date] = plan[d.date] ?? null;
    await writeDraft(tx, schedule.id, modes);
    await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { policyVersionId: ctx.policy!.version.id } });
    return { ...evaluatePlan(ctx.requirement!, modes), eventWarnings: warnings, eventDatesPrioritised: eventDates.filter((d) => byDate.get(d)?.plannable).length };
  });
}

export async function resetDraft(actor: CurrentUser, input: { employeeId: string; year: number; month: number }) {
  assertSelf(actor, input.employeeId);
  return withTx(async (tx) => {
    const ctx = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    guardEditable(ctx);
    if (ctx.schedule) {
      await tx.scheduleDay.updateMany({ where: { scheduleId: ctx.schedule.id }, data: { plannedMode: null } });
      await lockMandatoryDays(tx, { ...ctx, plannedModes: {} }, ctx.schedule.id);
    }
  });
}

// ───────────────────────────── Submission ─────────────────────────────

function snapshotDays(days: { date: Date; plannedMode: WorkMode | null; approvedMode: WorkMode | null }[]) {
  return days
    .map((d) => ({ date: toISO(d.date), planned: d.plannedMode, approved: d.approvedMode }))
    .sort((a, b) => (a.date < b.date ? -1 : 1)) as unknown as Prisma.InputJsonValue;
}

async function nextVersionNumber(tx: Tx, scheduleId: string) {
  const last = await tx.scheduleVersion.findFirst({ where: { scheduleId }, orderBy: { version: "desc" } });
  return (last?.version ?? 0) + 1;
}

export async function submitSchedule(actor: CurrentUser, input: { employeeId: string; year: number; month: number; note?: string }) {
  assertSelf(actor, input.employeeId);
  return withTx(async (tx) => {
    const ctx = await loadMonthContext(input.employeeId, input.year, input.month, tx);
    if (ctx.schedule?.status === "PENDING_LEADER_APPROVAL") throw conflict("This schedule has already been submitted and is awaiting approval.");
    guardEditable(ctx);
    const schedule = await ensureSchedule(tx, ctx);
    await lockMandatoryDays(tx, ctx, schedule.id);
    const ev = evaluatePlan(ctx.requirement!, ctx.plannedModes);
    if (!ev.complete) throw invalid(`Plan every working day before submitting (${ev.unplannedDates.length} day(s) left).`, { eval: ev });
    if (ev.missingMandatoryDates.length) throw invalid("All mandatory WFO days must be WFO.", { eval: ev });
    if (ev.shortfall > 0)
      throw invalid(`Your plan has ${ev.plannedWfo} WFO day(s); the minimum is ${ctx.requirement!.effectiveMinimumWfo}. Add ${ev.shortfall} more WFO day(s).`, { eval: ev });

    const conflicts = (await findConflicts(tx, input.employeeId, monthStart(input.year, input.month), monthEnd(input.year, input.month), ctx.plannedModes)).filter((c) => !c.exception);
    if (conflicts.length)
      throw invalid(
        `Schedule Conflict: you are assigned to a mandatory in-office event on ${conflicts.map((c) => `${formatDate(c.date)} (${c.event.title})`).join(", ")} but planned WFH. Change the date to WFO or request an exception.`,
        { eventConflicts: conflicts },
      );
    const policyVersionId = ctx.policy!.version.id;
    const days = await tx.scheduleDay.findMany({ where: { scheduleId: schedule.id } });
    const version = await nextVersionNumber(tx, schedule.id);
    await tx.scheduleVersion.create({ data: { scheduleId: schedule.id, version, kind: "SUBMITTED", days: snapshotDays(days), policyVersionId, actorId: actor.employeeId, note: input.note } });
    await audit(tx, { actorUserId: actor.userId, action: "schedule.submit", entityType: "MonthlySchedule", entityId: schedule.id, metadata: { year: input.year, month: input.month, eval: ev } });

    if (!ctx.policy!.version.requiresLeaderApproval) {
      await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { status: "SUBMITTED", submittedAt: new Date(), policyVersionId } });
      await applyScheduleApproval(tx, schedule.id, null, "Auto-approved: policy does not require leader approval");
      return { status: "APPROVED" as const };
    }
    const approver = await resolveApprover(tx, input.employeeId);
    await startWorkflow(tx, {
      subjectType: "SCHEDULE",
      subjectId: schedule.id,
      requesterId: input.employeeId,
      steps: [{ kind: "LEADER", assigneeId: approver.assigneeId }],
      actorEmployeeId: actor.employeeId,
      comment: input.note,
    });
    await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { status: "PENDING_LEADER_APPROVAL", submittedAt: new Date(), policyVersionId, lastComment: null } });
    await notify(tx, {
      employeeId: approver.assigneeId,
      type: "SCHEDULE_SUBMITTED",
      title: `${actor.fullName} submitted a ${formatMonth(input.year, input.month)} work plan`,
      body: `${ev.plannedWfo} WFO / ${ev.plannedWfh} WFH days (minimum ${ctx.requirement!.effectiveMinimumWfo} WFO). Routed to you as ${approver.reason.toLowerCase()}.`,
      link: "/approvals",
    });
    return { status: "PENDING_LEADER_APPROVAL" as const, approverReason: approver.reason };
  });
}

async function applyScheduleApproval(tx: Tx, scheduleId: string, approverId: string | null, note?: string) {
  const schedule = await tx.monthlySchedule.findUniqueOrThrow({ where: { id: scheduleId }, include: { days: true } });
  for (const d of schedule.days) {
    if (d.plannedMode !== d.approvedMode) await tx.scheduleDay.update({ where: { id: d.id }, data: { approvedMode: d.plannedMode } });
  }
  const days = await tx.scheduleDay.findMany({ where: { scheduleId } });
  const version = await nextVersionNumber(tx, scheduleId);
  await tx.scheduleVersion.create({ data: { scheduleId, version, kind: "APPROVED", days: snapshotDays(days), policyVersionId: schedule.policyVersionId, actorId: approverId, note } });
  await tx.monthlySchedule.update({ where: { id: scheduleId }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: approverId, currentVersion: version } });
  await notify(tx, {
    employeeId: schedule.employeeId,
    type: "SCHEDULE_APPROVED",
    title: `Your ${formatMonth(schedule.year, schedule.month)} work plan is approved`,
    body: note ?? "It is now your official planned schedule. Use revision requests for any changes.",
    link: scheduleLink(schedule.year, schedule.month),
  });
}

/** Called by approvals.ts inside the decision transaction. */
export async function onScheduleWorkflow(tx: Tx, wf: ApprovalWorkflow, outcome: Outcome, actor: CurrentUser, comment?: string) {
  const schedule = await tx.monthlySchedule.findUniqueOrThrow({ where: { id: wf.subjectId } });
  const label = formatMonth(schedule.year, schedule.month);
  if (outcome === "APPROVED") return applyScheduleApproval(tx, schedule.id, actor.employeeId, comment || undefined);
  if (outcome === "REJECTED" || outcome === "CHANGES_REQUESTED") {
    await tx.monthlySchedule.update({ where: { id: schedule.id }, data: { status: outcome, lastComment: comment } });
    await notify(tx, {
      employeeId: schedule.employeeId,
      type: outcome === "REJECTED" ? "SCHEDULE_REJECTED" : "SCHEDULE_CHANGES_REQUESTED",
      title: outcome === "REJECTED" ? `Your ${label} work plan was rejected` : `Changes requested on your ${label} work plan`,
      body: comment ?? "",
      link: scheduleLink(schedule.year, schedule.month),
    });
  }
}

export async function scheduleSummaryForApproval(scheduleId: string) {
  const s = await db.monthlySchedule.findUnique({ where: { id: scheduleId }, include: { employee: { select: { id: true, fullName: true, jobTitle: true } } } });
  if (!s) return null;
  const ctx = await loadMonthContext(s.employeeId, s.year, s.month);
  const ev = ctx.requirement ? evaluatePlan(ctx.requirement, ctx.plannedModes) : null;
  return { schedule: s, requirement: ctx.requirement, eval: ev, plannedModes: ctx.plannedModes as ModeMap, blocked: pendingRevisionDates(ctx) };
}
