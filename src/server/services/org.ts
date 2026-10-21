import type { EmploymentStatus, Prisma, RelationshipType, Role } from "@prisma/client";
import { db, withTx, type DbOrTx } from "../db";
import { addDays, fromISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { APPROVER_ROLES, can, hasCompanyScope } from "../authz";
import type { CurrentUser } from "../auth/session";
import { badState, conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getSettings } from "./settings";
import { hashPassword } from "../auth/password";

/** Prisma filter for effective-dated rows active on a date. */
export function effectiveOn(date: ISODate) {
  const d = fromISO(date);
  return { effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] };
}

// ───────────────────────────── Reporting lines ─────────────────────────────

export async function getLeader(tx: DbOrTx, employeeId: string, date: ISODate, type: RelationshipType = "PRIMARY") {
  const rel = await tx.reportingRelationship.findFirst({
    where: { employeeId, type, ...effectiveOn(date) },
    orderBy: { effectiveFrom: "desc" },
    include: { leader: { include: { user: true } } },
  });
  return rel?.leader ?? null;
}

export async function directReportIds(tx: DbOrTx, leaderId: string, date: ISODate = todayJakarta()): Promise<string[]> {
  const rels = await tx.reportingRelationship.findMany({ where: { leaderId, ...effectiveOn(date) }, select: { employeeId: true } });
  return [...new Set(rels.map((r) => r.employeeId))];
}

export async function isLeaderOf(tx: DbOrTx, leaderId: string, employeeId: string, date: ISODate = todayJakarta()) {
  const n = await tx.reportingRelationship.count({ where: { leaderId, employeeId, ...effectiveOn(date) } });
  return n > 0;
}

/** Employee IDs the user may see. `null` = company-wide scope. */
export async function visibleEmployeeIds(user: CurrentUser): Promise<string[] | null> {
  if (hasCompanyScope(user)) return null;
  if (can(user, "team.view")) return [user.employeeId, ...(await directReportIds(db, user.employeeId))];
  return [user.employeeId];
}

export async function canViewEmployee(user: CurrentUser, employeeId: string): Promise<boolean> {
  if (user.employeeId === employeeId || hasCompanyScope(user)) return true;
  if (!can(user, "team.view")) return false;
  return isLeaderOf(db, user.employeeId, employeeId);
}

export async function assertCanViewEmployee(user: CurrentUser, employeeId: string) {
  if (!(await canViewEmployee(user, employeeId))) throw forbidden("This employee is outside your reporting scope.");
}

async function isUnavailable(tx: DbOrTx, employeeId: string, date: ISODate) {
  const emp = await tx.employee.findUnique({ where: { id: employeeId }, include: { user: true } });
  if (!emp || !emp.isActive || !emp.user?.isActive) return true;
  const d = fromISO(date);
  const onLeave = await tx.request.count({
    where: { employeeId, status: "APPROVED", durationType: "FULL_DAY", startDate: { lte: d }, endDate: { gte: d }, requestType: { category: "LEAVE" } },
  });
  return onLeave > 0;
}

async function hrFallback(tx: DbOrTx, exclude: string[]) {
  const s = await getSettings(tx);
  if (s.hrFallbackEmployeeId && !exclude.includes(s.hrFallbackEmployeeId)) {
    const e = await tx.employee.findFirst({ where: { id: s.hrFallbackEmployeeId, isActive: true } });
    if (e) return e.id;
  }
  const hr = await tx.employee.findFirst({
    where: { isActive: true, id: { notIn: exclude }, user: { role: { in: ["HR", "SUPER_ADMIN"] }, isActive: true } },
    orderBy: [{ user: { role: "asc" } }, { createdAt: "asc" }],
  });
  return hr?.id ?? null;
}

export interface ResolvedApprover {
  assigneeId: string;
  reason: string;
}

/**
 * Leader-approval routing with fallbacks:
 *   primary leader → secondary leader → team backup approver → leader's leader → HR fallback.
 * Never returns the requester (prevents self-approval) or anyone in `exclude`.
 */
export async function resolveApprover(tx: DbOrTx, requesterId: string, date: ISODate = todayJakarta(), exclude: string[] = []): Promise<ResolvedApprover> {
  const skip = new Set([requesterId, ...exclude]);
  const usable = async (id: string | null | undefined) => !!id && !skip.has(id) && !(await isUnavailable(tx, id, date));

  const primary = await getLeader(tx, requesterId, date, "PRIMARY");
  if (await usable(primary?.id)) return { assigneeId: primary!.id, reason: "Primary leader" };
  const secondary = await getLeader(tx, requesterId, date, "SECONDARY");
  if (await usable(secondary?.id)) return { assigneeId: secondary!.id, reason: "Secondary leader (primary unavailable)" };
  const membership = await tx.employeeTeamMembership.findFirst({ where: { employeeId: requesterId, isPrimary: true, ...effectiveOn(date) }, include: { team: true } });
  if (await usable(membership?.team.backupApproverId)) return { assigneeId: membership!.team.backupApproverId!, reason: "Team backup approver" };
  if (primary) {
    const grand = await getLeader(tx, primary.id, date, "PRIMARY");
    if (await usable(grand?.id)) return { assigneeId: grand!.id, reason: "Leader's leader (escalation)" };
  }
  const hr = await hrFallback(tx, [...skip]);
  if (hr) return { assigneeId: hr, reason: "HR fallback approver" };
  throw badState("No eligible approver could be found. Ask HR to configure a leader or fallback approver.");
}

export async function resolveHrApprover(tx: DbOrTx, exclude: string[]) {
  const id = await hrFallback(tx, exclude);
  if (!id) throw badState("No HR approver is configured.");
  return id;
}

/** Validates a proposed leader: not self, active, has an approver role, no reporting cycle. */
export async function validateLeaderAssignment(tx: DbOrTx, employeeId: string, leaderId: string, date: ISODate) {
  if (employeeId === leaderId) throw invalid("An employee cannot report to themselves.");
  const leader = await tx.employee.findUnique({ where: { id: leaderId }, include: { user: true } });
  if (!leader || !leader.isActive) throw invalid("The selected leader is not an active employee.");
  if (!leader.user || !APPROVER_ROLES.includes(leader.user.role))
    throw invalid(`${leader.fullName} does not have an approver role (Leader/HR/Admin). Employee level alone does not grant approval rights.`);
  // walk up from the proposed leader; reaching the employee means a cycle
  const seen = new Set<string>();
  let current: string | null = leaderId;
  while (current) {
    if (current === employeeId) throw invalid("This assignment would create a circular reporting line.");
    if (seen.has(current)) break;
    seen.add(current);
    const up = await getLeader(tx, current, date, "PRIMARY");
    current = up?.id ?? null;
  }
}

export async function setLeader(actor: CurrentUser, input: { employeeId: string; leaderId: string | null; type: RelationshipType; effectiveFrom: ISODate }) {
  if (!can(actor, "employee.manage") && !can(actor, "team.manage")) throw forbidden();
  return withTx(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) throw notFound("Employee");
    if (input.leaderId) await validateLeaderAssignment(tx, input.employeeId, input.leaderId, input.effectiveFrom);
    const from = fromISO(input.effectiveFrom);
    const current = await tx.reportingRelationship.findMany({
      where: { employeeId: input.employeeId, type: input.type, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] },
    });
    for (const rel of current) {
      if (rel.effectiveFrom >= from) {
        // a row starting on/after the new date is superseded entirely (captured in the audit log below)
        await tx.reportingRelationship.delete({ where: { id: rel.id } });
      } else {
        await tx.reportingRelationship.update({ where: { id: rel.id }, data: { effectiveTo: fromISO(addDays(input.effectiveFrom, -1)) } });
      }
    }
    let created = null;
    if (input.leaderId) {
      created = await tx.reportingRelationship.create({
        data: { employeeId: input.employeeId, leaderId: input.leaderId, type: input.type, effectiveFrom: from, createdById: actor.userId },
      });
      // Pending leader approvals move to the new primary leader when the change is already effective.
      // Decided approvals keep their original approver.
      if (input.type === "PRIMARY" && input.effectiveFrom <= todayJakarta()) {
        const steps = await tx.approvalStep.findMany({
          where: { status: { in: ["PENDING", "WAITING"] }, kind: "LEADER", workflow: { requesterId: input.employeeId, status: "PENDING" } },
        });
        for (const s of steps) {
          if (s.assigneeId === input.leaderId) continue;
          await tx.approvalStep.update({ where: { id: s.id }, data: { assigneeId: input.leaderId } });
          await tx.approvalAction.create({
            data: { workflowId: s.workflowId, stepId: s.id, actorId: actor.employeeId, action: "REASSIGNED", comment: "Reporting line changed", metadata: { from: s.assigneeId, to: input.leaderId } },
          });
        }
      }
    }
    await audit(tx, {
      actorUserId: actor.userId,
      action: "reporting.set",
      entityType: "Employee",
      entityId: input.employeeId,
      before: current.map((c) => ({ leaderId: c.leaderId, from: toISO(c.effectiveFrom), to: c.effectiveTo ? toISO(c.effectiveTo) : null })),
      after: { leaderId: input.leaderId, type: input.type, effectiveFrom: input.effectiveFrom },
    });
    return created;
  });
}

// ───────────────────────────── Levels ─────────────────────────────

export async function getLevelOn(tx: DbOrTx, employeeId: string, date: ISODate) {
  return tx.employeeLevelAssignment.findFirst({ where: { employeeId, ...effectiveOn(date) }, orderBy: { effectiveFrom: "desc" }, include: { level: true } });
}

/** Effective-dated level change. Months before `effectiveFrom` keep the previous level/policy. */
export async function changeLevel(actor: CurrentUser, input: { employeeId: string; levelId: string; effectiveFrom: ISODate; reason: string }) {
  const allowed = can(actor, "employee.manage") || (can(actor, "team.changeLevel") && (await isLeaderOf(db, actor.employeeId, input.employeeId)));
  if (!allowed) throw forbidden("Only HR, admins or the employee's leader can change levels.");
  if (actor.employeeId === input.employeeId && !can(actor, "employee.manage")) throw forbidden("You cannot change your own level.");
  if (input.reason.trim().length < 5) throw invalid("Please give a reason for the level change.");
  return withTx(async (tx) => {
    const level = await tx.employeeLevel.findUnique({ where: { id: input.levelId } });
    if (!level) throw notFound("Level");
    const from = fromISO(input.effectiveFrom);
    const existing = await tx.employeeLevelAssignment.findMany({ where: { employeeId: input.employeeId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } });
    const current = existing.find((e) => e.effectiveFrom <= from);
    if (current?.levelId === input.levelId && !existing.some((e) => e.effectiveFrom > from)) throw invalid(`The employee is already ${level.name} from that date.`);
    for (const e of existing) {
      // assignments starting on/after the new date are superseded (kept in the audit log); earlier ones end the day before
      if (e.effectiveFrom >= from) await tx.employeeLevelAssignment.delete({ where: { id: e.id } });
      else await tx.employeeLevelAssignment.update({ where: { id: e.id }, data: { effectiveTo: fromISO(addDays(input.effectiveFrom, -1)) } });
    }
    const created = await tx.employeeLevelAssignment.create({
      data: { employeeId: input.employeeId, levelId: input.levelId, effectiveFrom: from, reason: input.reason, changedById: actor.userId },
    });
    await audit(tx, {
      actorUserId: actor.userId,
      action: "employee.level.change",
      entityType: "Employee",
      entityId: input.employeeId,
      before: existing.map((e) => ({ levelId: e.levelId, from: toISO(e.effectiveFrom), to: e.effectiveTo ? toISO(e.effectiveTo) : null })),
      after: { levelId: input.levelId, effectiveFrom: input.effectiveFrom, reason: input.reason },
    });
    return created;
  });
}

// ───────────────────────────── Employees ─────────────────────────────

export interface EmployeeInput {
  employeeCode: string;
  fullName: string;
  email: string;
  employmentStatus: EmploymentStatus;
  jobTitle: string;
  departmentId: string | null;
  teamId: string | null;
  levelId: string;
  leaderId: string | null;
  secondaryLeaderId: string | null;
  startDate: ISODate;
  role: Role;
  password?: string;
}

export async function createEmployee(actor: CurrentUser, input: EmployeeInput, tx?: DbOrTx) {
  if (!can(actor, "employee.manage")) throw forbidden();
  if (input.role !== "EMPLOYEE" && !can(actor, "user.manage") && input.role !== "LEADER") throw forbidden("Only Super Admins can grant HR/Admin roles.");
  const run = async (t: DbOrTx) => {
    const email = input.email.trim().toLowerCase();
    const dup = await t.employee.findFirst({ where: { OR: [{ email }, { employeeCode: input.employeeCode }] } });
    if (dup) throw conflict(`Employee ${dup.email === email ? "email" : "ID"} already exists.`);
    const user = await t.user.create({
      data: { email, role: input.role, passwordHash: await hashPassword(input.password ?? cryptoRandom()) },
    });
    const emp = await t.employee.create({
      data: {
        employeeCode: input.employeeCode,
        fullName: input.fullName,
        email,
        employmentStatus: input.employmentStatus,
        jobTitle: input.jobTitle,
        departmentId: input.departmentId,
        startDate: fromISO(input.startDate),
        userId: user.id,
      },
    });
    await t.employeeLevelAssignment.create({ data: { employeeId: emp.id, levelId: input.levelId, effectiveFrom: fromISO(input.startDate), reason: "Initial level", changedById: actor.userId } });
    if (input.teamId) await t.employeeTeamMembership.create({ data: { employeeId: emp.id, teamId: input.teamId, isPrimary: true, effectiveFrom: fromISO(input.startDate) } });
    for (const [leaderId, type] of [
      [input.leaderId, "PRIMARY"],
      [input.secondaryLeaderId, "SECONDARY"],
    ] as const) {
      if (!leaderId) continue;
      await validateLeaderAssignment(t, emp.id, leaderId, input.startDate);
      await t.reportingRelationship.create({ data: { employeeId: emp.id, leaderId, type, effectiveFrom: fromISO(input.startDate), createdById: actor.userId } });
    }
    await audit(t, { actorUserId: actor.userId, action: "employee.create", entityType: "Employee", entityId: emp.id, after: { ...input, password: undefined } });
    return emp;
  };
  return tx ? run(tx) : withTx(run);
}

function cryptoRandom() {
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}A1!`;
}

export async function updateEmployee(
  actor: CurrentUser,
  id: string,
  patch: { fullName?: string; jobTitle?: string; employmentStatus?: EmploymentStatus; departmentId?: string | null; teamId?: string | null; role?: Role; roleDescription?: string | null },
) {
  if (!can(actor, "employee.manage")) throw forbidden();
  return withTx(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id }, include: { user: true } });
    if (!before) throw notFound("Employee");
    if (patch.role && patch.role !== before.user?.role) {
      if (!can(actor, "user.manage") && !(patch.role === "LEADER" || patch.role === "EMPLOYEE")) throw forbidden("Only Super Admins can grant HR/Admin roles.");
      if (before.userId === actor.userId) throw forbidden("You cannot change your own role.");
      if (before.user && !["LEADER", "HR", "SUPER_ADMIN"].includes(patch.role)) {
        const reports = await directReportIds(tx, id);
        if (reports.length) throw invalid(`Reassign ${reports.length} direct report(s) before removing approver rights.`);
      }
      await tx.user.update({ where: { id: before.userId! }, data: { role: patch.role } });
    }
    const data: Prisma.EmployeeUpdateInput = {};
    if (patch.fullName) data.fullName = patch.fullName;
    if (patch.jobTitle) data.jobTitle = patch.jobTitle;
    if (patch.employmentStatus) data.employmentStatus = patch.employmentStatus;
    if (patch.roleDescription !== undefined) data.roleDescription = patch.roleDescription?.trim() || null;
    if (patch.departmentId !== undefined) data.department = patch.departmentId ? { connect: { id: patch.departmentId } } : { disconnect: true };
    const after = await tx.employee.update({ where: { id }, data });
    if (patch.teamId !== undefined) {
      const today = todayJakarta();
      const current = await tx.employeeTeamMembership.findFirst({ where: { employeeId: id, isPrimary: true, ...effectiveOn(today) } });
      if (current?.teamId !== patch.teamId) {
        if (current) await tx.employeeTeamMembership.update({ where: { id: current.id }, data: { effectiveTo: fromISO(addDays(today, -1)) } });
        if (patch.teamId) await tx.employeeTeamMembership.create({ data: { employeeId: id, teamId: patch.teamId, isPrimary: true, effectiveFrom: fromISO(today) } });
      }
    }
    await audit(tx, { actorUserId: actor.userId, action: "employee.update", entityType: "Employee", entityId: id, before, after: { ...after, role: patch.role } });
    return after;
  });
}

export async function setEmployeeActive(actor: CurrentUser, id: string, active: boolean) {
  if (!can(actor, "employee.manage")) throw forbidden();
  return withTx(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id } });
    if (!emp) throw notFound("Employee");
    if (emp.id === actor.employeeId) throw forbidden("You cannot deactivate yourself.");
    if (!active) {
      const reports = await directReportIds(tx, id);
      if (reports.length) throw invalid(`Reassign ${reports.length} direct report(s) before deactivating this leader.`);
      const pending = await tx.approvalStep.count({ where: { assigneeId: id, status: "PENDING" } });
      if (pending) throw invalid(`This employee has ${pending} pending approval(s). Reassign them first.`);
    }
    await tx.employee.update({ where: { id }, data: { isActive: active, deactivatedAt: active ? null : new Date() } });
    if (emp.userId) {
      await tx.user.update({ where: { id: emp.userId }, data: { isActive: active } });
      if (!active) await tx.session.deleteMany({ where: { userId: emp.userId } });
    }
    await audit(tx, { actorUserId: actor.userId, action: active ? "employee.reactivate" : "employee.deactivate", entityType: "Employee", entityId: id });
  });
}

// ───────────────────────────── CSV import ─────────────────────────────

export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v.trim() !== ""));
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

export const CSV_TEMPLATE =
  "employee_id,full_name,email,job_title,employment_status,level_code,department_code,team_name,leader_email,secondary_leader_email,start_date,role,birth_date,phone\n" +
  "MIL-0100,Contoh Karyawan,contoh@mildigital.id,Performance Marketer,PERMANENT,JUNIOR,GROWTH,Performance,leader@mildigital.id,,2026-11-01,EMPLOYEE,1998-05-17,+62 812-0000-0100\n";

export interface ImportResult {
  created: number;
  errors: { row: number; message: string }[];
}

/** All-or-nothing CSV import: rows are validated first, then created in one transaction. */
export async function importEmployeesCsv(actor: CurrentUser, text: string, dryRun = false): Promise<ImportResult> {
  if (!can(actor, "employee.manage")) throw forbidden();
  const rows = parseCsv(text);
  if (!rows.length) throw invalid("The CSV file is empty.");
  if (rows.length > 500) throw invalid("Import at most 500 rows at a time.");
  const [levels, departments, teams, employees] = await Promise.all([
    db.employeeLevel.findMany(),
    db.department.findMany(),
    db.team.findMany(),
    db.employee.findMany({ select: { id: true, email: true, employeeCode: true } }),
  ]);
  const errors: ImportResult["errors"] = [];
  const inputs: { row: number; input: EmployeeInput; leaderEmail?: string; secondaryEmail?: string; birthDate?: string; phone?: string }[] = [];
  const seenEmails = new Set<string>();
  rows.forEach((r, i) => {
    const row = i + 2;
    const err = (m: string) => errors.push({ row, message: m });
    const email = (r.email ?? "").toLowerCase();
    if (!r.employee_id || !r.full_name || !email || !r.job_title || !r.start_date) return err("Missing required column (employee_id, full_name, email, job_title, start_date).");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err(`Invalid email "${r.email}".`);
    if (seenEmails.has(email) || employees.some((e) => e.email === email)) return err(`Email ${email} already exists.`);
    if (employees.some((e) => e.employeeCode === r.employee_id)) return err(`Employee ID ${r.employee_id} already exists.`);
    seenEmails.add(email);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r.start_date)) return err("start_date must be YYYY-MM-DD.");
    const level = levels.find((l) => l.code === (r.level_code ?? "").toUpperCase());
    if (!level) return err(`Unknown level_code "${r.level_code}". Use ${levels.map((l) => l.code).join(", ")}.`);
    const dept = r.department_code ? departments.find((d) => d.code === r.department_code.toUpperCase()) : null;
    if (r.department_code && !dept) return err(`Unknown department_code "${r.department_code}".`);
    const team = r.team_name ? teams.find((t) => t.name.toLowerCase() === r.team_name.toLowerCase()) : null;
    if (r.team_name && !team) return err(`Unknown team "${r.team_name}".`);
    const status = (r.employment_status || "PERMANENT").toUpperCase();
    if (!["PERMANENT", "CONTRACT", "PROBATION", "INTERN"].includes(status)) return err(`Invalid employment_status "${status}".`);
    const role = (r.role || "EMPLOYEE").toUpperCase();
    if (!["EMPLOYEE", "LEADER"].includes(role)) return err("CSV import can only grant EMPLOYEE or LEADER roles.");
    if (r.birth_date && !/^\d{4}-\d{2}-\d{2}$/.test(r.birth_date)) return err("birth_date must be YYYY-MM-DD.");
    inputs.push({
      row,
      birthDate: r.birth_date || undefined,
      phone: r.phone || undefined,
      leaderEmail: r.leader_email?.toLowerCase() || undefined,
      secondaryEmail: r.secondary_leader_email?.toLowerCase() || undefined,
      input: {
        employeeCode: r.employee_id,
        fullName: r.full_name,
        email,
        jobTitle: r.job_title,
        employmentStatus: status as EmploymentStatus,
        levelId: level.id,
        departmentId: dept?.id ?? team?.departmentId ?? null,
        teamId: team?.id ?? null,
        leaderId: null,
        secondaryLeaderId: null,
        startDate: r.start_date,
        role: role as Role,
      },
    });
  });
  if (errors.length || dryRun) return { created: 0, errors };
  await withTx(async (tx) => {
    const created = new Map<string, string>();
    for (const item of inputs) {
      const emp = await createEmployee(actor, item.input, tx);
      created.set(item.input.email, emp.id);
      if (item.birthDate || item.phone)
        await tx.employeePersonalData.create({ data: { employeeId: emp.id, birthDate: item.birthDate ? fromISO(item.birthDate) : null, phone: item.phone ?? null, updatedById: actor.employeeId } });
    }
    // second pass: leaders may be existing employees or rows from the same file
    for (const item of inputs) {
      for (const [email, type] of [
        [item.leaderEmail, "PRIMARY"],
        [item.secondaryEmail, "SECONDARY"],
      ] as const) {
        if (!email) continue;
        const leaderId = created.get(email) ?? (await tx.employee.findUnique({ where: { email } }))?.id;
        if (!leaderId) throw invalid(`Row ${item.row}: leader ${email} not found.`);
        const empId = created.get(item.input.email)!;
        await validateLeaderAssignment(tx, empId, leaderId, item.input.startDate);
        await tx.reportingRelationship.create({ data: { employeeId: empId, leaderId, type, effectiveFrom: fromISO(item.input.startDate), createdById: actor.userId } });
      }
    }
    await audit(tx, { actorUserId: actor.userId, action: "employee.import", entityType: "Employee", entityId: "bulk", metadata: { count: inputs.length } });
  });
  return { created: inputs.length, errors: [] };
}
