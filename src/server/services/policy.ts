import type { EvaluationPeriod, PolicyVersion, RoundingMode } from "@prisma/client";
import { db, withTx, type DbOrTx } from "../db";
import { addDays, fromISO, monthStart, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { validatePolicyRules, type PolicyRules } from "@/lib/engine/working-days";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { effectiveOn } from "./org";
import { getSettings } from "./settings";

export function toRules(v: PolicyVersion): PolicyRules {
  return {
    wfoPercent: v.wfoPercent,
    mandatoryWeekdays: v.mandatoryWeekdays,
    roundingMode: v.roundingMode,
    excludeLeaveFromDenominator: v.excludeLeaveFromDenominator,
    offsiteCountsAsWfo: v.offsiteCountsAsWfo,
  };
}

export async function versionOn(tx: DbOrTx, policyId: string, date: ISODate) {
  return tx.policyVersion.findFirst({ where: { policyId, ...effectiveOn(date) }, orderBy: { version: "desc" }, include: { policy: true } });
}

export interface ResolvedPolicy {
  version: PolicyVersion & { policy: { id: string; name: string } };
  source: "override" | "level" | "snapshot";
  levelName: string | null;
}

/**
 * Policy applicable to an employee for a month, evaluated on the first day of the month:
 *   1. explicit authorised override (EmployeePolicyAssignment), else
 *   2. the policy of the employee's level effective that day.
 * The version is the policy version effective on that day. Submitted schedules snapshot the version
 * so later policy edits never change history.
 */
export async function resolvePolicy(tx: DbOrTx, employeeId: string, year: number, month: number): Promise<ResolvedPolicy | null> {
  const ref = monthStart(year, month);
  const level = await tx.employeeLevelAssignment.findFirst({ where: { employeeId, ...effectiveOn(ref) }, orderBy: { effectiveFrom: "desc" }, include: { level: true } });
  const schedule = await tx.monthlySchedule.findUnique({ where: { employeeId_year_month: { employeeId, year, month } }, include: { policyVersion: { include: { policy: true } } } });
  const locked = ["SUBMITTED", "PENDING_LEADER_APPROVAL", "APPROVED", "REVISION_PENDING", "SUPERSEDED"];
  if (schedule?.policyVersion && locked.includes(schedule.status))
    return { version: schedule.policyVersion, source: "snapshot", levelName: level?.level.name ?? null };
  const override = await tx.employeePolicyAssignment.findFirst({ where: { employeeId, ...effectiveOn(ref) }, orderBy: { effectiveFrom: "desc" } });
  const policyId = override?.policyId ?? level?.level.policyId;
  if (!policyId) return null;
  const version = await versionOn(tx, policyId, ref);
  if (!version) return null;
  return { version, source: override ? "override" : "level", levelName: level?.level.name ?? null };
}

export interface PolicyVersionInput {
  wfoPercent: number;
  mandatoryWeekdays: number[];
  flexibleWeekdays: number[];
  evaluationPeriod: EvaluationPeriod;
  submissionDeadlineDay: number;
  requiresLeaderApproval: boolean;
  wfhCarryOver: boolean;
  exceptionsRequireHr: boolean;
  roundingMode: RoundingMode;
  excludeLeaveFromDenominator: boolean;
  offsiteCountsAsWfo: boolean;
  effectiveFrom: ISODate;
  changeNote: string;
}

export async function previewPolicyWarnings(input: Pick<PolicyVersionInput, "wfoPercent" | "mandatoryWeekdays" | "flexibleWeekdays">) {
  const s = await getSettings();
  return validatePolicyRules({ ...input, workingWeekdays: s.workingWeekdays });
}

/**
 * Policies are versioned: saving creates a new version effective from a date; the previous version
 * is closed the day before. Versions never change retroactively once months were evaluated with them.
 */
export async function createPolicyVersion(actor: CurrentUser, policyId: string, input: PolicyVersionInput) {
  if (!can(actor, "policy.manage")) throw forbidden();
  const { errors, warnings } = await previewPolicyWarnings(input);
  if (errors.length) throw invalid(errors.join(" "));
  if (input.submissionDeadlineDay < 1 || input.submissionDeadlineDay > 28) throw invalid("Submission deadline must be between day 1 and 28.");
  if (input.changeNote.trim().length < 5) throw invalid("Describe the change (min. 5 characters).");
  return withTx(async (tx) => {
    const policy = await tx.policy.findUnique({ where: { id: policyId }, include: { versions: { orderBy: { version: "desc" } } } });
    if (!policy) throw notFound("Policy");
    const from = fromISO(input.effectiveFrom);
    if (policy.versions.some((v) => v.effectiveFrom >= from))
      throw conflict("A version already starts on or after this date. Choose a later effective date.");
    const used = await tx.monthlySchedule.count({
      where: { policyVersion: { policyId }, status: { not: "DRAFT" }, OR: [{ year: { gt: from.getUTCFullYear() } }, { year: from.getUTCFullYear(), month: { gte: from.getUTCMonth() + 1 } }] },
    });
    const current = policy.versions.find((v) => !v.effectiveTo || v.effectiveTo >= from);
    if (current) await tx.policyVersion.update({ where: { id: current.id }, data: { effectiveTo: fromISO(addDays(input.effectiveFrom, -1)) } });
    const created = await tx.policyVersion.create({
      data: {
        policyId,
        version: (policy.versions[0]?.version ?? 0) + 1,
        wfoPercent: input.wfoPercent,
        mandatoryWeekdays: [...new Set(input.mandatoryWeekdays)].sort(),
        flexibleWeekdays: [...new Set(input.flexibleWeekdays)].sort(),
        evaluationPeriod: input.evaluationPeriod,
        submissionDeadlineDay: input.submissionDeadlineDay,
        requiresLeaderApproval: input.requiresLeaderApproval,
        wfhCarryOver: input.wfhCarryOver,
        exceptionsRequireHr: input.exceptionsRequireHr,
        roundingMode: input.roundingMode,
        excludeLeaveFromDenominator: input.excludeLeaveFromDenominator,
        offsiteCountsAsWfo: input.offsiteCountsAsWfo,
        effectiveFrom: from,
        changeNote: input.changeNote,
        createdById: actor.userId,
      },
    });
    await audit(tx, {
      actorUserId: actor.userId,
      action: "policy.version.create",
      entityType: "Policy",
      entityId: policyId,
      before: current ?? null,
      after: created,
      metadata: { warnings, submittedSchedulesKeepingSnapshot: used },
    });
    return { created, warnings };
  });
}

/**
 * A version that hasn't taken effect yet can still be adjusted (rules and start date) or cancelled.
 * Once it is in effect, or a plan was submitted under it, changes go through a new version instead.
 */
async function scheduledVersion(tx: DbOrTx, actor: CurrentUser, versionId: string) {
  if (!can(actor, "policy.manage")) throw forbidden();
  const v = await tx.policyVersion.findUnique({ where: { id: versionId }, include: { policy: { include: { versions: { orderBy: { effectiveFrom: "asc" } } } } } });
  if (!v) throw notFound("Policy version");
  if (toISO(v.effectiveFrom) <= todayJakarta()) throw conflict("This version is already in effect. Create a new version to change it.");
  const used =
    (await tx.monthlySchedule.count({ where: { policyVersionId: v.id, status: { not: "DRAFT" } } })) +
    (await tx.scheduleVersion.count({ where: { policyVersionId: v.id } }));
  if (used) throw conflict(`${used} plan(s) were already submitted under this version. Create a newer version instead.`);
  const i = v.policy.versions.findIndex((x) => x.id === v.id);
  return { v, prev: v.policy.versions[i - 1] ?? null, next: v.policy.versions[i + 1] ?? null };
}

export async function updatePolicyVersion(actor: CurrentUser, versionId: string, input: PolicyVersionInput) {
  const { errors, warnings } = await previewPolicyWarnings(input);
  if (errors.length) throw invalid(errors.join(" "));
  if (input.submissionDeadlineDay < 1 || input.submissionDeadlineDay > 28) throw invalid("Submission deadline must be between day 1 and 28.");
  if (input.changeNote.trim().length < 5) throw invalid("Describe the change (min. 5 characters).");
  return withTx(async (tx) => {
    const { v, prev, next } = await scheduledVersion(tx, actor, versionId);
    const from = input.effectiveFrom;
    if (from <= todayJakarta()) throw invalid("A scheduled version must start after today.");
    if (prev && from <= toISO(prev.effectiveFrom)) throw invalid(`Must start after v${prev.version} (${toISO(prev.effectiveFrom)}).`);
    if (next && from >= toISO(next.effectiveFrom)) throw invalid(`Must start before v${next.version} (${toISO(next.effectiveFrom)}).`);
    if (prev) await tx.policyVersion.update({ where: { id: prev.id }, data: { effectiveTo: fromISO(addDays(from, -1)) } });
    const updated = await tx.policyVersion.update({
      where: { id: v.id },
      data: {
        wfoPercent: input.wfoPercent,
        mandatoryWeekdays: [...new Set(input.mandatoryWeekdays)].sort(),
        flexibleWeekdays: [...new Set(input.flexibleWeekdays)].sort(),
        evaluationPeriod: input.evaluationPeriod,
        submissionDeadlineDay: input.submissionDeadlineDay,
        requiresLeaderApproval: input.requiresLeaderApproval,
        wfhCarryOver: input.wfhCarryOver,
        exceptionsRequireHr: input.exceptionsRequireHr,
        roundingMode: input.roundingMode,
        excludeLeaveFromDenominator: input.excludeLeaveFromDenominator,
        offsiteCountsAsWfo: input.offsiteCountsAsWfo,
        effectiveFrom: fromISO(from),
        changeNote: input.changeNote,
      },
    });
    await audit(tx, { actorUserId: actor.userId, action: "policy.version.update", entityType: "Policy", entityId: v.policyId, before: v, after: updated, metadata: { warnings } });
    return { updated, warnings };
  });
}

export async function cancelPolicyVersion(actor: CurrentUser, versionId: string) {
  return withTx(async (tx) => {
    const { v, prev, next } = await scheduledVersion(tx, actor, versionId);
    if (!prev) throw conflict("This is the policy's first version; remove the policy instead.");
    await tx.monthlySchedule.updateMany({ where: { policyVersionId: v.id }, data: { policyVersionId: null } }); // drafts re-resolve on open
    await tx.policyVersion.delete({ where: { id: v.id } });
    await tx.policyVersion.update({ where: { id: prev.id }, data: { effectiveTo: next ? fromISO(addDays(toISO(next.effectiveFrom), -1)) : null } });
    await audit(tx, { actorUserId: actor.userId, action: "policy.version.cancel", entityType: "Policy", entityId: v.policyId, before: v, after: null });
  });
}

export async function assignPolicyOverride(actor: CurrentUser, input: { employeeId: string; policyId: string | null; effectiveFrom: ISODate; reason: string }) {
  if (!can(actor, "policy.manage") && !can(actor, "employee.manage")) throw forbidden();
  if (input.reason.trim().length < 5) throw invalid("An override requires a reason.");
  return withTx(async (tx) => {
    const from = fromISO(input.effectiveFrom);
    const open = await tx.employeePolicyAssignment.findMany({ where: { employeeId: input.employeeId, OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }] } });
    for (const o of open) {
      if (o.effectiveFrom >= from) await tx.employeePolicyAssignment.delete({ where: { id: o.id } }); // superseded before it started (kept in audit)
      else await tx.employeePolicyAssignment.update({ where: { id: o.id }, data: { effectiveTo: fromISO(addDays(input.effectiveFrom, -1)) } });
    }
    const created = input.policyId
      ? await tx.employeePolicyAssignment.create({
          data: { employeeId: input.employeeId, policyId: input.policyId, effectiveFrom: from, reason: input.reason, assignedById: actor.userId },
        })
      : null;
    await audit(tx, {
      actorUserId: actor.userId,
      action: input.policyId ? "policy.override.assign" : "policy.override.remove",
      entityType: "Employee",
      entityId: input.employeeId,
      before: open,
      after: created,
    });
    return created;
  });
}

export async function listPoliciesWithVersions() {
  return db.policy.findMany({
    orderBy: { name: "asc" },
    include: { versions: { orderBy: { version: "desc" } }, levels: true },
  });
}

export function describeVersion(v: PolicyVersion) {
  return {
    ...v,
    effectiveFrom: toISO(v.effectiveFrom),
    effectiveTo: v.effectiveTo ? toISO(v.effectiveTo) : null,
  };
}
