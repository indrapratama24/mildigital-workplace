// Periodic jobs: deadline reminders, WFO shortfall detection, approval escalation.
// Trigger via POST /api/cron (Authorization: Bearer $CRON_SECRET), `npm run cron`, or Settings → System.
import { db } from "../db";
import { addMonths, currentMonthJakarta, formatMonth, todayJakarta } from "@/lib/dates";
import { evaluateAttendance, evaluatePlan } from "@/lib/engine/working-days";
import { loadMonthContexts } from "./calendar";
import { notify } from "./notifications";
import { getLeader } from "./org";
import { getSettings } from "./settings";
import { attendanceInputs } from "./schedules";
import { escalateOverdue } from "./approvals";
import { refreshDynamicParticipants, sendDueReminders, sweepEventsOnOffDays } from "./events";

export async function runDailyJobs(now = new Date()) {
  const today = todayJakarta(now);
  const settings = await getSettings();
  const cur = currentMonthJakarta(now);
  const next = addMonths(cur.year, cur.month, 1);
  const employees = await db.employee.findMany({ where: { isActive: true }, select: { id: true } });
  const ids = employees.map((e) => e.id);
  let reminders = 0,
    shortfalls = 0;

  // 1. Next month's plan deadline (policy submission deadline day of the current month)
  const nextCtx = await loadMonthContexts(ids, next.year, next.month);
  const dayOfMonth = Number(today.slice(8, 10));
  for (const [id, ctx] of nextCtx) {
    if (!ctx.policy) continue;
    const deadline = ctx.policy.version.submissionDeadlineDay;
    const daysLeft = deadline - dayOfMonth;
    const submitted = ctx.schedule && !["DRAFT", "CHANGES_REQUESTED", "REJECTED"].includes(ctx.schedule.status);
    if (!submitted && daysLeft >= 0 && daysLeft <= settings.reminderDaysBeforeDeadline) {
      await notify(db, {
        employeeId: id,
        type: "DEADLINE_APPROACHING",
        title: `Submit your ${formatMonth(next.year, next.month)} work plan`,
        body: daysLeft === 0 ? "The submission deadline is today." : `Deadline in ${daysLeft} day(s) (day ${deadline} of this month).`,
        link: `/calendar?month=${next.year}-${String(next.month).padStart(2, "0")}`,
        dedupeKey: `deadline:${next.year}-${next.month}:${daysLeft}`,
      });
      reminders++;
    }
  }

  // 2. Current-month shortfall detection on approved plans and actual attendance
  const curCtx = await loadMonthContexts(ids, cur.year, cur.month);
  for (const [id, ctx] of curCtx) {
    if (!ctx.requirement || !Object.keys(ctx.approvedModes).length) continue;
    const plan = evaluatePlan(ctx.requirement, ctx.approvedModes);
    const att = evaluateAttendance(ctx.requirement, ctx.approvedModes, attendanceInputs(ctx), today);
    if (plan.shortfall > 0 || att.status === "PROJECTED_SHORTFALL") {
      const days = Math.max(plan.shortfall, att.remainingRequiredWfo - att.futurePlannedWfo);
      await notify(db, {
        employeeId: id,
        type: "WFO_SHORTFALL",
        title: `WFO shortfall: ${days} day(s) this month`,
        body: "Request a schedule change to add replacement WFO days, or ask your leader about an exception.",
        link: "/calendar",
        dedupeKey: `shortfall:${cur.year}-${cur.month}:${days}`,
      });
      const leader = await getLeader(db, id, today);
      if (leader) await notify(db, { employeeId: leader.id, type: "WFO_SHORTFALL", title: "A team member has a projected WFO shortfall", body: `${days} day(s) short this month.`, link: "/compliance", dedupeKey: `shortfall:${id}:${cur.year}-${cur.month}:${days}` });
      shortfalls++;
    }
  }

  // 3. Escalate overdue approvals
  const escalation = await escalateOverdue(now);
  // 4. Internal Calendar: dynamic participant groups and due event reminders
  const offDays = await sweepEventsOnOffDays(db);
  const dynamic = await refreshDynamicParticipants();
  const eventReminders = await sendDueReminders(now);
  return { today, reminders, shortfalls, ...escalation, dynamicParticipantsAdded: dynamic.added, eventsCancelledOnOffDays: offDays.cancelled, eventReminders: eventReminders.sent };
}
