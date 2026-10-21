// Internal Calendar administration: permission grants (Team Settings), categories and visibility.
import type { CalendarRole, CalendarScope, Role } from "@prisma/client";
import { db, withTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { canManageCalendarPermissions, canManageCategories } from "./calendar-access";
import { updateSettings } from "./settings";

export interface GrantInput {
  subjectType: "EMPLOYEE" | "TEAM" | "ROLE";
  subjectId: string;
  permissionRole: CalendarRole;
  scope: CalendarScope;
  scopeId: string | null;
}

export async function addCalendarGrant(actor: CurrentUser, input: GrantInput) {
  if (!canManageCalendarPermissions(actor)) throw forbidden("Only Super Admins manage calendar permissions.");
  if (input.scope !== "ALL" && !input.scopeId) throw invalid("Choose the department or team for this scope.");
  return withTx(async (tx) => {
    if (input.subjectType === "EMPLOYEE" && !(await tx.employee.count({ where: { id: input.subjectId, isActive: true } }))) throw invalid("Choose an active employee.");
    if (input.subjectType === "TEAM" && !(await tx.team.count({ where: { id: input.subjectId } }))) throw invalid("Choose a team.");
    if (input.subjectType === "ROLE" && !["EMPLOYEE", "LEADER", "HR", "SUPER_ADMIN"].includes(input.subjectId)) throw invalid("Choose a role.");
    if (input.scope === "DEPARTMENT" && !(await tx.department.count({ where: { id: input.scopeId! } }))) throw invalid("Unknown department.");
    if (input.scope === "TEAM" && !(await tx.team.count({ where: { id: input.scopeId! } }))) throw invalid("Unknown team.");
    const subject = {
      employeeId: input.subjectType === "EMPLOYEE" ? input.subjectId : null,
      teamId: input.subjectType === "TEAM" ? input.subjectId : null,
      appRole: input.subjectType === "ROLE" ? (input.subjectId as Role) : null,
    };
    const dup = await tx.internalCalendarPermission.findFirst({ where: { ...subject, permissionRole: input.permissionRole, scope: input.scope, scopeId: input.scope === "ALL" ? null : input.scopeId } });
    if (dup) throw conflict("This permission already exists.");
    const g = await tx.internalCalendarPermission.create({
      data: { ...subject, permissionRole: input.permissionRole, scope: input.scope, scopeId: input.scope === "ALL" ? null : input.scopeId, assignedById: actor.employeeId },
    });
    await audit(tx, { actorUserId: actor.userId, action: "calendar.permission.grant", entityType: "InternalCalendarPermission", entityId: g.id, after: g });
    return g;
  });
}

export async function removeCalendarGrant(actor: CurrentUser, id: string) {
  if (!canManageCalendarPermissions(actor)) throw forbidden();
  return withTx(async (tx) => {
    const g = await tx.internalCalendarPermission.findUnique({ where: { id } });
    if (!g) throw notFound("Permission");
    await tx.internalCalendarPermission.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "calendar.permission.revoke", entityType: "InternalCalendarPermission", entityId: id, before: g });
  });
}

export async function listCalendarGrants() {
  const grants = await db.internalCalendarPermission.findMany({
    include: { employee: { select: { fullName: true } }, team: { select: { name: true } }, assignedBy: { select: { fullName: true } } },
    orderBy: [{ permissionRole: "desc" }, { createdAt: "asc" }],
  });
  const [teams, depts] = await Promise.all([db.team.findMany({ select: { id: true, name: true } }), db.department.findMany({ select: { id: true, name: true } })]);
  const scopeName = (scope: CalendarScope, id: string | null) => (scope === "ALL" ? "All events" : scope === "TEAM" ? `Team: ${teams.find((t) => t.id === id)?.name ?? "—"}` : `Department: ${depts.find((d) => d.id === id)?.name ?? "—"}`);
  return grants.map((g) => ({
    id: g.id,
    subject: g.employee ? g.employee.fullName : g.team ? `Team: ${g.team.name}` : `Role: ${g.appRole}`,
    subjectType: g.employee ? "Employee" : g.team ? "Team" : "Role",
    role: g.permissionRole,
    scope: scopeName(g.scope, g.scopeId),
    assignedBy: g.assignedBy.fullName,
    createdAt: g.createdAt,
  }));
}

export async function upsertEventCategory(actor: CurrentUser, input: { id?: string; name: string; color: string; isActive: boolean }) {
  if (!(await canManageCategories(actor))) throw forbidden("Only Super Admins and company-wide calendar managers manage categories.");
  if (input.name.trim().length < 2) throw invalid("Category name is required.");
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw invalid("Choose a colour.");
  return withTx(async (tx) => {
    const clash = await tx.internalEventCategory.findFirst({ where: { name: input.name.trim(), id: input.id ? { not: input.id } : undefined } });
    if (clash) throw conflict("A category with this name exists.");
    const before = input.id ? await tx.internalEventCategory.findUnique({ where: { id: input.id } }) : null;
    const max = await tx.internalEventCategory.aggregate({ _max: { sortOrder: true } });
    const c = input.id
      ? await tx.internalEventCategory.update({ where: { id: input.id }, data: { name: input.name.trim(), color: input.color, isActive: input.isActive } })
      : await tx.internalEventCategory.create({ data: { name: input.name.trim(), color: input.color, isActive: input.isActive, sortOrder: (max._max.sortOrder ?? 0) + 1 } });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "calendar.category.update" : "calendar.category.create", entityType: "InternalEventCategory", entityId: c.id, before, after: c });
    return c;
  });
}

export async function setCalendarVisibility(actor: CurrentUser, value: "ALL" | "ASSIGNED") {
  if (!canManageCalendarPermissions(actor)) throw forbidden();
  await updateSettings(actor, { calendarVisibility: value });
}
