// Which parts of the Client & Portfolio summary each role may see. Super Admin and people who
// manage client packages always see everything (they configure it).
export const PORTFOLIO_STATS = {
  active: "Active clients",
  preparation: "Preparation",
  freeze: "Freeze",
  inactive: "Inactive",
  total: "Total clients",
  new: "New this month",
} as const;
export type PortfolioStat = keyof typeof PORTFOLIO_STATS;

export const VISIBILITY_ROLES = ["EMPLOYEE", "LEADER", "HR"] as const;
export type VisibilityRole = (typeof VISIBILITY_ROLES)[number];
export type PortfolioVisibility = Record<VisibilityRole, string[]>;
