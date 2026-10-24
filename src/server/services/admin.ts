// Administration: holidays, request types, departments/teams, levels, leave balances.
import type { HolidayType, Prisma, Requirement, RequestCategory, EmploymentStatus } from "@prisma/client";
import { db, withTx, type Tx } from "../db";
import { OVERRIDE_KEYS, parseLevelExceptions, type LevelException } from "@/lib/engine/request-rules";
import { fromISO, isValidISO, todayJakarta } from "@/lib/dates";
import type { CurrentUser } from "../auth/session";
import { can, type Permission } from "../authz";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { parseCsv, validateLeaderAssignment } from "./org";
import { sweepEventsOnOffDays } from "./events";

function need(actor: CurrentUser, p: Permission) {
  if (!can(actor, p)) throw forbidden();
}

// ───────────── Holidays ─────────────

async function defaultCalendar() {
  const cal = await db.holidayCalendar.findFirst({ where: { isDefault: true } });
  if (cal) return cal;
  return db.holidayCalendar.create({ data: { name: "Indonesia — MIL Digital", isDefault: true } });
}

export async function upsertHoliday(actor: CurrentUser, input: { id?: string; date: string; name: string; type: HolidayType; isObserved: boolean }) {
  need(actor, "holiday.manage");
  if (!isValidISO(input.date)) throw invalid("Invalid date.");
  if (input.name.trim().length < 3) throw invalid("Holiday name is required.");
  const cal = await defaultCalendar();
  return withTx(async (tx) => {
    const before = input.id ? await tx.holiday.findUnique({ where: { id: input.id } }) : null;
    const data = { date: fromISO(input.date), name: input.name.trim(), type: input.type, isObserved: input.isObserved, source: before?.source ?? "manual" };
    const h = input.id ? await tx.holiday.update({ where: { id: input.id }, data }) : await tx.holiday.create({ data: { ...data, calendarId: cal.id } });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "holiday.update" : "holiday.create", entityType: "Holiday", entityId: h.id, before, after: h });
    // internal events already planned on this date are cancelled automatically
    const swept = await sweepEventsOnOffDays(tx, { dates: [input.date], actor });
    return { ...h, eventsCancelled: swept.cancelled };
  });
}

export async function deleteHoliday(actor: CurrentUser, id: string) {
  need(actor, "holiday.manage");
  return withTx(async (tx) => {
    const h = await tx.holiday.findUnique({ where: { id } });
    if (!h) throw notFound("Holiday");
    await tx.holiday.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "holiday.delete", entityType: "Holiday", entityId: id, before: h });
  });
}

/** CSV columns: date (YYYY-MM-DD), name, type (NATIONAL|CUTI_BERSAMA|COMPANY). Existing date+name pairs are skipped. */
export async function importHolidaysCsv(actor: CurrentUser, text: string) {
  need(actor, "holiday.manage");
  const rows = parseCsv(text);
  const errors: string[] = [];
  const valid = rows.flatMap((r, i) => {
    const type = (r.type || "NATIONAL").toUpperCase();
    if (!isValidISO(r.date ?? "")) return errors.push(`Row ${i + 2}: invalid date`), [];
    if (!r.name) return errors.push(`Row ${i + 2}: missing name`), [];
    if (!["NATIONAL", "CUTI_BERSAMA", "COMPANY"].includes(type)) return errors.push(`Row ${i + 2}: invalid type`), [];
    return [{ date: r.date, name: r.name, type: type as HolidayType }];
  });
  if (errors.length) throw invalid(errors.slice(0, 5).join("; "), { errors });
  const cal = await defaultCalendar();
  return withTx(async (tx) => {
    const res = await tx.holiday.createMany({
      data: valid.map((v) => ({ calendarId: cal.id, date: fromISO(v.date), name: v.name, type: v.type, source: "csv-import" })),
      skipDuplicates: true,
    });
    await audit(tx, { actorUserId: actor.userId, action: "holiday.import", entityType: "HolidayCalendar", entityId: cal.id, metadata: { rows: valid.length, created: res.count } });
    const swept = await sweepEventsOnOffDays(tx, { dates: valid.map((v) => v.date), actor });
    return { created: res.count, skipped: valid.length - res.count, eventsCancelled: swept.cancelled };
  });
}

// ───────────── Request types ─────────────

export interface RequestTypeInput {
  id?: string;
  code: string;
  name: string;
  category: RequestCategory;
  description?: string;
  documentRequirement: Requirement;
  delegation: Requirement;
  reasonMinLength: number;
  advanceNoticeDays: number;
  allowHalfDay: boolean;
  allowHourly: boolean;
  deductsBalance: boolean;
  defaultEntitlement: number | null;
  monthlyAccrual: boolean;
  eligibleStatuses: EmploymentStatus[];
  annualRules: boolean;
  isSensitive: boolean;
  isActive: boolean;
  levelExceptions?: LevelException[];
}

export async function upsertRequestType(actor: CurrentUser, input: RequestTypeInput) {
  need(actor, "requestType.manage");
  if (!/^[A-Z0-9_]{2,30}$/.test(input.code)) throw invalid("Code must be 2–30 uppercase letters, digits or underscores.");
  if (input.reasonMinLength < 0 || input.reasonMinLength > 500) throw invalid("Reason length must be 0–500.");
  if (input.advanceNoticeDays < 0 || input.advanceNoticeDays > 90) throw invalid("Advance notice must be 0–90 days.");
  return withTx(async (tx) => {
    const before = input.id ? await tx.requestType.findUnique({ where: { id: input.id } }) : null;
    const { id, levelExceptions, ...rest } = input;
    const data = { ...rest, ...(levelExceptions && { levelExceptions: (await checkLevelExceptions(tx, levelExceptions)) as unknown as Prisma.InputJsonValue }) };
    const t = id ? await tx.requestType.update({ where: { id }, data }) : await tx.requestType.create({ data: { ...data, sortOrder: 50 } });
    await audit(tx, { actorUserId: actor.userId, action: id ? "requestType.update" : "requestType.create", entityType: "RequestType", entityId: t.id, before, after: t });
    return t;
  });
}

/** Validates per-level exceptions: named, real levels, each level in one exception only, sane values. */
async function checkLevelExceptions(tx: Tx, list: LevelException[]) {
  const levels = new Map((await tx.employeeLevel.findMany({ select: { id: true, name: true } })).map((l) => [l.id, l.name]));
  const seen = new Map<string, string>();
  return list.map((raw) => {
    const e = parseLevelExceptions([raw])[0];
    const name = (raw.name ?? "").trim();
    if (name.length < 2 || name.length > 60) throw invalid("Give each exception a name (2–60 characters), e.g. Leaders.");
    if (!e) throw invalid(`Choose at least one level for “${name}”.`);
    for (const id of e.levelIds) {
      if (!levels.has(id)) throw invalid(`“${name}” uses a level that no longer exists.`);
      if (seen.has(id)) throw invalid(`${levels.get(id)} is in both “${seen.get(id)}” and “${name}” — a level can only be in one exception.`);
      seen.set(id, name);
    }
    if (e.reasonMinLength != null && (e.reasonMinLength < 0 || e.reasonMinLength > 500)) throw invalid(`“${name}”: reason length must be 0–500.`);
    if (e.advanceNoticeDays != null && (e.advanceNoticeDays < 0 || e.advanceNoticeDays > 90)) throw invalid(`“${name}”: advance notice must be 0–90 days.`);
    if (e.defaultEntitlement != null && (e.defaultEntitlement < 0 || e.defaultEntitlement > 60)) throw invalid(`“${name}”: entitlement must be 0–60 days.`);
    if (!OVERRIDE_KEYS.some((k) => e[k] != null)) throw invalid(`“${name}” doesn't change any rule yet.`);
    return { ...e, name };
  });
}

export async function setLeaveBalance(actor: CurrentUser, input: { employeeId: string; requestTypeId: string; year: number; entitledDays: number; adjustedDays: number }) {
  need(actor, "requestType.manage");
  if (input.entitledDays < 0 || input.entitledDays > 60) throw invalid("Entitlement must be 0–60 days.");
  return withTx(async (tx) => {
    const key = { employeeId_requestTypeId_year: { employeeId: input.employeeId, requestTypeId: input.requestTypeId, year: input.year } };
    const before = await tx.leaveBalance.findUnique({ where: key });
    const b = await tx.leaveBalance.upsert({ where: key, create: input, update: { entitledDays: input.entitledDays, adjustedDays: input.adjustedDays } });
    await audit(tx, { actorUserId: actor.userId, action: "leaveBalance.set", entityType: "LeaveBalance", entityId: b.id, before, after: b });
    return b;
  });
}

// ───────────── Departments & teams ─────────────

export async function upsertDepartment(actor: CurrentUser, input: { id?: string; code: string; name: string }) {
  need(actor, "team.manage");
  if (!/^[A-Z0-9_]{2,20}$/.test(input.code)) throw invalid("Department code must be 2–20 uppercase characters.");
  return withTx(async (tx) => {
    const d = input.id
      ? await tx.department.update({ where: { id: input.id }, data: { code: input.code, name: input.name } })
      : await tx.department.create({ data: { code: input.code, name: input.name } });
    await audit(tx, { actorUserId: actor.userId, action: "department.upsert", entityType: "Department", entityId: d.id, after: d });
    return d;
  });
}

export async function upsertTeam(actor: CurrentUser, input: { id?: string; name: string; departmentId: string; leadId: string | null; backupApproverId: string | null; isActive: boolean }) {
  need(actor, "team.manage");
  if (input.name.trim().length < 2) throw invalid("Team name is required.");
  return withTx(async (tx) => {
    for (const id of [input.leadId, input.backupApproverId]) {
      if (!id) continue;
      const e = await tx.employee.findUnique({ where: { id }, include: { user: true } });
      if (!e?.isActive || !e.user || !["LEADER", "HR", "SUPER_ADMIN"].includes(e.user.role)) throw invalid("Team leads and backup approvers need a Leader/HR/Admin role.");
    }
    if (input.leadId && input.leadId === input.backupApproverId) throw invalid("The backup approver must differ from the team lead.");
    const before = input.id ? await tx.team.findUnique({ where: { id: input.id } }) : null;
    const data = { name: input.name.trim(), departmentId: input.departmentId, leadId: input.leadId, backupApproverId: input.backupApproverId, isActive: input.isActive };
    const t = input.id ? await tx.team.update({ where: { id: input.id }, data }) : await tx.team.create({ data });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "team.update" : "team.create", entityType: "Team", entityId: t.id, before, after: t });
    return t;
  });
}

// ───────────── Levels ─────────────

export async function updateLevel(actor: CurrentUser, input: { id: string; name: string; description: string | null; policyId: string }) {
  need(actor, "level.manage");
  return withTx(async (tx) => {
    const before = await tx.employeeLevel.findUnique({ where: { id: input.id } });
    if (!before) throw notFound("Level");
    if (before.policyId !== input.policyId) {
      // Changing a level's policy affects all months not yet locked by a submitted schedule snapshot.
      const p = await tx.policy.findUnique({ where: { id: input.policyId } });
      if (!p?.isActive) throw invalid("Choose an active policy.");
    }
    const l = await tx.employeeLevel.update({ where: { id: input.id }, data: { name: input.name, description: input.description, policyId: input.policyId } });
    await audit(tx, { actorUserId: actor.userId, action: "level.update", entityType: "EmployeeLevel", entityId: l.id, before, after: l });
    return l;
  });
}

export async function createLevel(actor: CurrentUser, input: { code: string; name: string; policyId: string; description?: string }) {
  need(actor, "level.manage");
  const exists = await db.employeeLevel.findFirst({ where: { OR: [{ code: input.code }, { name: input.name }] } });
  if (exists) throw conflict("A level with that code or name exists.");
  const max = await db.employeeLevel.aggregate({ _max: { rank: true } });
  return withTx(async (tx) => {
    const l = await tx.employeeLevel.create({ data: { ...input, rank: (max._max.rank ?? 0) + 1 } });
    await audit(tx, { actorUserId: actor.userId, action: "level.create", entityType: "EmployeeLevel", entityId: l.id, after: l });
    return l;
  });
}

export async function createPolicy(actor: CurrentUser, input: { name: string; description?: string; wfoPercent: number; effectiveFrom: string }) {
  need(actor, "policy.manage");
  return withTx(async (tx) => {
    const p = await tx.policy.create({
      data: {
        name: input.name,
        description: input.description,
        versions: { create: { version: 1, wfoPercent: input.wfoPercent, mandatoryWeekdays: [], flexibleWeekdays: [1, 2, 3, 4, 5], effectiveFrom: fromISO(input.effectiveFrom), changeNote: "Initial version", createdById: actor.userId } },
      },
    });
    await audit(tx, { actorUserId: actor.userId, action: "policy.create", entityType: "Policy", entityId: p.id, after: input });
    return p;
  });
}

export { validateLeaderAssignment };

// ───────────── Policy rename / removal (Super Admin) ─────────────

export async function updatePolicyDetails(actor: CurrentUser, input: { id: string; name: string; description: string | null }) {
  need(actor, "policy.manage");
  const name = input.name.trim();
  if (name.length < 3) throw invalid("Policy name must be at least 3 characters.");
  return withTx(async (tx) => {
    const before = await tx.policy.findUnique({ where: { id: input.id } });
    if (!before) throw notFound("Policy");
    const clash = await tx.policy.findFirst({ where: { name, id: { not: input.id } } });
    if (clash) throw conflict(`Another policy is already named “${name}”.`);
    const p = await tx.policy.update({ where: { id: input.id }, data: { name, description: input.description?.trim() || null } });
    await audit(tx, { actorUserId: actor.userId, action: "policy.update", entityType: "Policy", entityId: p.id, before, after: p });
    return p;
  });
}

/**
 * Removes a policy. Blocked while a level or a current/future override uses it.
 * If historical schedules or past overrides reference it, it is archived (hidden, history intact);
 * otherwise it is deleted permanently.
 */
export async function removePolicy(actor: CurrentUser, id: string): Promise<{ mode: "deleted" | "archived" }> {
  need(actor, "policy.manage");
  return withTx(async (tx) => {
    const policy = await tx.policy.findUnique({ where: { id }, include: { levels: true, versions: true } });
    if (!policy) throw notFound("Policy");
    if (policy.levels.length)
      throw conflict(`This policy is used by ${policy.levels.map((l) => l.name).join(", ")}. Assign those levels to another policy first.`);
    const today = fromISO(todayJakarta());
    const activeOverrides = await tx.employeePolicyAssignment.count({ where: { policyId: id, OR: [{ effectiveTo: null }, { effectiveTo: { gte: today } }] } });
    if (activeOverrides) throw conflict(`${activeOverrides} employee override(s) still use this policy. Remove those overrides first.`);
    const usedBySchedules = await tx.monthlySchedule.count({ where: { policyVersion: { policyId: id } } });
    const pastOverrides = await tx.employeePolicyAssignment.count({ where: { policyId: id } });
    if (usedBySchedules || pastOverrides) {
      await tx.policy.update({ where: { id }, data: { isActive: false } });
      await audit(tx, { actorUserId: actor.userId, action: "policy.archive", entityType: "Policy", entityId: id, before: policy, metadata: { usedBySchedules, pastOverrides } });
      return { mode: "archived" as const };
    }
    await tx.policyVersion.deleteMany({ where: { policyId: id } });
    await tx.policy.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "policy.delete", entityType: "Policy", entityId: id, before: policy });
    return { mode: "deleted" as const };
  });
}

export async function restorePolicy(actor: CurrentUser, id: string) {
  need(actor, "policy.manage");
  return withTx(async (tx) => {
    const p = await tx.policy.update({ where: { id }, data: { isActive: true } });
    await audit(tx, { actorUserId: actor.userId, action: "policy.restore", entityType: "Policy", entityId: id });
    return p;
  });
}
