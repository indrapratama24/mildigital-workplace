import { db, type DbOrTx } from "../db";
import { DEFAULT_ANNUAL_RULES, type AnnualLeaveRules } from "@/lib/engine/leave";
import { audit } from "./audit";

export interface AppSettings {
  workingWeekdays: number[];
  cutiBersamaIsHoliday: boolean;
  clockInValidatesDay: boolean;
  leaderDeadlineHours: number;
  delegateDeadlineHours: number;
  escalation: "BACKUP_APPROVER" | "LEADERS_LEADER" | "HR";
  hrFallbackEmployeeId: string | null;
  reminderDaysBeforeDeadline: number;
  defaultRequireDelegationFor: string[];
  /** ALL = every employee sees all published internal events; ASSIGNED = only events they're assigned to (plus calendar grants) */
  calendarVisibility: "ALL" | "ASSIGNED";
  /** MIL Academy (Knowledge Hub) URL; null = platform still in development. */
  knowledgeHubUrl: string | null;
  /** Active clients need Consultant 1 unless an authorised exception is recorded. */
  clientRequirePrimaryConsultant: boolean;
  /** Counting rule: whether Freeze clients are included in "Active clients". */
  clientFreezeCountsAsActive: boolean;
  /** Leaders highlighted in the Team Directory (ordered); null = not curated yet (team leads are shown). */
  directoryLeaders: { employeeId: string; caption: string | null }[] | null;
  /** Portfolio breakdown charts shown on Client & Portfolio, in order. */
  clientHighlights: string[];
  /** Approver after the leader (e.g. CEO) for the request types listed below; null = no final approval. */
  finalApproverEmployeeId: string | null;
  finalApprovalRequestTypes: string[];
  /** Annual leave policy for request types with `annualRules`. */
  annualLeaveRules: AnnualLeaveRules;
  /** Year-end leftover: up to `maxDays` can be paid out or carried over; the choice opens `windowDays` before 31 Dec; carried days must be used by the end of `carryUntilMonth`. */
  leaveYearEnd: { enabled: boolean; maxDays: number; windowDays: number; carryUntilMonth: number };
}

export const DEFAULT_SETTINGS: AppSettings = {
  workingWeekdays: [1, 2, 3, 4, 5],
  cutiBersamaIsHoliday: true,
  clockInValidatesDay: false,
  leaderDeadlineHours: 48,
  delegateDeadlineHours: 24,
  escalation: "BACKUP_APPROVER",
  hrFallbackEmployeeId: null,
  reminderDaysBeforeDeadline: 3,
  defaultRequireDelegationFor: [],
  calendarVisibility: "ALL",
  knowledgeHubUrl: null,
  clientRequirePrimaryConsultant: true,
  clientFreezeCountsAsActive: false,
  directoryLeaders: null,
  clientHighlights: ["package", "category", "consultant"],
  finalApproverEmployeeId: null,
  finalApprovalRequestTypes: [],
  annualLeaveRules: DEFAULT_ANNUAL_RULES,
  leaveYearEnd: { enabled: true, maxDays: 6, windowDays: 30, carryUntilMonth: 6 },
};

export async function getSettings(tx: DbOrTx = db): Promise<AppSettings> {
  const rows = await tx.systemSetting.findMany();
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) merged[r.key] = r.value;
  return merged as unknown as AppSettings;
}

export async function updateSettings(actor: { userId: string }, patch: Partial<AppSettings>) {
  const before = await getSettings();
  await db.$transaction(async (tx) => {
    for (const [key, value] of Object.entries(patch)) {
      if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
      await tx.systemSetting.upsert({
        where: { key },
        create: { key, value: value as never, updatedById: actor.userId },
        update: { value: value as never, updatedById: actor.userId },
      });
    }
    await audit(tx, { actorUserId: actor.userId, action: "settings.update", entityType: "SystemSetting", entityId: "global", before, after: { ...before, ...patch } });
  });
}
