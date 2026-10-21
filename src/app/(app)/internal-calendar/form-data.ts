import { db } from "@/server/db";
import { getOffDays } from "@/server/services/events";
import { addDays, todayJakarta } from "@/lib/dates";
import type { EventDetail } from "@/server/services/events";
import type { EventFormValues } from "@/components/app/events/event-form";

export async function formOptions() {
  const today = todayJakarta();
  const [categories, employees, teams, departments, levels, offDays] = await Promise.all([
    db.internalEventCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" } }),
    getOffDays(db, addDays(today, -31), addDays(today, 400)),
  ]);
  return {
    offDays,
    categories: categories.map((c) => ({ id: c.id, name: c.name, color: c.color })),
    employees: employees.map((e) => ({ id: e.id, name: e.fullName })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
    departments: departments.map((d) => ({ id: d.id, name: d.name })),
    levels: levels.map((l) => ({ id: l.id, name: l.name })),
  };
}

export function valuesFromDetail(e: EventDetail, opts: { keepRecurrence: boolean }): EventFormValues {
  return {
    title: e.title,
    categoryId: e.category.id,
    topic: e.topic,
    description: e.description ?? "",
    date: e.date,
    startTime: e.startTime,
    endDate: e.endDate,
    endTime: e.endTime,
    locationType: e.locationType,
    locationDetail: e.locationDetail ?? "",
    meetingUrl: e.meetingUrl ?? "",
    organizerId: e.organizer.id,
    attendanceRequirement: e.attendanceRequirement,
    wfoRequirement: e.wfoRequirement,
    reminderMinutes: e.reminderMinutes,
    allowOnOffDays: e.allowOnOffDays,
    rules: e.rules.map((r) => ({ type: r.type, targetId: r.targetId, dynamic: r.dynamic })),
    recurrence:
      opts.keepRecurrence && e.recurrence
        ? { freq: e.recurrence.freq, interval: e.recurrence.interval, byWeekdays: e.recurrence.byWeekdays, untilDate: e.recurrence.untilDate }
        : { freq: "NONE", interval: 1, byWeekdays: [], untilDate: e.date },
  };
}
