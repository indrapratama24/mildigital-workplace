// Central module availability. The sidebar, quick actions and the route guard all read from here,
// so a module is switched on, made external or marked "coming soon" in one place.
export type FeatureStatus = "enabled" | "external" | "coming_soon";

export const FEATURES = {
  home: "enabled",
  workCalendar: "enabled",
  internalCalendar: "enabled",
  requests: "enabled",
  companyHub: "enabled",
  teamDirectory: "enabled",
  clients: "enabled",
  knowledgeHub: "external",
  performance: "coming_soon",
  collaboration: "coming_soon",
} as const satisfies Record<string, FeatureStatus>;

export type FeatureKey = keyof typeof FEATURES;
export const featureStatus = (k: FeatureKey): FeatureStatus => FEATURES[k];
export const isEnabled = (k: FeatureKey) => FEATURES[k] === "enabled";
