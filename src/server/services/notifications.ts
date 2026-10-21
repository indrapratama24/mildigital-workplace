import type { DbOrTx } from "../db";
import { db } from "../db";
import { getEmailAdapter } from "../adapters/email";

export type NotificationType =
  | "SCHEDULE_SUBMITTED"
  | "SCHEDULE_APPROVED"
  | "SCHEDULE_REJECTED"
  | "SCHEDULE_CHANGES_REQUESTED"
  | "REVISION_SUBMITTED"
  | "REVISION_DECIDED"
  | "DELEGATION_ASSIGNED"
  | "DELEGATION_ACCEPTED"
  | "DELEGATION_DECLINED"
  | "DELEGATION_CLARIFICATION"
  | "REQUEST_PENDING"
  | "REQUEST_APPROVED"
  | "REQUEST_REJECTED"
  | "REQUEST_CHANGES_REQUESTED"
  | "WFO_SHORTFALL"
  | "REPLACEMENT_REQUIRED"
  | "DEADLINE_APPROACHING"
  | "APPROVAL_REASSIGNED"
  | "ATTENDANCE_CORRECTED"
  | "EVENT_PUBLISHED"
  | "EVENT_ADDED"
  | "EVENT_TIME_CHANGED"
  | "EVENT_CANCELLED"
  | "EVENT_CONFLICT"
  | "EVENT_REMINDER"
  | "REGULATION_PUBLISHED"
  | "RECOGNITION";

export interface NotifyInput {
  employeeId?: string;
  userId?: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  /** Prevents duplicate reminders (unique per user). */
  dedupeKey?: string;
}

export async function notify(tx: DbOrTx, n: NotifyInput) {
  let userId = n.userId;
  let email: string | undefined;
  if (!userId && n.employeeId) {
    const emp = await tx.employee.findUnique({ where: { id: n.employeeId }, select: { userId: true, email: true } });
    userId = emp?.userId ?? undefined;
    email = emp?.email;
  }
  if (!userId) return;
  const res = await tx.notification.createMany({
    data: [{ userId, type: n.type, title: n.title, body: n.body, link: n.link, dedupeKey: n.dedupeKey }],
    skipDuplicates: true,
  });
  if (res.count && email) {
    const adapter = getEmailAdapter();
    if (adapter.name !== "none") {
      const base = process.env.APP_URL ?? "";
      void adapter.send({ to: email, subject: n.title, text: n.body, link: n.link ? base + n.link : undefined }).catch(() => {});
    }
  }
}

export async function unreadCount(userId: string) {
  return db.notification.count({ where: { userId, readAt: null } });
}
