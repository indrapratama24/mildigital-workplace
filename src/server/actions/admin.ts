"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { changeLevel, createEmployee, importEmployeesCsv, setEmployeeActive, setLeader, updateEmployee } from "../services/org";
import { assignPolicyOverride, cancelPolicyVersion, createPolicyVersion, previewPolicyWarnings, updatePolicyVersion } from "../services/policy";
import { createLevel, createPolicy, deleteHoliday, importHolidaysCsv, removePolicy, restorePolicy, setLeaveBalance, updateLevel, updatePolicyDetails, upsertDepartment, upsertHoliday, upsertRequestType, upsertTeam } from "../services/admin";
import { updateSettings } from "../services/settings";
import { runDailyJobs } from "../services/jobs";
import { sweepEventsOnOffDays } from "../services/events";
import { db } from "../db";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const weekdays = z.array(z.number().int().min(1).max(7)).max(7);
const refresh = () => revalidatePath("/", "layout");

// ── Employees & reporting lines ──
const employeeSchema = z.object({
  employeeCode: z.string().trim().min(2).max(30),
  fullName: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  employmentStatus: z.enum(["PERMANENT", "CONTRACT", "PROBATION", "INTERN"]),
  jobTitle: z.string().trim().min(2).max(120),
  departmentId: z.string().nullable(),
  teamId: z.string().nullable(),
  levelId: z.string().min(1),
  leaderId: z.string().nullable(),
  secondaryLeaderId: z.string().nullable(),
  startDate: date,
  role: z.enum(["EMPLOYEE", "LEADER", "HR", "SUPER_ADMIN"]),
  password: z.string().min(10).max(200).optional(),
});

export async function createEmployeeAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const e = await createEmployee(me, employeeSchema.parse(input));
    refresh();
    return { id: e.id };
  }, "Employee created");
}

export async function updateEmployeeAction(id: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        fullName: z.string().trim().min(2).max(120).optional(),
        jobTitle: z.string().trim().min(2).max(120).optional(),
        employmentStatus: z.enum(["PERMANENT", "CONTRACT", "PROBATION", "INTERN"]).optional(),
        departmentId: z.string().nullable().optional(),
        teamId: z.string().nullable().optional(),
        role: z.enum(["EMPLOYEE", "LEADER", "HR", "SUPER_ADMIN"]).optional(),
        roleDescription: z.string().max(1000).nullable().optional(),
      })
      .parse(input);
    await updateEmployee(me, id, p);
    refresh();
  }, "Employee updated");
}

export async function setEmployeeActiveAction(id: string, active: boolean) {
  return runAction(async () => {
    const me = await requireUser();
    await setEmployeeActive(me, id, active);
    refresh();
  }, active ? "Employee reactivated" : "Employee deactivated");
}

export async function setLeaderAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ employeeId: z.string(), leaderId: z.string().nullable(), type: z.enum(["PRIMARY", "SECONDARY"]), effectiveFrom: date }).parse(input);
    await setLeader(me, p);
    refresh();
  }, "Reporting line updated");
}

export async function changeLevelAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ employeeId: z.string(), levelId: z.string(), effectiveFrom: date, reason: z.string().max(500) }).parse(input);
    await changeLevel(me, p);
    refresh();
  }, "Level change scheduled");
}

export async function importEmployeesAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ csv: z.string().max(500_000), dryRun: z.boolean() }).parse(input);
    const r = await importEmployeesCsv(me, p.csv, p.dryRun);
    if (!p.dryRun) refresh();
    return r;
  });
}

export async function policyOverrideAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ employeeId: z.string(), policyId: z.string().nullable(), effectiveFrom: date, reason: z.string().max(500) }).parse(input);
    await assignPolicyOverride(me, p);
    refresh();
  }, "Policy override saved");
}

// ── Policies & levels ──
const versionSchema = z.object({
  wfoPercent: z.number().int().min(0).max(100),
  mandatoryWeekdays: weekdays,
  flexibleWeekdays: weekdays,
  evaluationPeriod: z.enum(["MONTHLY", "QUARTERLY"]),
  submissionDeadlineDay: z.number().int().min(1).max(28),
  requiresLeaderApproval: z.boolean(),
  wfhCarryOver: z.boolean(),
  exceptionsRequireHr: z.boolean(),
  roundingMode: z.enum(["CEIL", "ROUND", "FLOOR"]),
  excludeLeaveFromDenominator: z.boolean(),
  offsiteCountsAsWfo: z.boolean(),
  effectiveFrom: date,
  changeNote: z.string().max(500),
});

export async function previewPolicyAction(input: unknown) {
  return runAction(async () => {
    await requirePermission("policy.manage");
    return previewPolicyWarnings(versionSchema.pick({ wfoPercent: true, mandatoryWeekdays: true, flexibleWeekdays: true }).parse(input));
  });
}

export async function createPolicyVersionAction(policyId: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await createPolicyVersion(me, policyId, versionSchema.parse(input));
    refresh();
    return { warnings: r.warnings };
  }, "New policy version saved");
}

export async function updatePolicyVersionAction(versionId: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await updatePolicyVersion(me, z.string().parse(versionId), versionSchema.parse(input));
    refresh();
    return { warnings: r.warnings };
  }, "Scheduled version updated");
}

export async function cancelPolicyVersionAction(versionId: string) {
  return runAction(async () => {
    const me = await requireUser();
    await cancelPolicyVersion(me, z.string().parse(versionId));
    refresh();
  }, "Scheduled version cancelled");
}

export async function createPolicyAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ name: z.string().trim().min(3).max(120), description: z.string().max(500).optional(), wfoPercent: z.number().int().min(0).max(100), effectiveFrom: date }).parse(input);
    await createPolicy(me, p);
    refresh();
  }, "Policy created");
}

export async function updatePolicyAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string(), name: z.string().max(120), description: z.string().max(500).nullable() }).parse(input);
    await updatePolicyDetails(me, p);
    refresh();
  }, "Policy updated");
}

export async function removePolicyAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await removePolicy(me, z.string().parse(id));
    refresh();
    return r;
  });
}

export async function restorePolicyAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await restorePolicy(me, z.string().parse(id));
    refresh();
  }, "Policy restored");
}

export async function updateLevelAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string(), name: z.string().trim().min(2).max(80), description: z.string().max(300).nullable(), policyId: z.string() }).parse(input);
    await updateLevel(me, p);
    refresh();
  }, "Level updated");
}

export async function createLevelAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ code: z.string().regex(/^[A-Z0-9_]{2,20}$/), name: z.string().trim().min(2).max(80), policyId: z.string(), description: z.string().max(300).optional() }).parse(input);
    await createLevel(me, p);
    refresh();
  }, "Level created");
}

// ── Holidays ──
export async function upsertHolidayAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string().optional(), date, name: z.string().max(120), type: z.enum(["NATIONAL", "CUTI_BERSAMA", "COMPANY"]), isObserved: z.boolean() }).parse(input);
    const h = await upsertHoliday(me, p);
    refresh();
    return { eventsCancelled: h.eventsCancelled };
  }, "Holiday saved");
}

export async function deleteHolidayAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await deleteHoliday(me, id);
    refresh();
  }, "Holiday removed");
}

export async function importHolidaysAction(csv: string) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await importHolidaysCsv(me, z.string().max(200_000).parse(csv));
    refresh();
    return r;
  });
}

// ── Request types & balances ──
export async function upsertRequestTypeAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        id: z.string().optional(),
        code: z.string(),
        name: z.string().trim().min(2).max(80),
        category: z.enum(["LEAVE", "PERMISSION", "OFFSITE", "ADDITIONAL_WFH", "SCHEDULE_CHANGE"]),
        description: z.string().max(500).optional(),
        documentRequirement: z.enum(["NONE", "OPTIONAL", "REQUIRED"]),
        delegation: z.enum(["NONE", "OPTIONAL", "REQUIRED"]),
        reasonMinLength: z.number().int(),
        advanceNoticeDays: z.number().int(),
        allowHalfDay: z.boolean(),
        allowHourly: z.boolean(),
        deductsBalance: z.boolean(),
        defaultEntitlement: z.number().nullable(),
        isSensitive: z.boolean(),
        isActive: z.boolean(),
      })
      .parse(input);
    await upsertRequestType(me, p);
    refresh();
  }, "Request type saved");
}

export async function setLeaveBalanceAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ employeeId: z.string(), requestTypeId: z.string(), year: z.number().int(), entitledDays: z.number(), adjustedDays: z.number() }).parse(input);
    await setLeaveBalance(me, p);
    refresh();
  }, "Balance updated");
}

// ── Departments & teams ──
export async function upsertDepartmentAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await upsertDepartment(me, z.object({ id: z.string().optional(), code: z.string(), name: z.string().trim().min(2).max(80) }).parse(input));
    refresh();
  }, "Department saved");
}

export async function upsertTeamAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string().optional(), name: z.string(), departmentId: z.string(), leadId: z.string().nullable(), backupApproverId: z.string().nullable(), isActive: z.boolean() }).parse(input);
    await upsertTeam(me, p);
    refresh();
  }, "Team saved");
}

// ── System settings & jobs ──
export async function updateSettingsAction(input: unknown) {
  return runAction(async () => {
    const me = await requirePermission("settings.manage");
    const p = z
      .object({
        workingWeekdays: weekdays.min(1).optional(),
        cutiBersamaIsHoliday: z.boolean().optional(),
        clockInValidatesDay: z.boolean().optional(),
        leaderDeadlineHours: z.number().int().min(1).max(720).optional(),
        delegateDeadlineHours: z.number().int().min(1).max(720).optional(),
        escalation: z.enum(["BACKUP_APPROVER", "LEADERS_LEADER", "HR"]).optional(),
        hrFallbackEmployeeId: z.string().nullable().optional(),
        reminderDaysBeforeDeadline: z.number().int().min(0).max(14).optional(),
      })
      .parse(input);
    await updateSettings(me, p);
    // working weekdays / cuti bersama changes can turn days into off days
    if (p.workingWeekdays || p.cutiBersamaIsHoliday !== undefined) await sweepEventsOnOffDays(db, { actor: me });
    refresh();
  }, "Settings saved");
}

export async function runJobsAction() {
  return runAction(async () => {
    await requirePermission("settings.manage");
    const r = await runDailyJobs();
    refresh();
    return r;
  });
}
