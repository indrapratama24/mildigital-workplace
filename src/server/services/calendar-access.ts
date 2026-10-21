// Internal Calendar authorization. Calendar roles are separate from application roles:
// being a participant or a team leader never grants edit rights — only explicit grants do
// (or Super Admin). All checks run server-side.
import type { CalendarRole, CalendarScope, EventAssignmentType } from "@prisma/client";
import { db, type DbOrTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can, hasCompanyScope } from "../authz";
import { todayJakarta } from "@/lib/dates";
import { effectiveOn } from "./org";
import { getSettings } from "./settings";

export interface Grant {
  role: CalendarRole;
  scope: CalendarScope;
  scopeId: string | null;
  via: "superadmin" | "employee" | "team" | "role";
}

export const ROLE_RANK: Record<CalendarRole, number> = { VIEWER: 0, ORGANIZER: 1, EDITOR: 2, MANAGER: 3 };
export const CALENDAR_ROLE_LABEL: Record<CalendarRole, string> = { VIEWER: "Calendar viewer", ORGANIZER: "Event organizer", EDITOR: "Calendar editor", MANAGER: "Calendar manager" };

export async function getGrants(user: CurrentUser, tx: DbOrTx = db): Promise<Grant[]> {
  if (user.role === "SUPER_ADMIN") return [{ role: "MANAGER", scope: "ALL", scopeId: null, via: "superadmin" }];
  const today = todayJakarta();
  const teams = await tx.employeeTeamMembership.findMany({ where: { employeeId: user.employeeId, ...effectiveOn(today) }, select: { teamId: true } });
  const rows = await tx.internalCalendarPermission.findMany({
    where: { OR: [{ employeeId: user.employeeId }, { teamId: { in: teams.map((t) => t.teamId) } }, { appRole: user.role }] },
  });
  return rows.map((r) => ({ role: r.permissionRole, scope: r.scope, scopeId: r.scopeId, via: r.employeeId ? "employee" : r.teamId ? "team" : "role" }));
}

/** Organisational units an event touches, derived from its assignment rules. */
export interface Footprint {
  needsAll: boolean;
  units: { departmentId: string | null; teamId: string | null }[];
}

export async function footprintOf(rules: { assignmentType: EventAssignmentType; targetId: string | null }[], tx: DbOrTx = db): Promise<Footprint> {
  const today = todayJakarta();
  const fp: Footprint = { needsAll: false, units: [] };
  for (const r of rules) {
    if (r.assignmentType === "ALL" || r.assignmentType === "LEVEL") fp.needsAll = true;
    else if (r.assignmentType === "DEPARTMENT") fp.units.push({ departmentId: r.targetId, teamId: null });
    else if (r.assignmentType === "TEAM") {
      const t = await tx.team.findUnique({ where: { id: r.targetId! }, select: { departmentId: true } });
      fp.units.push({ departmentId: t?.departmentId ?? null, teamId: r.targetId });
    } else if (r.assignmentType === "EMPLOYEE") {
      const e = await tx.employee.findUnique({
        where: { id: r.targetId! },
        select: { departmentId: true, memberships: { where: { isPrimary: true, ...effectiveOn(today) }, select: { teamId: true, team: { select: { departmentId: true } } } } },
      });
      const m = e?.memberships[0];
      fp.units.push({ departmentId: e?.departmentId ?? m?.team.departmentId ?? null, teamId: m?.teamId ?? null });
    }
  }
  return fp;
}

export function grantCovers(g: Grant, fp: Footprint): boolean {
  if (g.scope === "ALL") return true;
  if (fp.needsAll) return false;
  return fp.units.every((u) => (g.scope === "DEPARTMENT" ? u.departmentId === g.scopeId : u.teamId === g.scopeId));
}

export interface EventAuthSubject {
  organizerId: string;
  createdById: string;
  rules: { assignmentType: EventAssignmentType; targetId: string | null }[];
}

export interface EventPermissions {
  canEdit: boolean;
  canManage: boolean;
}

/**
 * Editor / Manager: any event whose participants fall within their scope.
 * Organizer: only events they organise or created, within scope.
 * Manage (cancel, refresh participants, delete): Manager in scope, or the creator.
 */
export async function eventPermissions(user: CurrentUser, ev: EventAuthSubject, grants?: Grant[], tx: DbOrTx = db): Promise<EventPermissions> {
  const gs = grants ?? (await getGrants(user, tx));
  if (!gs.some((g) => ROLE_RANK[g.role] >= ROLE_RANK.ORGANIZER)) return { canEdit: false, canManage: false };
  const fp = await footprintOf(ev.rules, tx);
  const own = ev.organizerId === user.employeeId || ev.createdById === user.employeeId;
  const covering = gs.filter((g) => grantCovers(g, fp));
  const canEdit = covering.some((g) => ROLE_RANK[g.role] >= ROLE_RANK.EDITOR || (g.role === "ORGANIZER" && own));
  const canManage = covering.some((g) => g.role === "MANAGER") || (canEdit && ev.createdById === user.employeeId);
  return { canEdit, canManage };
}

export async function canCreateEvents(user: CurrentUser, grants?: Grant[]) {
  return (grants ?? (await getGrants(user))).some((g) => ROLE_RANK[g.role] >= ROLE_RANK.ORGANIZER);
}

export async function canManageCategories(user: CurrentUser, grants?: Grant[]) {
  return (grants ?? (await getGrants(user))).some((g) => g.role === "MANAGER" && g.scope === "ALL");
}

export const canManageCalendarPermissions = (user: CurrentUser) => can(user, "team.manage");

/** Published events: visible to all employees by default; in ASSIGNED mode only to participants, organizers and calendar grant holders. */
export async function visibilityFilter(user: CurrentUser, grants?: Grant[]) {
  const s = await getSettings();
  const gs = grants ?? (await getGrants(user));
  const seesAll = s.calendarVisibility === "ALL" || hasCompanyScope(user) || gs.some((g) => g.scope === "ALL");
  return { seesAll, grants: gs };
}
