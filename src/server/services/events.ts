// Internal Calendar: events, participants, recurrence, audit, notifications, WFH conflicts and reminders.
// Employees, teams, departments and levels come from the existing directory — nothing is duplicated.
import type {
  EventAssignmentType,
  EventAttendance,
  EventLocationType,
  EventWfoRequirement,
  InternalEvent,
  Prisma,
  RecurrenceFreq,
} from "@prisma/client";
import { db, withTx, type DbOrTx, type Tx } from "../db";
import type { CurrentUser } from "../auth/session";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import {
  addDays,
  eachDate,
  formatDate,
  formatDateLong,
  formatTimeRange,
  fromISO,
  isValidISO,
  jakartaToUtc,
  monthEnd,
  monthStart,
  todayJakarta,
  toISO,
  utcToJakarta,
  type ISODate,
} from "@/lib/dates";
import { describeRule, expandOccurrences, validateRule, type RecurrenceRule } from "@/lib/engine/recurrence";
import { audit } from "./audit";
import { notify } from "./notifications";
import { effectiveOn, resolveApprover } from "./org";
import { eventPermissions, getGrants, visibilityFilter, type Grant } from "./calendar-access";
import { startWorkflow, cancelWorkflow, type Outcome } from "./workflow";
import { getHolidays } from "./calendar";
import { getSettings } from "./settings";
import { isHolidayEffective } from "@/lib/engine/working-days";
import { isoWeekday } from "@/lib/dates";
import type { ApprovalWorkflow } from "@prisma/client";

// ───────────────────────────── Input & validation ─────────────────────────────

export interface RuleInput {
  type: EventAssignmentType;
  targetId: string | null;
  dynamic: boolean;
}

export interface EventInput {
  title: string;
  categoryId: string;
  topic: string;
  description?: string | null;
  date: ISODate;
  startTime: string;
  endDate: ISODate;
  endTime: string;
  locationType: EventLocationType;
  locationDetail?: string | null;
  meetingUrl?: string | null;
  organizerId: string;
  attendanceRequirement: EventAttendance;
  wfoRequirement: EventWfoRequirement;
  reminderMinutes: number[];
  rules: RuleInput[];
  recurrence: RecurrenceRule;
  /** default false: never schedule on holidays / non-working days from Settings */
  allowOnOffDays?: boolean;
}

// ───────────────────────────── Holidays & off days ─────────────────────────────

export interface OffDay {
  label: string;
  kind: "HOLIDAY" | "CUTI_BERSAMA" | "COMPANY" | "WEEKEND";
}

/** Holidays (observed, incl. cuti bersama per setting) and non-working weekdays from Settings, by Jakarta date. */
export async function getOffDays(tx: DbOrTx, from: ISODate, to: ISODate): Promise<Record<ISODate, OffDay>> {
  const [settings, holidays] = await Promise.all([getSettings(tx), getHolidays(tx, from, to)]);
  const out: Record<ISODate, OffDay> = {};
  for (const d of eachDate(from, to)) if (!settings.workingWeekdays.includes(isoWeekday(d))) out[d] = { label: "Non-working day", kind: "WEEKEND" };
  for (const h of holidays) {
    if (!isHolidayEffective(h, settings.cutiBersamaIsHoliday)) continue;
    out[h.date] = { label: h.name, kind: h.type === "NATIONAL" ? "HOLIDAY" : h.type };
  }
  return out;
}

const offDayMessage = (date: ISODate, o: OffDay) => `${formatDate(date)} is ${o.kind === "WEEKEND" ? "a non-working day" : `a holiday (${o.label})`}.`;

export type EditScope = "THIS" | "FOLLOWING" | "SERIES";

const SOURCE_PRIORITY: EventAssignmentType[] = ["EMPLOYEE", "TEAM", "DEPARTMENT", "LEVEL", "ALL"];

async function validateInput(tx: DbOrTx, input: EventInput, publishing: boolean) {
  const errs: string[] = [];
  if (input.title.trim().length < 3) errs.push("Event name is required (min. 3 characters).");
  if (input.topic.trim().length < 2) errs.push("Event topic is required.");
  if (!isValidISO(input.date) || !isValidISO(input.endDate)) errs.push("Enter valid dates.");
  const cat = await tx.internalEventCategory.findUnique({ where: { id: input.categoryId } });
  if (!cat?.isActive) errs.push("Choose an active category.");
  const org = await tx.employee.findUnique({ where: { id: input.organizerId } });
  if (!org?.isActive) errs.push("Choose an active organizer.");
  if (input.meetingUrl && !/^https:\/\/[^\s]+$/i.test(input.meetingUrl)) errs.push("Meeting link must be an https:// URL.");
  if ((input.locationType === "ONLINE" || input.locationType === "HYBRID") && publishing && !input.meetingUrl) errs.push("Online and hybrid events need a meeting link.");
  if ((input.locationType === "IN_OFFICE" || input.locationType === "EXTERNAL" || input.locationType === "HYBRID") && publishing && !input.locationDetail?.trim())
    errs.push("Add the meeting location.");
  if (input.locationType === "ONLINE" && input.wfoRequirement === "IN_OFFICE_REQUIRED") errs.push("An online-only event can't require in-office attendance.");
  if (input.reminderMinutes.length > 5 || input.reminderMinutes.some((m) => !Number.isInteger(m) || m < 5 || m > 10080)) errs.push("Reminders must be between 5 minutes and 7 days before the event (max. 5).");
  if (publishing && !input.rules.length) errs.push("Assign at least one participant group before publishing.");
  if (errs.length) throw invalid(errs[0], { errors: errs });
  const start = jakartaToUtc(input.date, input.startTime);
  const end = jakartaToUtc(input.endDate, input.endTime);
  if (end <= start) throw invalid("End must be after the start.");
  if (end.getTime() - start.getTime() > 14 * 86400_000) throw invalid("A single event can last at most 14 days.");
  const ruleErr = validateRule(input.date, input.recurrence);
  if (ruleErr) throw invalid(ruleErr);
  for (const r of input.rules) {
    if (r.type === "ALL") continue;
    if (!r.targetId) throw invalid("Every participant rule needs a target.");
    const exists =
      r.type === "DEPARTMENT"
        ? await tx.department.count({ where: { id: r.targetId } })
        : r.type === "TEAM"
          ? await tx.team.count({ where: { id: r.targetId } })
          : r.type === "LEVEL"
            ? await tx.employeeLevel.count({ where: { id: r.targetId } })
            : await tx.employee.count({ where: { id: r.targetId, isActive: true } });
    if (!exists) throw invalid("A participant rule points to a record that no longer exists.");
  }
  return { durationMs: end.getTime() - start.getTime() };
}

function dedupeRules(rules: RuleInput[]): RuleInput[] {
  const seen = new Map<string, RuleInput>();
  for (const r of rules) {
    const key = `${r.type}:${r.type === "ALL" ? "" : r.targetId}`;
    const prev = seen.get(key);
    seen.set(key, { type: r.type, targetId: r.type === "ALL" ? null : r.targetId, dynamic: (prev?.dynamic ?? false) || r.dynamic });
  }
  return [...seen.values()];
}

// ───────────────────────────── Participants ─────────────────────────────

/** Resolves rules to unique active employees (a person in several groups appears once, with the most specific source). */
export async function resolveParticipants(tx: DbOrTx, rules: { assignmentType?: EventAssignmentType; type?: EventAssignmentType; targetId: string | null }[]) {
  const today = todayJakarta();
  const out = new Map<string, EventAssignmentType>();
  const rank = (t: EventAssignmentType) => SOURCE_PRIORITY.indexOf(t);
  const add = (ids: string[], t: EventAssignmentType) => {
    for (const id of ids) if (!out.has(id) || rank(t) < rank(out.get(id)!)) out.set(id, t);
  };
  for (const r of rules) {
    const type = (r.assignmentType ?? r.type)!;
    let ids: string[] = [];
    if (type === "ALL") ids = (await tx.employee.findMany({ where: { isActive: true }, select: { id: true } })).map((e) => e.id);
    else if (type === "DEPARTMENT")
      ids = (
        await tx.employee.findMany({
          where: { isActive: true, OR: [{ departmentId: r.targetId }, { memberships: { some: { team: { departmentId: r.targetId! }, ...effectiveOn(today) } } }] },
          select: { id: true },
        })
      ).map((e) => e.id);
    else if (type === "TEAM")
      ids = (await tx.employee.findMany({ where: { isActive: true, memberships: { some: { teamId: r.targetId!, ...effectiveOn(today) } } }, select: { id: true } })).map((e) => e.id);
    else if (type === "LEVEL")
      ids = (await tx.employee.findMany({ where: { isActive: true, levelAssignments: { some: { levelId: r.targetId!, ...effectiveOn(today) } } }, select: { id: true } })).map((e) => e.id);
    else if (type === "EMPLOYEE") ids = (await tx.employee.findMany({ where: { id: r.targetId!, isActive: true }, select: { id: true } })).map((e) => e.id);
    add(ids, type);
  }
  return out;
}

export async function previewParticipants(user: CurrentUser, rules: RuleInput[]) {
  const map = await resolveParticipants(db, dedupeRules(rules));
  const today = todayJakarta();
  const people = await db.employee.findMany({
    where: { id: { in: [...map.keys()] } },
    select: { id: true, fullName: true, memberships: { where: { isPrimary: true, ...effectiveOn(today) }, select: { team: { select: { name: true } } } } },
    orderBy: { fullName: "asc" },
  });
  const teams = new Map<string, number>();
  for (const p of people) {
    const t = p.memberships[0]?.team.name ?? "No team";
    teams.set(t, (teams.get(t) ?? 0) + 1);
  }
  void user;
  return {
    count: people.length,
    names: people.slice(0, 60).map((p) => p.fullName),
    teams: [...teams.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

async function syncParticipants(tx: Tx, eventId: string, target: Map<string, EventAssignmentType>, onlyRemoveSources?: EventAssignmentType[]) {
  const current = await tx.internalEventParticipant.findMany({ where: { eventId } });
  const currentIds = new Set(current.map((p) => p.employeeId));
  const added = [...target.keys()].filter((id) => !currentIds.has(id));
  const removed = current.filter((p) => !target.has(p.employeeId) && (!onlyRemoveSources || onlyRemoveSources.includes(p.assignmentSource))).map((p) => p.employeeId);
  if (added.length) await tx.internalEventParticipant.createMany({ data: added.map((employeeId) => ({ eventId, employeeId, assignmentSource: target.get(employeeId)! })), skipDuplicates: true });
  if (removed.length) await tx.internalEventParticipant.deleteMany({ where: { eventId, employeeId: { in: removed } } });
  for (const p of current) {
    const src = target.get(p.employeeId);
    if (src && src !== p.assignmentSource) await tx.internalEventParticipant.update({ where: { id: p.id }, data: { assignmentSource: src } });
  }
  return { added, removed };
}

// ───────────────────────────── Snapshots & audit ─────────────────────────────

function snapshot(e: InternalEvent & { rules?: { assignmentType: EventAssignmentType; targetId: string | null; dynamicMembership: boolean }[] }) {
  return {
    title: e.title,
    categoryId: e.categoryId,
    topic: e.topic,
    description: e.description,
    startAt: e.startAt.toISOString(),
    endAt: e.endAt.toISOString(),
    locationType: e.locationType,
    locationDetail: e.locationDetail,
    meetingUrl: e.meetingUrl,
    organizerId: e.organizerId,
    attendanceRequirement: e.attendanceRequirement,
    wfoRequirement: e.wfoRequirement,
    reminderMinutes: e.reminderMinutes,
    status: e.status,
    rules: e.rules?.map((r) => ({ type: r.assignmentType, targetId: r.targetId, dynamic: r.dynamicMembership })),
  };
}

const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;

async function eventAudit(tx: Tx, eventId: string, action: string, actorId: string | null, prev: unknown, next: unknown) {
  await tx.internalEventAuditLog.create({ data: { eventId, action, changedById: actorId, previousValues: prev === undefined ? undefined : json(prev), newValues: next === undefined ? undefined : json(next) } });
}

// ───────────────────────────── Create ─────────────────────────────

function occurrenceTimes(date: ISODate, startTime: string, durationMs: number) {
  const startAt = jakartaToUtc(date, startTime);
  const endAt = new Date(startAt.getTime() + durationMs);
  return { startAt, endAt, localDate: fromISO(date), localEndDate: fromISO(utcToJakarta(new Date(endAt.getTime() - 1)).date) };
}

function eventData(input: EventInput) {
  return {
    title: input.title.trim(),
    categoryId: input.categoryId,
    topic: input.topic.trim(),
    description: input.description?.trim() || null,
    timezone: "Asia/Jakarta",
    locationType: input.locationType,
    locationDetail: input.locationDetail?.trim() || null,
    meetingUrl: input.meetingUrl?.trim() || null,
    organizerId: input.organizerId,
    attendanceRequirement: input.attendanceRequirement,
    wfoRequirement: input.wfoRequirement,
    reminderMinutes: [...new Set(input.reminderMinutes)].sort((a, b) => b - a),
    allowOnOffDays: !!input.allowOnOffDays,
  };
}

export async function createEvent(user: CurrentUser, raw: EventInput, publish: boolean) {
  const input = { ...raw, rules: dedupeRules(raw.rules) };
  const grants = await getGrants(user);
  const perms = await eventPermissions(user, { organizerId: input.organizerId, createdById: user.employeeId, rules: input.rules.map((r) => ({ assignmentType: r.type, targetId: r.targetId })) }, grants);
  if (!perms.canEdit) throw forbidden("You don't have calendar permission to create events for these participants.");
  return withTx(async (tx) => {
    const { durationMs } = await validateInput(tx, input, publish);
    const all = expandOccurrences(input.date, input.recurrence);
    const off = input.allowOnOffDays ? {} : await getOffDays(tx, all[0], all[all.length - 1]);
    const dates = all.filter((d) => !off[d]);
    const skipped = all.filter((d) => off[d]).map((d) => ({ date: d, label: off[d].label }));
    if (!dates.length)
      throw invalid(
        input.recurrence.freq === "NONE"
          ? `${offDayMessage(input.date, off[input.date])} Pick another date, or tick “Allow on holidays and off days”.`
          : "Every occurrence falls on a holiday or non-working day.",
      );
    const series =
      input.recurrence.freq !== "NONE"
        ? await tx.internalEventSeries.create({
            data: {
              freq: input.recurrence.freq as RecurrenceFreq,
              interval: input.recurrence.interval,
              byWeekdays: input.recurrence.byWeekdays,
              untilDate: fromISO(input.recurrence.untilDate),
              rule: describeRule(input.date, input.recurrence),
            },
          })
        : null;
    const participants = await resolveParticipants(tx, input.rules);
    const now = new Date();
    const ids: string[] = [];
    for (const date of dates) {
      const ev = await tx.internalEvent.create({
        data: {
          ...eventData(input),
          ...occurrenceTimes(date, input.startTime, durationMs),
          seriesId: series?.id ?? null,
          status: publish ? "PUBLISHED" : "DRAFT",
          publishedAt: publish ? now : null,
          createdById: user.employeeId,
          updatedById: user.employeeId,
          rules: { create: input.rules.map((r) => ({ assignmentType: r.type, targetId: r.targetId, dynamicMembership: r.dynamic })) },
          participants: { create: [...participants].map(([employeeId, assignmentSource]) => ({ employeeId, assignmentSource })) },
        },
        include: { rules: true },
      });
      ids.push(ev.id);
      if (publish) await eventAudit(tx, ev.id, "PUBLISHED", user.employeeId, undefined, snapshot(ev));
    }
    await audit(tx, { actorUserId: user.userId, action: publish ? "event.create_publish" : "event.create_draft", entityType: "InternalEvent", entityId: ids[0], metadata: { occurrences: ids.length, seriesId: series?.id } });
    if (publish) {
      await notifyParticipants(tx, ids[0], [...participants.keys()], user, "EVENT_PUBLISHED", series ? `${series.rule}` : null);
      await evaluateConflicts(tx, ids);
    }
    return { id: ids[0], occurrences: ids.length, seriesId: series?.id ?? null, skipped };
  });
}

// ───────────────────────────── Targets for scoped edits ─────────────────────────────

async function scopedTargets(tx: Tx, ev: InternalEvent, scope: EditScope) {
  if (!ev.seriesId || scope === "THIS") return [ev];
  const now = new Date();
  return tx.internalEvent.findMany({
    where: {
      seriesId: ev.seriesId,
      status: { not: "CANCELLED" },
      OR: [{ id: ev.id }, { isException: false, startAt: scope === "FOLLOWING" ? { gte: ev.startAt } : { gte: now } }],
    },
    orderBy: { startAt: "asc" },
  });
}

async function loadForAuth(tx: DbOrTx, id: string) {
  const ev = await tx.internalEvent.findUnique({ where: { id }, include: { rules: true, series: true } });
  if (!ev) throw notFound("Event");
  return ev;
}

// ───────────────────────────── Update ─────────────────────────────

export async function updateEvent(user: CurrentUser, eventId: string, raw: EventInput, scope: EditScope) {
  const input = { ...raw, rules: dedupeRules(raw.rules) };
  const grants = await getGrants(user);
  const existing = await loadForAuth(db, eventId);
  const before = await eventPermissions(user, existing, grants);
  const after = await eventPermissions(user, { organizerId: input.organizerId, createdById: existing.createdById, rules: input.rules.map((r) => ({ assignmentType: r.type, targetId: r.targetId })) }, grants);
  if (!before.canEdit || !after.canEdit) throw forbidden("You don't have permission to edit this event for these participants.");
  if (existing.status === "CANCELLED") throw badState("Cancelled events can't be edited. Duplicate it to create a new one.");
  return withTx(async (tx) => {
    const ev = await loadForAuth(tx, eventId);
    const publishing = ev.status === "PUBLISHED";
    const { durationMs } = await validateInput(tx, input, publishing);
    const targets = await scopedTargets(tx, ev, scope);
    const rulesChanged = JSON.stringify(ev.rules.map((r) => [r.assignmentType, r.targetId, r.dynamicMembership]).sort()) !== JSON.stringify(input.rules.map((r) => [r.type, r.targetId, r.dynamic]).sort());
    const participants = rulesChanged ? await resolveParticipants(tx, input.rules) : null;

    // Recurrence changes (series / following) regenerate occurrence dates from the edited occurrence onwards.
    const oldRule = ev.series ? { freq: ev.series.freq as RecurrenceRule["freq"], interval: ev.series.interval, byWeekdays: ev.series.byWeekdays, untilDate: toISO(ev.series.untilDate) } : null;
    const ruleChanged = scope !== "THIS" && !!oldRule && JSON.stringify(oldRule) !== JSON.stringify(input.recurrence);
    if (scope === "THIS" && ev.seriesId && input.recurrence.freq !== "NONE" && oldRule && JSON.stringify(oldRule) !== JSON.stringify(input.recurrence))
      throw invalid("To change how an event repeats, edit “this and following” or the entire series.");
    if (!ev.seriesId && input.recurrence.freq !== "NONE") throw invalid("A one-time event can't be turned into a series. Create a new recurring event instead.");

    if (!input.allowOnOffDays && (scope === "THIS" || !ev.seriesId)) {
      const o = (await getOffDays(tx, input.date, input.date))[input.date];
      if (o) throw invalid(`${offDayMessage(input.date, o)} Pick another date, or tick “Allow on holidays and off days”.`);
    }
    const affected = new Map<string, { timeChanged: boolean }>();
    const timeChangedIds: string[] = [];
    const touchedIds: string[] = [];
    const addedByEvent: string[] = [];

    let seriesId = ev.seriesId;
    let dates: ISODate[] | null = null;
    if (ruleChanged) {
      const from = scope === "FOLLOWING" ? toISO(ev.localDate) : [toISO(targets[0]?.localDate ?? ev.localDate), todayJakarta()].sort()[1];
      const generated = expandOccurrences(from, input.recurrence);
      const offGen = input.allowOnOffDays ? {} : await getOffDays(tx, generated[0], generated[generated.length - 1]);
      dates = generated.filter((d) => !offGen[d]);
      const s = await tx.internalEventSeries.create({
        data: { freq: input.recurrence.freq as RecurrenceFreq, interval: input.recurrence.interval, byWeekdays: input.recurrence.byWeekdays, untilDate: fromISO(input.recurrence.untilDate), rule: describeRule(from, input.recurrence) },
      });
      seriesId = s.id;
    }

    const apply = async (target: InternalEvent & { rules?: unknown }, date: ISODate) => {
      const full = await tx.internalEvent.findUniqueOrThrow({ where: { id: target.id }, include: { rules: true } });
      const times = occurrenceTimes(date, input.startTime, durationMs);
      const timeChanged = full.startAt.getTime() !== times.startAt.getTime() || full.endAt.getTime() !== times.endAt.getTime();
      const updated = await tx.internalEvent.update({
        where: { id: target.id },
        data: {
          ...eventData(input),
          ...times,
          seriesId,
          isException: scope === "THIS" && !!ev.seriesId ? true : full.isException,
          updatedById: user.employeeId,
          ...(rulesChanged ? { rules: { deleteMany: {}, create: input.rules.map((r) => ({ assignmentType: r.type, targetId: r.targetId, dynamicMembership: r.dynamic })) } } : {}),
        },
        include: { rules: true },
      });
      if (participants) {
        const { added } = await syncParticipants(tx, target.id, participants);
        addedByEvent.push(...added);
      }
      if (full.status === "PUBLISHED") await eventAudit(tx, target.id, scope === "THIS" ? "UPDATED" : `UPDATED_${scope}`, user.employeeId, snapshot(full), snapshot(updated));
      touchedIds.push(target.id);
      if (timeChanged) timeChangedIds.push(target.id);
      affected.set(target.id, { timeChanged });
    };

    if (dates) {
      const byDate = new Map(targets.map((t) => [toISO(t.localDate), t]));
      for (const date of dates) {
        const t = byDate.get(date);
        if (t) {
          await apply(t, date);
          byDate.delete(date);
        } else {
          // new occurrence created by the changed rule
          const created = await tx.internalEvent.create({
            data: {
              ...eventData(input),
              ...occurrenceTimes(date, input.startTime, durationMs),
              seriesId,
              status: ev.status,
              publishedAt: ev.status === "PUBLISHED" ? new Date() : null,
              createdById: ev.createdById,
              updatedById: user.employeeId,
              rules: { create: input.rules.map((r) => ({ assignmentType: r.type, targetId: r.targetId, dynamicMembership: r.dynamic })) },
              participants: { create: [...(participants ?? (await resolveParticipants(tx, input.rules)))].map(([employeeId, assignmentSource]) => ({ employeeId, assignmentSource })) },
            },
            include: { rules: true },
          });
          if (ev.status === "PUBLISHED") await eventAudit(tx, created.id, "CREATED_BY_SERIES_CHANGE", user.employeeId, undefined, snapshot(created));
          touchedIds.push(created.id);
        }
      }
      // occurrences no longer produced by the rule are cancelled (kept for history)
      for (const t of byDate.values()) {
        await tx.internalEvent.update({ where: { id: t.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Removed by a change to the recurrence", updatedById: user.employeeId } });
        if (t.status === "PUBLISHED") await eventAudit(tx, t.id, "CANCELLED_BY_SERIES_CHANGE", user.employeeId, { status: t.status }, { status: "CANCELLED" });
      }
    } else {
      for (const t of targets) {
        // THIS: the occurrence may move to another date; multi-target edits keep each occurrence's own date
        const date = t.id === ev.id ? input.date : toISO(t.localDate);
        await apply(t, date);
      }
    }

    await audit(tx, { actorUserId: user.userId, action: "event.update", entityType: "InternalEvent", entityId: eventId, metadata: { scope, occurrences: touchedIds.length, ruleChanged, rulesChanged } });
    // occurrences that now sit on a holiday / off day (e.g. "allow on off days" switched off) are cancelled
    await sweepEventsOnOffDays(tx, { eventIds: touchedIds, actor: user });
    if (publishing) {
      const parts = await tx.internalEventParticipant.findMany({ where: { eventId: { in: touchedIds } }, select: { employeeId: true } });
      const everyone = [...new Set(parts.map((p) => p.employeeId))];
      const added = new Set(addedByEvent);
      if (addedByEvent.length) await notifyParticipants(tx, ev.id, [...added], user, "EVENT_ADDED", null);
      if (timeChangedIds.length || ruleChanged)
        await notifyParticipants(tx, touchedIds[0], everyone.filter((id) => !added.has(id)), user, "EVENT_TIME_CHANGED", touchedIds.length > 1 ? `${touchedIds.length} occurrences updated` : null);
      await evaluateConflicts(tx, touchedIds);
    }
    return { id: touchedIds.includes(eventId) ? eventId : touchedIds[0], occurrences: touchedIds.length };
  });
}

// ───────────────────────────── Publish / cancel / delete / refresh ─────────────────────────────

export async function publishEvent(user: CurrentUser, eventId: string, scope: EditScope = "SERIES") {
  const ev = await loadForAuth(db, eventId);
  if (!(await eventPermissions(user, ev)).canEdit) throw forbidden();
  if (ev.status !== "DRAFT") throw badState("Only drafts can be published.");
  return withTx(async (tx) => {
    const targets = (ev.seriesId && scope !== "THIS" ? await tx.internalEvent.findMany({ where: { seriesId: ev.seriesId, status: "DRAFT" }, include: { rules: true } }) : [await tx.internalEvent.findUniqueOrThrow({ where: { id: ev.id }, include: { rules: true } })]);
    const sample = targets[0];
    await validateInput(
      tx,
      {
        ...sample,
        description: sample.description,
        date: toISO(sample.localDate),
        startTime: utcToJakarta(sample.startAt).time,
        endDate: utcToJakarta(sample.endAt).date,
        endTime: utcToJakarta(sample.endAt).time,
        rules: sample.rules.map((r) => ({ type: r.assignmentType, targetId: r.targetId, dynamic: r.dynamicMembership })),
        recurrence: { freq: "NONE", interval: 1, byWeekdays: [], untilDate: toISO(sample.localDate) },
      },
      true,
    );
    const now = new Date();
    for (const t of targets) {
      // drafts keep a snapshot of participants from the time of saving; refresh it on publish
      await syncParticipants(tx, t.id, await resolveParticipants(tx, t.rules));
      const updated = await tx.internalEvent.update({ where: { id: t.id }, data: { status: "PUBLISHED", publishedAt: now, updatedById: user.employeeId }, include: { rules: true } });
      await eventAudit(tx, t.id, "PUBLISHED", user.employeeId, { status: "DRAFT" }, snapshot(updated));
    }
    const ids = targets.map((t) => t.id);
    const parts = await tx.internalEventParticipant.findMany({ where: { eventId: { in: ids } }, select: { employeeId: true } });
    await notifyParticipants(tx, ids[0], [...new Set(parts.map((p) => p.employeeId))], user, "EVENT_PUBLISHED", ev.series?.rule ?? null);
    await evaluateConflicts(tx, ids);
    await audit(tx, { actorUserId: user.userId, action: "event.publish", entityType: "InternalEvent", entityId: eventId, metadata: { occurrences: ids.length } });
    return { published: ids.length };
  });
}

export async function cancelEvent(user: CurrentUser, eventId: string, scope: EditScope, reason: string) {
  const ev = await loadForAuth(db, eventId);
  if (!(await eventPermissions(user, ev)).canManage) throw forbidden("Only calendar managers or the event creator can cancel events.");
  if (ev.status === "CANCELLED") throw conflict("This event is already cancelled.");
  if (ev.status === "DRAFT") throw badState("Drafts are deleted, not cancelled.");
  if (reason.trim().length < 3) throw invalid("Give a short reason for the cancellation.");
  return withTx(async (tx) => {
    const targets = (await scopedTargets(tx, ev, scope)).filter((t) => t.status === "PUBLISHED");
    const now = new Date();
    for (const t of targets) {
      await tx.internalEvent.update({ where: { id: t.id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason.trim(), updatedById: user.employeeId } });
      await eventAudit(tx, t.id, "CANCELLED", user.employeeId, { status: t.status }, { status: "CANCELLED", reason: reason.trim() });
      // pending conflict exceptions are no longer needed
      const pending = await tx.internalEventConflictException.findMany({ where: { eventId: t.id, status: "PENDING" } });
      for (const p of pending) {
        await tx.internalEventConflictException.update({ where: { id: p.id }, data: { status: "CANCELLED", decidedAt: now } });
        const wf = await tx.approvalWorkflow.findFirst({ where: { subjectType: "EVENT_EXCEPTION", subjectId: p.id, status: "PENDING" } });
        if (wf) await cancelWorkflow(tx, wf.id, user.employeeId, "Event cancelled");
      }
    }
    const ids = targets.map((t) => t.id);
    const parts = await tx.internalEventParticipant.findMany({ where: { eventId: { in: ids } }, select: { employeeId: true } });
    if (ids.length) await notifyParticipants(tx, ids[0], [...new Set(parts.map((p) => p.employeeId))], user, "EVENT_CANCELLED", `${ids.length > 1 ? `${ids.length} occurrences · ` : ""}${reason.trim()}`);
    await audit(tx, { actorUserId: user.userId, action: "event.cancel", entityType: "InternalEvent", entityId: eventId, metadata: { scope, occurrences: ids.length, reason } });
    return { cancelled: ids.length };
  });
}

export async function deleteDraft(user: CurrentUser, eventId: string, scope: EditScope = "SERIES") {
  const ev = await loadForAuth(db, eventId);
  const perms = await eventPermissions(user, ev);
  if (!(perms.canManage || (perms.canEdit && ev.createdById === user.employeeId))) throw forbidden();
  if (ev.status !== "DRAFT") throw badState("Only drafts can be deleted. Published events are cancelled so their history is kept.");
  return withTx(async (tx) => {
    const where = ev.seriesId && scope !== "THIS" ? { seriesId: ev.seriesId, status: "DRAFT" as const } : { id: ev.id };
    const n = await tx.internalEvent.deleteMany({ where });
    await audit(tx, { actorUserId: user.userId, action: "event.delete_draft", entityType: "InternalEvent", entityId: eventId, before: snapshot({ ...ev, rules: ev.rules }), metadata: { deleted: n.count } });
    return { deleted: n.count };
  });
}

/** Re-resolves the participant snapshot from the assignment rules (e.g. after team changes). */
export async function refreshParticipants(user: CurrentUser, eventId: string, scope: EditScope = "SERIES") {
  const ev = await loadForAuth(db, eventId);
  if (!(await eventPermissions(user, ev)).canManage) throw forbidden("Only calendar managers or the event creator can refresh participants.");
  if (ev.status === "CANCELLED") throw badState("Cancelled events can't be refreshed.");
  return withTx(async (tx) => {
    const targets = await scopedTargets(tx, ev, scope);
    let added = 0,
      removed = 0;
    const newPeople = new Set<string>();
    for (const t of targets) {
      const rules = await tx.internalEventAssignmentRule.findMany({ where: { eventId: t.id } });
      const r = await syncParticipants(tx, t.id, await resolveParticipants(tx, rules));
      added += r.added.length;
      removed += r.removed.length;
      r.added.forEach((id) => newPeople.add(id));
      if (t.status === "PUBLISHED" && (r.added.length || r.removed.length)) await eventAudit(tx, t.id, "PARTICIPANTS_REFRESHED", user.employeeId, { removed: r.removed }, { added: r.added });
    }
    if (ev.status === "PUBLISHED" && newPeople.size) {
      await notifyParticipants(tx, ev.id, [...newPeople], user, "EVENT_ADDED", null);
      await evaluateConflicts(tx, targets.map((t) => t.id));
    }
    return { added, removed, occurrences: targets.length };
  });
}

/** Daily job: participants from rules marked "dynamic membership" follow team/department changes automatically. */
export async function refreshDynamicParticipants() {
  const events = await db.internalEvent.findMany({ where: { status: "PUBLISHED", endAt: { gte: new Date() }, rules: { some: { dynamicMembership: true } } }, include: { rules: true } });
  let added = 0;
  for (const ev of events) {
    await withTx(async (tx) => {
      const dynamicTypes = [...new Set(ev.rules.filter((r) => r.dynamicMembership).map((r) => r.assignmentType))];
      const r = await syncParticipants(tx, ev.id, await resolveParticipants(tx, ev.rules), dynamicTypes);
      if (r.added.length) {
        added += r.added.length;
        await eventAudit(tx, ev.id, "DYNAMIC_MEMBERSHIP_SYNC", null, { removed: r.removed }, { added: r.added });
        await notifyParticipants(tx, ev.id, r.added, null, "EVENT_ADDED", null);
        await evaluateConflicts(tx, [ev.id]);
      }
    });
  }
  return { events: events.length, added };
}

// ───────────────────────────── Notifications ─────────────────────────────

type EventNotice = "EVENT_PUBLISHED" | "EVENT_ADDED" | "EVENT_TIME_CHANGED" | "EVENT_CANCELLED";

/** One notification per person per operation — recurring series never produce one notification per occurrence. */
async function notifyParticipants(tx: DbOrTx, eventId: string, employeeIds: string[], actor: CurrentUser | null, kind: EventNotice, extra: string | null) {
  if (!employeeIds.length) return;
  const ev = await tx.internalEvent.findUniqueOrThrow({ where: { id: eventId } });
  const when = `${formatDateLong(toISO(ev.localDate))}, ${formatTimeRange(ev.startAt, ev.endAt)} WIB`;
  const req = ev.attendanceRequirement === "MANDATORY" ? (ev.wfoRequirement === "IN_OFFICE_REQUIRED" ? "Mandatory · in office" : "Mandatory") : "Optional";
  const title = {
    EVENT_PUBLISHED: `New event: ${ev.title}`,
    EVENT_ADDED: `You've been added to ${ev.title}`,
    EVENT_TIME_CHANGED: `Event updated: ${ev.title}`,
    EVENT_CANCELLED: `Event cancelled: ${ev.title}`,
  }[kind];
  const body = kind === "EVENT_CANCELLED" ? `${when}${extra ? ` — ${extra}` : ""}` : `${ev.topic} · ${when} · ${req}${extra ? ` · ${extra}` : ""}`;
  const stamp = Date.now();
  for (const employeeId of new Set(employeeIds)) {
    if (actor && employeeId === actor.employeeId && kind !== "EVENT_ADDED") continue;
    await notify(tx, { employeeId, type: kind, title, body, link: `/internal-calendar/events/${ev.id}`, dedupeKey: `${kind}:${ev.seriesId ?? ev.id}:${stamp}` });
  }
}

// ───────────────────────────── WFH conflicts ─────────────────────────────

export const isOfficeMandatory = (e: { attendanceRequirement: EventAttendance; wfoRequirement: EventWfoRequirement }) => e.attendanceRequirement === "MANDATORY" && e.wfoRequirement === "IN_OFFICE_REQUIRED";

export interface EventConflict {
  date: ISODate;
  mode: "WFH";
  event: { id: string; title: string; topic: string; startAt: string; endAt: string };
  exception: { id: string; status: string } | null;
}

/** Published mandatory in-office events the employee is assigned to, by Jakarta date. */
export async function officeEventsFor(tx: DbOrTx, employeeId: string, from: ISODate, to: ISODate) {
  return tx.internalEvent.findMany({
    where: {
      status: "PUBLISHED",
      attendanceRequirement: "MANDATORY",
      wfoRequirement: "IN_OFFICE_REQUIRED",
      localDate: { lte: fromISO(to) },
      localEndDate: { gte: fromISO(from) },
      participants: { some: { employeeId } },
    },
    orderBy: { startAt: "asc" },
  });
}

/** Dates in [from, to] where the employee is WFH but assigned to a mandatory in-office event. */
export async function findConflicts(tx: DbOrTx, employeeId: string, from: ISODate, to: ISODate, modes: Partial<Record<ISODate, string | null>>): Promise<EventConflict[]> {
  const events = await officeEventsFor(tx, employeeId, from, to);
  if (!events.length) return [];
  const exceptions = await tx.internalEventConflictException.findMany({ where: { employeeId, eventId: { in: events.map((e) => e.id) }, status: { in: ["PENDING", "APPROVED"] } } });
  const out: EventConflict[] = [];
  for (const e of events) {
    for (const date of eachDate(toISO(e.localDate), toISO(e.localEndDate))) {
      // past days can't be changed any more, so they are not reported as actionable conflicts
      if (date < from || date > to || date < todayJakarta() || modes[date] !== "WFH") continue;
      const ex = exceptions.find((x) => x.eventId === e.id && toISO(x.date) === date);
      out.push({ date, mode: "WFH", event: { id: e.id, title: e.title, topic: e.topic, startAt: e.startAt.toISOString(), endAt: e.endAt.toISOString() }, exception: ex ? { id: ex.id, status: ex.status } : null });
    }
  }
  return out;
}

/** Office-required event dates the planner should keep as WFO. */
export async function officeEventDates(tx: DbOrTx, employeeId: string, year: number, month: number) {
  const events = await officeEventsFor(tx, employeeId, monthStart(year, month), monthEnd(year, month));
  return [...new Set(events.flatMap((e) => eachDate(toISO(e.localDate), toISO(e.localEndDate))))].filter((d) => d >= monthStart(year, month) && d <= monthEnd(year, month));
}

/**
 * After an event is published/changed: participants whose schedule has WFH on that date are notified.
 * Approved schedules are never changed automatically — the notification points to a revision request.
 */
export async function evaluateConflicts(tx: DbOrTx, eventIds: string[]) {
  const events = await tx.internalEvent.findMany({ where: { id: { in: eventIds }, status: "PUBLISHED", attendanceRequirement: "MANDATORY", wfoRequirement: "IN_OFFICE_REQUIRED" }, include: { participants: true }, orderBy: { startAt: "asc" } });
  // group per person and series so a recurring event produces one notification, not one per date
  const groups = new Map<string, { employeeId: string; title: string; key: string; dates: ISODate[]; approved: boolean; times: string }>();
  for (const e of events) {
    for (const date of eachDate(toISO(e.localDate), toISO(e.localEndDate))) {
      if (date < todayJakarta()) continue;
      const y = Number(date.slice(0, 4)),
        m = Number(date.slice(5, 7));
      const days = await tx.scheduleDay.findMany({
        where: { date: fromISO(date), schedule: { year: y, month: m, employeeId: { in: e.participants.map((p) => p.employeeId) } } },
        include: { schedule: { select: { employeeId: true, status: true } } },
      });
      for (const d of days) {
        const approved = ["APPROVED", "REVISION_PENDING"].includes(d.schedule.status);
        const mode = approved ? d.approvedMode : d.plannedMode;
        if (mode !== "WFH") continue;
        const ex = await tx.internalEventConflictException.count({ where: { eventId: e.id, employeeId: d.schedule.employeeId, date: fromISO(date), status: { in: ["PENDING", "APPROVED"] } } });
        if (ex) continue;
        const key = `${d.schedule.employeeId}:${e.seriesId ?? e.id}`;
        const g = groups.get(key) ?? { employeeId: d.schedule.employeeId, title: e.title, key: e.seriesId ?? e.id, dates: [], approved: false, times: formatTimeRange(e.startAt, e.endAt) };
        g.dates.push(date);
        g.approved ||= approved;
        groups.set(key, g);
      }
    }
  }
  for (const g of groups.values()) {
    const when = g.dates.length === 1 ? `on ${formatDate(g.dates[0])} (${g.times} WIB)` : `on ${g.dates.length} dates: ${g.dates.map((d) => formatDate(d)).join(", ")}`;
    await notify(tx, {
      employeeId: g.employeeId,
      type: "EVENT_CONFLICT",
      title: `Schedule conflict: ${g.title}`,
      body: `You are assigned to a mandatory in-office event ${when}, but your ${g.approved ? "approved" : "draft"} plan says WFH. ${g.approved ? "Request a revision to WFO or an exception." : "Change the day(s) to WFO or request an exception."}`,
      link: `/calendar?month=${g.dates[0].slice(0, 7)}`,
      dedupeKey: `event-conflict:${g.key}:${g.dates.join(",")}`,
    });
  }
  return groups.size;
}

// ───────────────────────────── Conflict exceptions (leader approval) ─────────────────────────────

export async function requestConflictException(user: CurrentUser, input: { eventId: string; date: ISODate; reason: string }) {
  if (input.reason.trim().length < 10) throw invalid("Explain why you need to stay WFH (at least 10 characters).");
  return withTx(async (tx) => {
    const ev = await tx.internalEvent.findUnique({ where: { id: input.eventId }, include: { participants: { where: { employeeId: user.employeeId } } } });
    if (!ev || ev.status !== "PUBLISHED") throw notFound("Event");
    if (!ev.participants.length) throw forbidden("You are not assigned to this event.");
    if (!isOfficeMandatory(ev)) throw badState("Only mandatory in-office events need an exception.");
    if (!eachDate(toISO(ev.localDate), toISO(ev.localEndDate)).includes(input.date)) throw invalid("That date is not part of the event.");
    const existing = await tx.internalEventConflictException.findFirst({ where: { eventId: ev.id, employeeId: user.employeeId, date: fromISO(input.date), status: { in: ["PENDING", "APPROVED"] } } });
    if (existing) throw conflict(existing.status === "APPROVED" ? "An exception is already approved for this date." : "An exception request is already pending.");
    const ex = await tx.internalEventConflictException.create({ data: { eventId: ev.id, employeeId: user.employeeId, date: fromISO(input.date), reason: input.reason.trim() } });
    const leader = await resolveApprover(tx, user.employeeId);
    await startWorkflow(tx, { subjectType: "EVENT_EXCEPTION", subjectId: ex.id, requesterId: user.employeeId, steps: [{ kind: "LEADER", assigneeId: leader.assigneeId }], actorEmployeeId: user.employeeId, comment: input.reason });
    await notify(tx, {
      employeeId: leader.assigneeId,
      type: "REQUEST_PENDING",
      title: `${user.fullName} asks to stay WFH during ${ev.title}`,
      body: `${formatDate(input.date)} · mandatory in-office event · “${input.reason.trim()}”`,
      link: "/approvals",
    });
    await audit(tx, { actorUserId: user.userId, action: "event.exception_request", entityType: "InternalEventConflictException", entityId: ex.id, after: input });
    return ex;
  });
}

export async function onEventExceptionWorkflow(tx: Tx, wf: ApprovalWorkflow, outcome: Outcome, actor: CurrentUser, comment?: string) {
  if (!["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(outcome)) return;
  const ex = await tx.internalEventConflictException.findUniqueOrThrow({ where: { id: wf.subjectId }, include: { event: true } });
  const status = outcome === "APPROVED" ? "APPROVED" : "REJECTED";
  await tx.internalEventConflictException.update({ where: { id: ex.id }, data: { status, decidedAt: new Date() } });
  await notify(tx, {
    employeeId: ex.employeeId,
    type: "REQUEST_APPROVED",
    title: `Exception ${status === "APPROVED" ? "approved" : "not approved"}: ${ex.event.title}`,
    body: `${formatDate(toISO(ex.date))}${comment ? ` — ${comment}` : ""}${status === "APPROVED" ? "" : " · Please plan this day as WFO."}`,
    link: `/calendar?month=${toISO(ex.date).slice(0, 7)}`,
  });
  void actor;
}

// ───────────────────────────── Reminders ─────────────────────────────

/** Sends due reminders (deduplicated per event, offset and person). Optionally limited to one employee. */
export async function sendDueReminders(now = new Date(), employeeId?: string) {
  const events = await db.internalEvent.findMany({
    where: { status: "PUBLISHED", startAt: { gt: now, lte: new Date(now.getTime() + 7 * 86400_000) }, NOT: { reminderMinutes: { isEmpty: true } }, ...(employeeId ? { participants: { some: { employeeId } } } : {}) },
    include: { participants: employeeId ? { where: { employeeId } } : true },
  });
  let sent = 0;
  for (const e of events) {
    const due = e.reminderMinutes.filter((m) => now.getTime() >= e.startAt.getTime() - m * 60_000);
    if (!due.length) continue;
    const m = Math.min(...due); // only the closest reminder that is due
    const label = m >= 1440 ? `in ${Math.round(m / 1440)} day(s)` : m >= 60 ? `in ${Math.round(m / 60)} hour(s)` : `in ${m} minutes`;
    for (const p of e.participants) {
      await notify(db, {
        employeeId: p.employeeId,
        type: "EVENT_REMINDER",
        title: `Reminder: ${e.title} ${label}`,
        body: `${e.topic} · ${formatDateLong(toISO(e.localDate))}, ${formatTimeRange(e.startAt, e.endAt)} WIB${e.locationDetail ? ` · ${e.locationDetail}` : ""}`,
        link: `/internal-calendar/events/${e.id}`,
        dedupeKey: `reminder:${e.id}:${m}`,
      });
      sent++;
    }
  }
  return { sent };
}

// ───────────────────────────── Holiday sweep ─────────────────────────────

/**
 * Cancels upcoming events that fall on a holiday or non-working day (unless the event allows off days).
 * Runs when holidays or working-day settings change, after edits, and in the daily job.
 * Cancelled occurrences stay in history; participants of published events are notified once per series.
 */
export async function sweepEventsOnOffDays(tx: DbOrTx, opts: { eventIds?: string[]; dates?: ISODate[]; actor?: CurrentUser | null } = {}) {
  const today = todayJakarta();
  const candidates = await tx.internalEvent.findMany({
    where: {
      status: { in: ["DRAFT", "PUBLISHED"] },
      allowOnOffDays: false,
      localDate: opts.dates ? { in: opts.dates.filter((d) => d >= today).map(fromISO) } : { gte: fromISO(today) },
      ...(opts.eventIds ? { id: { in: opts.eventIds } } : {}),
    },
    include: { participants: { select: { employeeId: true } } },
    orderBy: { startAt: "asc" },
  });
  if (!candidates.length) return { cancelled: 0 };
  const dates = candidates.map((c) => toISO(c.localDate)).sort();
  const off = await getOffDays(tx, dates[0], dates[dates.length - 1]);
  const now = new Date();
  const groups = new Map<string, { employeeId: string; title: string; eventId: string; dates: string[] }>();
  let cancelled = 0;
  for (const e of candidates) {
    const date = toISO(e.localDate);
    const o = off[date];
    if (!o) continue;
    const reason = `Falls on ${o.kind === "WEEKEND" ? "a non-working day" : o.label}`;
    await tx.internalEvent.update({ where: { id: e.id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: reason, updatedById: opts.actor?.employeeId ?? e.updatedById } });
    cancelled++;
    if (e.status !== "PUBLISHED") continue;
    await tx.internalEventAuditLog.create({ data: { eventId: e.id, action: "CANCELLED_OFF_DAY", changedById: opts.actor?.employeeId ?? null, previousValues: { status: "PUBLISHED" }, newValues: { status: "CANCELLED", reason } } });
    for (const p of e.participants) {
      const key = `${p.employeeId}:${e.seriesId ?? e.id}`;
      const g = groups.get(key) ?? { employeeId: p.employeeId, title: e.title, eventId: e.id, dates: [] };
      g.dates.push(`${formatDate(date)} (${o.label})`);
      groups.set(key, g);
    }
  }
  for (const g of groups.values())
    await notify(tx, {
      employeeId: g.employeeId,
      type: "EVENT_CANCELLED",
      title: `Event cancelled: ${g.title}`,
      body: `Not held on ${g.dates.join(", ")} — holiday or non-working day.`,
      link: `/internal-calendar/events/${g.eventId}`,
      dedupeKey: `offday:${g.eventId}:${g.dates.join(",")}`,
    });
  return { cancelled };
}

// ───────────────────────────── Read models ─────────────────────────────

export interface EventFilters {
  categoryId?: string;
  teamId?: string;
  departmentId?: string;
  organizerId?: string;
  participantId?: string;
  attendance?: EventAttendance;
  locationType?: EventLocationType;
  q?: string;
  mine?: boolean;
  includeCancelled?: boolean;
}

/** Events in [from, to] visible to the user (published for everyone; drafts for their editors). */
export async function listEvents(user: CurrentUser, from: ISODate, to: ISODate, f: EventFilters = {}, grants?: Grant[]) {
  const { seesAll, grants: gs } = await visibilityFilter(user, grants);
  const today = todayJakarta();
  const statusFilter: Prisma.InternalEventWhereInput = f.includeCancelled ? { status: { in: ["PUBLISHED", "CANCELLED"] } } : { status: "PUBLISHED" };
  const canDraft = gs.some((g) => g.role !== "VIEWER");
  const visibility: Prisma.InternalEventWhereInput[] = [
    seesAll ? statusFilter : { AND: [statusFilter, { OR: [{ participants: { some: { employeeId: user.employeeId } } }, { organizerId: user.employeeId }] }] },
  ];
  if (canDraft) visibility.push({ status: "DRAFT" });
  const teamMembers = f.teamId ? (await db.employeeTeamMembership.findMany({ where: { teamId: f.teamId, ...effectiveOn(today) }, select: { employeeId: true } })).map((m) => m.employeeId) : null;
  const events = await db.internalEvent.findMany({
    where: {
      localDate: { lte: fromISO(to) },
      localEndDate: { gte: fromISO(from) },
      OR: visibility,
      categoryId: f.categoryId || undefined,
      organizerId: f.organizerId || undefined,
      attendanceRequirement: f.attendance || undefined,
      locationType: f.locationType || undefined,
      ...(f.q ? { AND: [{ OR: [{ title: { contains: f.q, mode: "insensitive" } }, { topic: { contains: f.q, mode: "insensitive" } }] }] } : {}),
      participants:
        f.mine || f.participantId || teamMembers || f.departmentId
          ? {
              some: {
                employeeId: f.mine ? user.employeeId : f.participantId ? f.participantId : teamMembers ? { in: teamMembers } : undefined,
                ...(f.departmentId ? { employee: { departmentId: f.departmentId } } : {}),
              },
            }
          : undefined,
    },
    include: {
      category: true,
      organizer: { select: { id: true, fullName: true } },
      series: { select: { rule: true } },
      _count: { select: { participants: true } },
      participants: { where: { employeeId: user.employeeId }, select: { id: true } },
      rules: true,
    },
    orderBy: { startAt: "asc" },
    take: 1000,
  });
  // drafts are only shown to people who can edit them
  const out = [];
  for (const e of events) {
    if (e.status === "DRAFT" && !(await eventPermissions(user, e, gs)).canEdit) continue;
    out.push(e);
  }
  return out;
}
export type EventListItem = Awaited<ReturnType<typeof listEvents>>[number];

export function toChip(e: EventListItem) {
  return {
    id: e.id,
    title: e.title,
    topic: e.topic,
    color: e.category.color,
    category: e.category.name,
    date: toISO(e.localDate),
    endDate: toISO(e.localEndDate),
    time: formatTimeRange(e.startAt, e.endAt),
    status: e.status,
    attendance: e.attendanceRequirement,
    wfo: e.wfoRequirement,
    locationType: e.locationType,
    organizer: e.organizer.fullName,
    participants: e._count.participants,
    mine: e.participants.length > 0,
    recurring: !!e.series,
  };
}
export type EventChip = ReturnType<typeof toChip>;

export async function getEventDetail(user: CurrentUser, id: string) {
  const grants = await getGrants(user);
  const e = await db.internalEvent.findUnique({
    where: { id },
    include: {
      category: true,
      organizer: { select: { id: true, fullName: true, jobTitle: true } },
      createdBy: { select: { fullName: true } },
      series: true,
      rules: true,
      participants: { include: { employee: { select: { id: true, fullName: true, memberships: { where: { isPrimary: true, ...effectiveOn(todayJakarta()) }, select: { team: { select: { name: true } } } } } } }, orderBy: { employee: { fullName: "asc" } } },
    },
  });
  if (!e) throw notFound("Event");
  const perms = await eventPermissions(user, e, grants);
  const isParticipant = e.participants.some((p) => p.employeeId === user.employeeId);
  if (e.status === "DRAFT" && !perms.canEdit) throw notFound("Event");
  const { seesAll } = await visibilityFilter(user, grants);
  if (!seesAll && !isParticipant && e.organizerId !== user.employeeId && !perms.canEdit) throw forbidden("This event is only visible to its participants.");
  const ruleLabels = await describeRules(e.rules);
  const history = perms.canEdit
    ? await db.internalEventAuditLog.findMany({ where: { eventId: e.id }, include: { changedBy: { select: { fullName: true } } }, orderBy: { createdAt: "desc" }, take: 30 })
    : [];
  const myException = isParticipant ? await db.internalEventConflictException.findFirst({ where: { eventId: e.id, employeeId: user.employeeId }, orderBy: { createdAt: "desc" } }) : null;
  const start = utcToJakarta(e.startAt),
    end = utcToJakarta(e.endAt);
  return {
    id: e.id,
    seriesId: e.seriesId,
    isException: e.isException,
    title: e.title,
    topic: e.topic,
    description: e.description,
    category: { id: e.category.id, name: e.category.name, color: e.category.color },
    status: e.status,
    cancelReason: e.cancelReason,
    date: start.date,
    endDate: end.date,
    startTime: start.time,
    endTime: end.time,
    timeLabel: `${formatDateLong(start.date)} · ${formatTimeRange(e.startAt, e.endAt)} WIB`,
    locationType: e.locationType,
    locationDetail: e.locationDetail,
    meetingUrl: e.meetingUrl,
    organizer: e.organizer,
    createdBy: e.createdBy.fullName,
    attendanceRequirement: e.attendanceRequirement,
    wfoRequirement: e.wfoRequirement,
    reminderMinutes: e.reminderMinutes,
    allowOnOffDays: e.allowOnOffDays,
    recurrence: e.series ? { rule: e.series.rule, freq: e.series.freq, interval: e.series.interval, byWeekdays: e.series.byWeekdays, untilDate: toISO(e.series.untilDate) } : null,
    rules: e.rules.map((r, i) => ({ type: r.assignmentType, targetId: r.targetId, dynamic: r.dynamicMembership, label: ruleLabels[i] })),
    participants: e.participants.map((p) => ({ id: p.employee.id, name: p.employee.fullName, team: p.employee.memberships[0]?.team.name ?? null, source: p.assignmentSource, status: p.attendanceStatus })),
    isParticipant,
    myException: myException ? { status: myException.status, date: toISO(myException.date) } : null,
    perms,
    history: history.map((h) => ({ at: h.createdAt.toISOString(), action: h.action, by: h.changedBy?.fullName ?? "System" })),
  };
}
export type EventDetail = Awaited<ReturnType<typeof getEventDetail>>;

export async function describeRules(rules: { assignmentType: EventAssignmentType; targetId: string | null; dynamicMembership: boolean }[]) {
  const labels: string[] = [];
  for (const r of rules) {
    const dyn = r.dynamicMembership ? " (dynamic)" : "";
    if (r.assignmentType === "ALL") labels.push("All employees" + dyn);
    else if (r.assignmentType === "DEPARTMENT") labels.push(`Department: ${(await db.department.findUnique({ where: { id: r.targetId! } }))?.name ?? "—"}${dyn}`);
    else if (r.assignmentType === "TEAM") labels.push(`Team: ${(await db.team.findUnique({ where: { id: r.targetId! } }))?.name ?? "—"}${dyn}`);
    else if (r.assignmentType === "LEVEL") labels.push(`Level: ${(await db.employeeLevel.findUnique({ where: { id: r.targetId! } }))?.name ?? "—"}${dyn}`);
    else labels.push((await db.employee.findUnique({ where: { id: r.targetId! } }))?.fullName ?? "—");
  }
  return labels;
}

/** Events assigned to an employee in a date range (published only) — used by My Work Calendar and Overview. */
export async function eventsForEmployee(employeeId: string, from: ISODate, to: ISODate, tx: DbOrTx = db) {
  return tx.internalEvent.findMany({
    where: { status: "PUBLISHED", localDate: { lte: fromISO(to) }, localEndDate: { gte: fromISO(from) }, participants: { some: { employeeId } } },
    include: { category: true, organizer: { select: { fullName: true } } },
    orderBy: { startAt: "asc" },
  });
}

/** ICS export (RFC 5545) for one event. */
export function toIcs(e: EventDetail) {
  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (m) => `\\${m}`);
  const start = jakartaToUtc(e.date, e.startTime).toISOString();
  const end = jakartaToUtc(e.endDate, e.endTime).toISOString();
  const location = [e.locationDetail, e.meetingUrl].filter(Boolean).join(" · ");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//MIL Digital//HYBRID Internal Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${e.id}@hybrid.mildigital.id`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)} — ${esc(e.topic)}`,
    `DESCRIPTION:${esc(`${e.description ?? ""}\n\nOrganizer: ${e.organizer.fullName}\n${e.attendanceRequirement === "MANDATORY" ? "Mandatory" : "Optional"}`)}`,
    location ? `LOCATION:${esc(location)}` : "",
    e.status === "CANCELLED" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}

export { addDays };
