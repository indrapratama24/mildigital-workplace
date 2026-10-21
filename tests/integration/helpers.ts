import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { db } from "@/server/db";
import type { CurrentUser } from "@/server/auth/session";
import { fromISO } from "@/lib/dates";

let migrated = false;
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("_test")) throw new Error("Refusing to reset a non-test database");
  if (!migrated) {
    execSync("npx prisma migrate deploy", { env: process.env, stdio: "ignore" });
    migrated = true;
  }
  const tables = await db.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations'`;
  for (const t of ["ApprovalAction", "AuditLog", "AttendanceCorrection", "ScheduleVersion"]) await db.$executeRawUnsafe(`ALTER TABLE "${t}" DISABLE TRIGGER USER`);
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  for (const t of ["ApprovalAction", "AuditLog", "AttendanceCorrection", "ScheduleVersion"]) await db.$executeRawUnsafe(`ALTER TABLE "${t}" ENABLE TRIGGER USER`);
}

export interface Org {
  ids: Record<string, string>;
  levels: Record<string, string>;
  policies: Record<string, string>;
  types: Record<string, string>;
  actor: (key: string) => Promise<CurrentUser>;
}

/**
 * Minimal organisation:
 *   admin (SUPER_ADMIN) ← leader, leader2, hr
 *   leader (LEADER)     ← junior (75% M/W/Th), principal (50%, no mandatory days), peer (75%)
 */
export async function buildOrg(): Promise<Org> {
  const mkPolicy = (name: string, wfo: number, mandatory: number[], hr = false) =>
    db.policy.create({
      data: {
        name,
        versions: { create: { version: 1, wfoPercent: wfo, mandatoryWeekdays: mandatory, flexibleWeekdays: [1, 2, 3, 4, 5].filter((x) => !mandatory.includes(x)), exceptionsRequireHr: hr, effectiveFrom: fromISO("2026-01-01"), changeNote: "init" } },
      },
    });
  const policies = {
    JUNIOR: (await mkPolicy("Junior 75%", 75, [1, 3, 4], true)).id,
    PRINCIPAL: (await mkPolicy("Principal 50%", 50, [])).id,
    MANAGER: (await mkPolicy("Manager 50%", 50, [1])).id,
  };
  const levels = {
    JUNIOR: (await db.employeeLevel.create({ data: { code: "JUNIOR", name: "Junior & Associate", rank: 1, policyId: policies.JUNIOR } })).id,
    PRINCIPAL: (await db.employeeLevel.create({ data: { code: "PRINCIPAL", name: "Principal IC", rank: 3, policyId: policies.PRINCIPAL } })).id,
    MANAGER: (await db.employeeLevel.create({ data: { code: "MANAGER", name: "Manager & Leader", rank: 4, policyId: policies.MANAGER } })).id,
  };
  const dept = await db.department.create({ data: { code: "GROWTH", name: "Growth" } });
  const team = await db.team.create({ data: { name: "Performance", departmentId: dept.id } });
  const people: [string, Role, keyof typeof levels, string | null][] = [
    ["admin", "SUPER_ADMIN", "MANAGER", null],
    ["hr", "HR", "MANAGER", "admin"],
    ["leader", "LEADER", "MANAGER", "admin"],
    ["leader2", "LEADER", "MANAGER", "admin"],
    ["junior", "EMPLOYEE", "JUNIOR", "leader"],
    ["principal", "EMPLOYEE", "PRINCIPAL", "leader"],
    ["peer", "EMPLOYEE", "JUNIOR", "leader"],
  ];
  const ids: Record<string, string> = {};
  for (const [key, role, level] of people) {
    const user = await db.user.create({ data: { email: `${key}@test.id`, passwordHash: "x", role } });
    const e = await db.employee.create({ data: { employeeCode: key.toUpperCase(), fullName: key, email: `${key}@test.id`, jobTitle: key, startDate: fromISO("2025-01-01"), userId: user.id, departmentId: dept.id } });
    ids[key] = e.id;
    await db.employeeLevelAssignment.create({ data: { employeeId: e.id, levelId: levels[level], effectiveFrom: fromISO("2025-01-01") } });
    await db.employeeTeamMembership.create({ data: { employeeId: e.id, teamId: team.id, effectiveFrom: fromISO("2025-01-01") } });
  }
  for (const [key, , , leader] of people) if (leader) await db.reportingRelationship.create({ data: { employeeId: ids[key], leaderId: ids[leader], effectiveFrom: fromISO("2025-01-01") } });
  await db.team.update({ where: { id: team.id }, data: { leadId: ids.leader, backupApproverId: ids.leader2 } });
  await db.systemSetting.create({ data: { key: "hrFallbackEmployeeId", value: ids.hr } });
  await db.holidayCalendar.create({ data: { name: "Test", isDefault: true, holidays: { create: [{ date: fromISO("2026-12-25"), name: "Natal", type: "NATIONAL" }] } } });
  const types = {
    ANNUAL: (await db.requestType.create({ data: { code: "ANNUAL", name: "Annual Leave", category: "LEAVE", delegation: "REQUIRED", reasonMinLength: 10, advanceNoticeDays: 3, deductsBalance: true, defaultEntitlement: 12 } })).id,
    SICK: (await db.requestType.create({ data: { code: "SICK", name: "Sick Leave", category: "LEAVE", delegation: "OPTIONAL", reasonMinLength: 5, isSensitive: true } })).id,
    OFFSITE: (await db.requestType.create({ data: { code: "OFFSITE", name: "Offsite Duty", category: "OFFSITE", delegation: "NONE", reasonMinLength: 10, allowHalfDay: false } })).id,
  };
  const actor = async (key: string): Promise<CurrentUser> => {
    const e = await db.employee.findUniqueOrThrow({ where: { id: ids[key] }, include: { user: { include: { grants: true } } } });
    return { userId: e.userId!, email: e.email, role: e.user!.role, employeeId: e.id, fullName: e.fullName, jobTitle: e.jobTitle, grants: e.user!.grants.map((g) => g.permission) };
  };
  return { ids, levels, policies, types, actor };
}

export const key = () => randomUUID();

export async function pendingStepFor(employeeId: string) {
  return db.approvalStep.findFirst({ where: { assigneeId: employeeId, status: "PENDING" }, orderBy: { createdAt: "desc" } });
}
