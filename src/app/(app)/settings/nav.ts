import type { Permission } from "@/server/authz";

export interface SettingsNavItem {
  href: string;
  label: string;
  perm: Permission;
}

export const SETTINGS_GROUPS: { label: string; items: SettingsNavItem[] }[] = [
  {
    label: "People & Organization",
    items: [
      { href: "/settings/directory", label: "Employees & privacy", perm: "employee.manage" },
      { href: "/settings/teams", label: "Teams & departments", perm: "team.manage" },
    ],
  },
  {
    label: "Work Arrangement",
    items: [
      { href: "/settings/policies", label: "WFO policies & levels", perm: "policy.manage" },
      { href: "/settings/holidays", label: "Holidays", perm: "holiday.manage" },
      { href: "/settings/requests", label: "Request types", perm: "requestType.manage" },
      { href: "/settings/approvals", label: "Approvals", perm: "settings.manage" },
    ],
  },
  {
    label: "Internal Calendar",
    items: [{ href: "/settings/calendar", label: "Categories & permissions", perm: "team.manage" }],
  },
  {
    label: "Client Management",
    items: [{ href: "/settings/clients", label: "Packages & client rules", perm: "clientPackage.manage" }],
  },
  {
    label: "Workplace Content",
    items: [
      { href: "/settings/content", label: "About MIL", perm: "content.manage" },
      { href: "/settings/regulations", label: "Regulations", perm: "content.manage" },
      { href: "/settings/announcements", label: "Announcements", perm: "content.manage" },
      { href: "/settings/recognition", label: "Recognition", perm: "content.manage" },
    ],
  },
  {
    label: "Platform",
    items: [
      { href: "/settings/access", label: "Roles & access", perm: "user.manage" },
      { href: "/settings/platform", label: "Knowledge Hub & notifications", perm: "settings.manage" },
      { href: "/settings/security", label: "Security & audit log", perm: "audit.view" },
      { href: "/settings/system", label: "System & jobs", perm: "settings.manage" },
    ],
  },
];

export const SETTINGS_NAV = SETTINGS_GROUPS.flatMap((g) => g.items);
