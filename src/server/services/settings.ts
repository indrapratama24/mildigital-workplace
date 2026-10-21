import { db, type DbOrTx } from "../db";
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
