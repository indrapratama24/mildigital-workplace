// Office schedule (used while the WFO Policy is off): the Super Admin decides which days are WFO.
// Pure resolution, no DB access: a team's date override beats the company's, which beats a team's weekly
// pattern, which beats the company pattern. So closing the office for everyone wins over any team's usual days.
import { isoWeekday, type ISODate } from "@/lib/dates";

export type OfficeMode = "WFO" | "WFH";

export interface OfficeOverride {
  teamId: string | null;
  date: ISODate;
  mode: OfficeMode;
  note: string | null;
}

export interface OfficeConfig {
  /** Company weekly WFO days (ISO weekdays, 1 = Monday). */
  companyWeekdays: number[];
  /** Teams with their own weekly WFO days; other teams follow the company. */
  teamWeekdays: Record<string, number[]>;
  overrides: OfficeOverride[];
}

export interface OfficeDayInfo {
  mode: OfficeMode;
  note: string | null;
  /** PATTERN = weekly days, OVERRIDE = set for this date. */
  source: "PATTERN" | "OVERRIDE";
  scope: "COMPANY" | "TEAM";
}

export function officeResolver(cfg: OfficeConfig) {
  const byKey = new Map(cfg.overrides.map((o) => [`${o.teamId ?? ""}|${o.date}`, o]));
  return (teamId: string | null, date: ISODate): OfficeDayInfo => {
    const team = teamId ? byKey.get(`${teamId}|${date}`) : undefined;
    if (team) return { mode: team.mode, note: team.note, source: "OVERRIDE", scope: "TEAM" };
    const company = byKey.get(`|${date}`);
    if (company) return { mode: company.mode, note: company.note, source: "OVERRIDE", scope: "COMPANY" };
    const own = teamId ? cfg.teamWeekdays[teamId] : undefined;
    const weekdays = own ?? cfg.companyWeekdays;
    return { mode: weekdays.includes(isoWeekday(date)) ? "WFO" : "WFH", note: null, source: "PATTERN", scope: own ? "TEAM" : "COMPANY" };
  };
}
