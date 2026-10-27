import {
  BookOpenText,
  Briefcase,
  Building2,
  CalendarClock,
  CalendarDays,
  Contact,
  Handshake,
  House,
  Inbox,
  Settings,
  ShieldCheck,
  TrendingUp,
  UsersRound,
  FileBarChart,
  type LucideIcon,
} from "lucide-react";
import type { Permission } from "@/server/authz";
import type { FeatureKey } from "@/lib/features";

export interface NavItem {
  /** Stable id; also used to filter by permission on the server. */
  id: string;
  feature?: FeatureKey;
  href?: string;
  label: string;
  icon: LucideIcon;
  any?: Permission[];
  badgeKey?: "approvals";
  match?: string[];
}

export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    items: [
      { id: "home", feature: "home", href: "/overview", label: "Home", icon: House },
      { id: "calendar", feature: "workCalendar", href: "/calendar", label: "My Work Calendar", icon: CalendarDays },
      { id: "internal-calendar", feature: "internalCalendar", href: "/internal-calendar", label: "Internal Calendar", icon: CalendarClock },
      { id: "requests", feature: "requests", href: "/requests", label: "Requests & Approvals", icon: Inbox, badgeKey: "approvals", match: ["/requests", "/approvals", "/delegations"] },
      { id: "team-calendar", href: "/team-calendar", label: "Team Calendar", icon: UsersRound, any: ["team.view"] },
      { id: "compliance", href: "/compliance", label: "Attendance & Compliance", icon: ShieldCheck },
      { id: "leave-report", href: "/reports/leave", label: "Leave & Permission Report", icon: FileBarChart, any: ["team.view", "company.view"] },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    items: [
      { id: "company", feature: "companyHub", href: "/company", label: "Company Hub", icon: Building2 },
      { id: "directory", feature: "teamDirectory", href: "/directory", label: "Team Directory", icon: Contact },
      { id: "clients", feature: "clients", href: "/clients", label: "Client & Portfolio", icon: Briefcase },
    ],
  },
  {
    id: "growth",
    label: "Development & Growth",
    items: [
      { id: "knowledge", feature: "knowledgeHub", label: "MIL Academy – Knowledge Hub", icon: BookOpenText },
      { id: "performance", feature: "performance", label: "Performance & Growth", icon: TrendingUp },
      { id: "collaboration", feature: "collaboration", label: "Collaboration Hub", icon: Handshake },
    ],
  },
  {
    id: "management",
    label: "Management",
    items: [
      {
        id: "settings",
        href: "/settings",
        label: "Settings & Administration",
        icon: Settings,
        any: ["policy.manage", "holiday.manage", "requestType.manage", "team.manage", "user.manage", "settings.manage", "audit.view", "content.manage", "clientPackage.manage", "employee.manage"],
      },
    ],
  },
];

export const NAV_ITEMS = NAV_GROUPS.flatMap((g) => g.items);
