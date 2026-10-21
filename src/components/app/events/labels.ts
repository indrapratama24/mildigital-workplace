export const LOCATION_LABEL = { IN_OFFICE: "In office", ONLINE: "Online", HYBRID: "Hybrid", EXTERNAL: "External location" } as const;
export const ATTENDANCE_LABEL = { MANDATORY: "Mandatory", OPTIONAL: "Optional" } as const;
export const WFO_LABEL = { IN_OFFICE_REQUIRED: "In-office attendance required", REMOTE_ALLOWED: "Remote attendance allowed", NONE: "No specific WFO requirement" } as const;
export const SOURCE_LABEL = { ALL: "All employees", DEPARTMENT: "Department", TEAM: "Team", LEVEL: "Level", EMPLOYEE: "Individual" } as const;
export const ACTION_LABEL: Record<string, string> = {
  PUBLISHED: "Published",
  UPDATED: "Edited (this occurrence)",
  UPDATED_FOLLOWING: "Edited (this and following)",
  UPDATED_SERIES: "Edited (entire series)",
  CANCELLED: "Cancelled",
  CANCELLED_BY_SERIES_CHANGE: "Removed by recurrence change",
  CREATED_BY_SERIES_CHANGE: "Added by recurrence change",
  PARTICIPANTS_REFRESHED: "Participants refreshed",
  DYNAMIC_MEMBERSHIP_SYNC: "Participants synced (dynamic)",
};
