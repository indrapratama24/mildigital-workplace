// Office schedule: while the WFO Policy is off, the Super Admin sets the WFO days (company-wide, optionally
// per team) and every employee's calendar follows it. Employees can still ask for changes: WFH → WFO is
// applied at once, WFO → WFH goes to their leader. A later office schedule change on a date replaces the
// employee's own change for that date. Past days are frozen so editing the schedule never rewrites history.
import type { Prisma } from "@/generated/prisma/client";
import { db, withTx, type DbOrTx, type Tx } from "../db";
import { addDays, addMonths, currentMonthJakarta, eachDate, formatDate, formatMonth, fromISO, isoWeekday, monthEnd, monthStart, todayJakarta, toISO, WEEKDAY_SHORT, type ISODate } from "@/lib/dates";
import { officeResolver, type OfficeConfig, type OfficeDayInfo, type OfficeMode } from "@/lib/engine/office";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { badState, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getHolidays, loadMonthContexts } from "./calendar";
import { notify } from "./notifications";
import { getSettings, type AppSettings } from "./settings";
import { cancelWorkflow } from "./workflow";

export type { OfficeDayInfo };

function need(actor: CurrentUser) {
  if (!can(actor, "policy.manage")) throw forbidden();
}

export async function loadOfficeConfig(tx: DbOrTx, from: ISODate, to: ISODate, settings?: Pick<AppSettings, "officeWfoWeekdays">): Promise<OfficeConfig> {
  const [s, patterns, overrides] = await Promise.all([
    settings ?? getSettings(tx),
    tx.teamOfficePattern.findMany(),
    tx.officeDay.findMany({ where: { date: { gte: fromISO(from), lte: fromISO(to) } } }),
  ]);
  return {
    companyWeekdays: s.officeWfoWeekdays,
    teamWeekdays: Object.fromEntries(patterns.map((p) => [p.teamId, p.wfoWeekdays])),
    overrides: overrides.map((o) => ({ teamId: o.teamId, date: toISO(o.date), mode: o.mode as OfficeMode, note: o.note })),
  };
}

/** Primary team of each employee on each date (effective-dated memberships). */
async function primaryTeams(tx: DbOrTx, employeeIds: string[], from: ISODate, to: ISODate) {
  const rows = await tx.employeeTeamMembership.findMany({
    where: { employeeId: { in: employeeIds }, isPrimary: true, effectiveFrom: { lte: fromISO(to) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: fromISO(from) } }] },
    orderBy: { effectiveFrom: "desc" },
  });
  return (employeeId: string, date: ISODate): string | null =>
    rows.find((r) => r.employeeId === employeeId && toISO(r.effectiveFrom) <= date && (!r.effectiveTo || toISO(r.effectiveTo) >= date))?.teamId ?? null;
}

/** Office schedule for each employee on every date in the range. */
export async function officeDaysFor(tx: DbOrTx, employeeIds: string[], from: ISODate, to: ISODate, settings?: Pick<AppSettings, "officeWfoWeekdays">) {
  const [cfg, teamOf] = await Promise.all([loadOfficeConfig(tx, from, to, settings), primaryTeams(tx, employeeIds, from, to)]);
  const resolve = officeResolver(cfg);
  const dates = eachDate(from, to);
  return new Map(employeeIds.map((id) => [id, Object.fromEntries(dates.map((d) => [d, resolve(teamOf(id, d), d)])) as Record<ISODate, OfficeDayInfo>]));
}

// ───────────────────────────── Employee schedules ─────────────────────────────

/**
 * Makes sure the employee has a schedule for the month that accepts changes. In office mode there is no
 * monthly plan to submit, so a draft or a plan still waiting for approval (left over from the WFO Policy) is closed as approved.
 */
export async function ensureOfficeSchedule(tx: Tx, employeeId: string, year: number, month: number) {
  const existing = await tx.monthlySchedule.findUnique({ where: { employeeId_year_month: { employeeId, year, month } } });
  if (!existing) return tx.monthlySchedule.create({ data: { employeeId, year, month, status: "APPROVED", approvedAt: new Date() } });
  if (existing.status === "APPROVED" || existing.status === "REVISION_PENDING") return existing;
  if (existing.status === "PENDING_LEADER_APPROVAL") {
    const wf = await tx.approvalWorkflow.findFirst({ where: { subjectType: "SCHEDULE", subjectId: existing.id, status: "PENDING" } });
    if (wf) await cancelWorkflow(tx, wf.id, employeeId, "The WFO Policy is off: the office schedule applies");
  }
  return tx.monthlySchedule.update({ where: { id: existing.id }, data: { status: "APPROVED", approvedAt: new Date(), lastComment: null } });
}

/**
 * Freezes every day up to `through` with the mode it has now, for the month containing `through` and the
 * month before. Run before the office schedule changes and daily, so later edits only reach today onwards.
 */
export async function freezePastDays(tx: Tx, through: ISODate) {
  const settings = await getSettings(tx);
  const ids = (await tx.employee.findMany({ where: { isActive: true }, select: { id: true } })).map((e) => e.id);
  const cur = { year: Number(through.slice(0, 4)), month: Number(through.slice(5, 7)) };
  let frozen = 0;
  for (const m of [addMonths(cur.year, cur.month, -1), cur]) {
    const ctxs = await loadMonthContexts(ids, m.year, m.month, tx);
    for (const ctx of ctxs.values()) {
      const stored = new Map((ctx.schedule?.days ?? []).map((d) => [toISO(d.date), d]));
      const dates = (ctx.requirement?.days ?? []).filter((d) => d.plannable && d.date <= through && ctx.approvedModes[d.date] && !stored.get(d.date)?.frozen).map((d) => d.date);
      if (!dates.length) continue;
      // Under the WFO Policy only official (approved) days are kept; drafts stay drafts.
      if (settings.wfoPolicyEnabled && !ctx.schedule) continue;
      const schedule = ctx.schedule ?? (await ensureOfficeSchedule(tx, ctx.employeeId, m.year, m.month));
      for (const date of dates) {
        const mode = ctx.approvedModes[date]!;
        await tx.scheduleDay.upsert({
          where: { scheduleId_date: { scheduleId: schedule.id, date: fromISO(date) } },
          create: { scheduleId: schedule.id, date: fromISO(date), plannedMode: mode, approvedMode: mode, frozen: true },
          update: { plannedMode: mode, approvedMode: mode, frozen: true },
        });
        frozen++;
      }
    }
  }
  return frozen;
}

/**
 * Saves the office schedule as each employee's approved plan for this month and next, so turning the WFO
 * Policy back on starts from what people were following (they can revise it from there).
 */
async function keepOfficeAsPlans(tx: Tx) {
  const ids = (await tx.employee.findMany({ where: { isActive: true }, select: { id: true } })).map((e) => e.id);
  const cur = currentMonthJakarta();
  for (const m of [cur, addMonths(cur.year, cur.month, 1)]) {
    const ctxs = await loadMonthContexts(ids, m.year, m.month, tx);
    for (const ctx of ctxs.values()) {
      const schedule = await ensureOfficeSchedule(tx, ctx.employeeId, m.year, m.month);
      for (const [date, mode] of Object.entries(ctx.approvedModes))
        if (mode)
          await tx.scheduleDay.upsert({
            where: { scheduleId_date: { scheduleId: schedule.id, date: fromISO(date) } },
            create: { scheduleId: schedule.id, date: fromISO(date), plannedMode: mode, approvedMode: mode },
            update: { plannedMode: mode, approvedMode: mode },
          });
    }
  }
}

// ───────────────────────────── Super Admin: schedule management ─────────────────────────────

const HORIZON_MONTHS = 12;
/** Office schedule edits are reconciled up to the end of this month next year. */
function horizonEnd() {
  const c = currentMonthJakarta();
  const end = addMonths(c.year, c.month, HORIZON_MONTHS);
  return monthEnd(end.year, end.month);
}

/** Dates the Super Admin set explicitly (for the company, or for one team). */
interface ExplicitDates {
  teamId: string | null;
  dates: ISODate[];
}

/**
 * After an office schedule change: drops employees' own changes on dates the Super Admin set explicitly or
 * whose office mode changed (the office schedule wins) and tells the employees whose days changed. Only dates
 * from today on are touched.
 */
async function reconcile(tx: Tx, actor: CurrentUser, before: OfficeConfig, after: OfficeConfig, summary: string, officeMode: boolean, explicit?: ExplicitDates) {
  const today = todayJakarta();
  const until = horizonEnd();
  const employees = await tx.employee.findMany({ where: { isActive: true }, select: { id: true } });
  const ids = employees.map((e) => e.id);
  const teamOf = await primaryTeams(tx, ids, today, until);
  const was = officeResolver(before),
    now = officeResolver(after);
  const differs = (id: string, date: ISODate) => {
    const a = was(teamOf(id, date), date),
      b = now(teamOf(id, date), date);
    return a.mode !== b.mode || a.note !== b.note;
  };

  const explicitDates = new Set(explicit?.dates ?? []);
  const setFor = (id: string, date: ISODate) => explicitDates.has(date) && (!explicit!.teamId || teamOf(id, date) === explicit!.teamId);

  // The office schedule replaces the employee's own change on a date it sets or changes.
  const personal = await tx.scheduleDay.findMany({ where: { personal: true, date: { gte: fromISO(today) }, schedule: { employeeId: { in: ids } } }, include: { schedule: { select: { employeeId: true } } } });
  const replaced = personal.filter((d) => {
    const date = toISO(d.date),
      id = d.schedule.employeeId;
    return setFor(id, date) || was(teamOf(id, date), date).mode !== now(teamOf(id, date), date).mode;
  });
  const replacedOn = new Set(replaced.map((d) => `${d.schedule.employeeId}|${toISO(d.date)}`));
  if (replaced.length) await tx.scheduleDay.updateMany({ where: { id: { in: replaced.map((d) => d.id) } }, data: { personal: false, note: null } });

  if (!officeMode) return { replaced: replaced.length, notified: 0 };
  // Only the dates that changed for that employee (working weekdays in the horizon) are reported.
  const settings = await getSettings(tx);
  const holidays = new Set((await getHolidays(tx, today, until)).filter((h) => h.isObserved).map((h) => h.date));
  const dates = eachDate(today, until).filter((d) => settings.workingWeekdays.includes(isoWeekday(d)) && !holidays.has(d));
  let notified = 0;
  for (const id of ids) {
    const changed = dates.filter((d) => differs(id, d) || replacedOn.has(`${id}|${d}`));
    if (!changed.length) continue;
    const shown = changed.slice(0, 5).map((d) => `${formatDate(d)} → ${now(teamOf(id, d), d).mode}${now(teamOf(id, d), d).note ? ` (${now(teamOf(id, d), d).note})` : ""}`);
    await notify(tx, {
      employeeId: id,
      type: "OFFICE_SCHEDULE_CHANGED",
      title: "The office schedule changed",
      body: `${summary}. ${shown.join(", ")}${changed.length > 5 ? ` and ${changed.length - 5} more day(s)` : ""}.`,
      link: `/calendar?month=${changed[0].slice(0, 7)}`,
    });
    notified++;
  }
  await audit(tx, { actorUserId: actor.userId, action: "office.reconcile", entityType: "OfficeSchedule", entityId: "global", metadata: { summary, replaced: replaced.length, notified } });
  return { replaced: replaced.length, notified };
}

async function withReconcile<T extends object>(actor: CurrentUser, change: (tx: Tx) => Promise<T>, summary: (r: T) => string) {
  return withTx(async (tx) => {
    const settings = await getSettings(tx);
    const officeMode = !settings.wfoPolicyEnabled;
    const today = todayJakarta();
    if (officeMode) await freezePastDays(tx, addDays(today, -1));
    const before = await loadOfficeConfig(tx, today, horizonEnd());
    const result = await change(tx);
    const after = await loadOfficeConfig(tx, today, horizonEnd());
    const effect = await reconcile(tx, actor, before, after, summary(result), officeMode, (result as { explicit?: ExplicitDates }).explicit);
    return { ...result, ...effect };
  });
}

function checkWeekdays(days: number[], settings: AppSettings) {
  const bad = days.filter((d) => !settings.workingWeekdays.includes(d));
  if (bad.length) throw invalid(`${bad.map((d) => WEEKDAY_SHORT[d]).join(", ")} is not a working day.`);
  return [...new Set(days)].sort();
}

/** Weekly WFO days for the company (teamId null) or a team; `null` makes the team follow the company again. */
export async function setOfficePattern(actor: CurrentUser, input: { teamId: string | null; wfoWeekdays: number[] | null }) {
  need(actor);
  return withReconcile(
    actor,
    async (tx) => {
      const settings = await getSettings(tx);
      const days = input.wfoWeekdays ? checkWeekdays(input.wfoWeekdays, settings) : null;
      const label = days ? (days.length ? days.map((d) => WEEKDAY_SHORT[d]).join(", ") : "none (all WFH)") : "same as the company";
      if (!input.teamId) {
        if (!days) throw invalid("Choose the company's weekly office days.");
        await tx.systemSetting.upsert({ where: { key: "officeWfoWeekdays" }, create: { key: "officeWfoWeekdays", value: days, updatedById: actor.userId }, update: { value: days, updatedById: actor.userId } });
        await audit(tx, { actorUserId: actor.userId, action: "office.pattern", entityType: "OfficeSchedule", entityId: "company", before: settings.officeWfoWeekdays, after: days });
        return { teamName: null as string | null, label };
      }
      const team = await tx.team.findUnique({ where: { id: input.teamId } });
      if (!team) throw notFound("Team");
      const before = await tx.teamOfficePattern.findUnique({ where: { teamId: team.id } });
      if (days) await tx.teamOfficePattern.upsert({ where: { teamId: team.id }, create: { teamId: team.id, wfoWeekdays: days, updatedById: actor.userId }, update: { wfoWeekdays: days, updatedById: actor.userId } });
      else await tx.teamOfficePattern.deleteMany({ where: { teamId: team.id } });
      await audit(tx, { actorUserId: actor.userId, action: "office.pattern", entityType: "OfficeSchedule", entityId: team.id, before: before?.wfoWeekdays ?? null, after: days });
      return { teamName: team.name as string | null, label };
    },
    (r) => `Weekly office days${r.teamName ? ` for ${r.teamName}` : ""}: ${r.label}`,
  );
}

/**
 * Sets the office mode (and note) for dates, for the company or a team. `mode: null` removes the dates'
 * override so they follow the weekly days again.
 */
export async function setOfficeDays(actor: CurrentUser, input: { teamId: string | null; dates: ISODate[]; mode: OfficeMode | null; note?: string | null }) {
  need(actor);
  const today = todayJakarta();
  const dates = [...new Set(input.dates)].sort();
  if (!dates.length) throw invalid("Select at least one date.");
  if (dates[0] < today) throw invalid("Past dates can't be changed.");
  const note = input.note?.trim() || null;
  return withReconcile(
    actor,
    async (tx) => {
      const team = input.teamId ? await tx.team.findUnique({ where: { id: input.teamId } }) : null;
      if (input.teamId && !team) throw notFound("Team");
      const scope = team ? team.name : "Company";
      const where = (date: ISODate): Prisma.OfficeDayWhereInput => ({ teamId: team?.id ?? null, date: fromISO(date) });
      for (const date of dates) {
        const existing = await tx.officeDay.findFirst({ where: where(date) });
        if (!input.mode) {
          if (existing) await tx.officeDay.delete({ where: { id: existing.id } });
        } else if (existing) await tx.officeDay.update({ where: { id: existing.id }, data: { mode: input.mode, note, updatedById: actor.userId } });
        else await tx.officeDay.create({ data: { teamId: team?.id ?? null, date: fromISO(date), mode: input.mode, note, updatedById: actor.userId } });
      }
      await audit(tx, { actorUserId: actor.userId, action: "office.days", entityType: "OfficeSchedule", entityId: team?.id ?? "company", after: { dates, mode: input.mode, note } });
      return { scope, mode: input.mode, explicit: { teamId: team?.id ?? null, dates } };
    },
    (r) => (r.mode ? `${r.scope}: ${r.mode}${note ? ` — ${note}` : ""}` : `${r.scope}: back to the usual weekly days`),
  );
}

/** Turns the WFO Policy on or off. Days before today keep what they were; the change applies from today. */
export async function setWfoPolicyEnabled(actor: CurrentUser, enabled: boolean) {
  if (!can(actor, "policy.manage") || !can(actor, "settings.manage")) throw forbidden();
  return withTx(async (tx) => {
    const settings = await getSettings(tx);
    if (settings.wfoPolicyEnabled === enabled) return { changed: false };
    if (!enabled && !settings.officeWfoWeekdays.length) {
      const any = await tx.officeDay.count({ where: { date: { gte: fromISO(todayJakarta()) } } });
      if (!any) throw badState("Set the company's weekly office days first, so calendars don't turn all WFH.");
    }
    // Keep the past as it was under the current mode before switching.
    await freezePastDays(tx, addDays(todayJakarta(), -1));
    if (enabled) await keepOfficeAsPlans(tx);
    await tx.systemSetting.upsert({ where: { key: "wfoPolicyEnabled" }, create: { key: "wfoPolicyEnabled", value: enabled, updatedById: actor.userId }, update: { value: enabled, updatedById: actor.userId } });
    await audit(tx, { actorUserId: actor.userId, action: enabled ? "wfoPolicy.enable" : "wfoPolicy.disable", entityType: "SystemSetting", entityId: "wfoPolicyEnabled", before: settings.wfoPolicyEnabled, after: enabled });
    return { changed: true };
  });
}

/** Month view of the office schedule for the company or one team (Settings → Office schedule). */
export async function officeScheduleView(year: number, month: number, teamId: string | null) {
  const from = monthStart(year, month),
    to = monthEnd(year, month);
  const [settings, cfg, holidays, teams] = await Promise.all([
    getSettings(),
    loadOfficeConfig(db, from, to),
    getHolidays(db, from, to),
    db.team.findMany({ where: { isActive: true }, include: { officePattern: true, department: { select: { name: true } } }, orderBy: { name: "asc" } }),
  ]);
  const resolve = officeResolver(cfg);
  const holidayOn = new Map(holidays.map((h) => [h.date, h]));
  const today = todayJakarta();
  const days = eachDate(from, to).map((date) => {
    const weekday = isoWeekday(date);
    const working = settings.workingWeekdays.includes(weekday);
    const h = holidayOn.get(date);
    const info = resolve(teamId, date);
    return {
      date,
      weekday,
      working,
      holiday: h && (h.isObserved && (h.type !== "CUTI_BERSAMA" || settings.cutiBersamaIsHoliday)) ? h.name : null,
      isPast: date < today,
      isToday: date === today,
      ...info,
      // Overrides set for this exact scope (a team view also shows company overrides, but they are edited in the company view).
      ownOverride: cfg.overrides.some((o) => o.date === date && o.teamId === teamId),
    };
  });
  return {
    year,
    month,
    teamId,
    settings: { wfoPolicyEnabled: settings.wfoPolicyEnabled, officeWfoWeekdays: settings.officeWfoWeekdays, workingWeekdays: settings.workingWeekdays },
    teams: teams.map((t) => ({ id: t.id, name: t.name, department: t.department.name, wfoWeekdays: t.officePattern?.wfoWeekdays ?? null })),
    days,
    label: formatMonth(year, month),
  };
}
export type OfficeScheduleView = Awaited<ReturnType<typeof officeScheduleView>>;
