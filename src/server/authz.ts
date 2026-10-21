// Role-based access control. Roles are permission sets; they are independent from employee level.
// Data scope is enforced separately (see services/org.ts → visibleEmployeeIds).
import type { Role } from "@prisma/client";

export const PERMISSIONS = {
  "self.use": "Plan own schedule, submit requests, clock in",
  "team.view": "View direct reports' schedules, requests and compliance",
  "team.approve": "Approve schedules, revisions and requests assigned to them",
  "team.changeLevel": "Change the level of direct reports (effective-dated)",
  "company.view": "View company-wide schedules and compliance",
  "employee.manage": "Create, edit, deactivate employees; manage reporting lines",
  "holiday.manage": "Manage holiday calendars and cuti bersama",
  "requestType.manage": "Manage leave types, document and notice rules, leave balances",
  "attendance.correct": "Correct attendance records (with mandatory reason)",
  "attendance.verify": "Verify clock-ins",
  "report.export": "Export operational reports",
  "audit.view": "View audit logs",
  "approval.reassign": "Reassign or escalate pending approvals",
  "policy.manage": "Manage WFO policies and versions",
  "level.manage": "Manage employee levels",
  "team.manage": "Manage departments, teams, leaders and backup approvers",
  "user.manage": "Manage user access and roles",
  "settings.manage": "Manage system-wide, approval and security settings",
  "content.manage": "Manage Company Hub content: About MIL, regulations, announcements, recognition",
  "client.manage": "Create and edit clients, change client status, assign employees",
  "client.sensitive": "View client PIC contacts and internal notes for every client",
  "client.export": "Export the client directory",
  "clientPackage.manage": "Manage client packages and client rules",
} as const;
export type Permission = keyof typeof PERMISSIONS;

const EMPLOYEE: Permission[] = ["self.use"];
const LEADER: Permission[] = [...EMPLOYEE, "team.view", "team.approve", "team.changeLevel", "attendance.verify"];
const HR: Permission[] = [
  ...LEADER,
  "company.view",
  "employee.manage",
  "holiday.manage",
  "requestType.manage",
  "attendance.correct",
  "report.export",
  "audit.view",
  "approval.reassign",
  "content.manage",
];
const SUPER_ADMIN: Permission[] = Object.keys(PERMISSIONS) as Permission[];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  EMPLOYEE: new Set(EMPLOYEE),
  LEADER: new Set(LEADER),
  HR: new Set(HR),
  SUPER_ADMIN: new Set(SUPER_ADMIN),
};

export const ROLE_LABELS: Record<Role, string> = { EMPLOYEE: "Employee", LEADER: "Leader", HR: "HR / People Ops", SUPER_ADMIN: "Super Admin" };

/** Roles that may be set as someone's reporting leader / approver. */
export const APPROVER_ROLES: Role[] = ["LEADER", "HR", "SUPER_ADMIN"];

/** Permissions that can be granted to individual users on top of their role. */
export const GRANTABLE: Permission[] = ["client.manage", "client.sensitive", "client.export", "clientPackage.manage", "content.manage", "report.export", "audit.view"];

/** Named bundles offered in Settings → Roles & access. They are just sets of grants. */
export const GRANT_PRESETS: { key: string; label: string; permissions: Permission[] }[] = [
  { key: "client_manager", label: "Client / Business Manager", permissions: ["client.manage", "client.sensitive", "client.export", "clientPackage.manage"] },
  { key: "content_editor", label: "Workplace content editor", permissions: ["content.manage"] },
];

export function can(user: { role: Role; grants?: readonly string[] } | null | undefined, p: Permission): boolean {
  return !!user && (ROLE_PERMISSIONS[user.role].has(p) || !!user.grants?.includes(p));
}

export const hasCompanyScope = (user: { role: Role }) => can(user, "company.view");
