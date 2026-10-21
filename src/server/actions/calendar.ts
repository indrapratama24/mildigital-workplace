"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { cancelEvent, createEvent, deleteDraft, getEventDetail, previewParticipants, publishEvent, refreshParticipants, requestConflictException, updateEvent } from "../services/events";
import { addCalendarGrant, removeCalendarGrant, setCalendarVisibility, upsertEventCategory } from "../services/calendar-admin";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a valid time");
const rule = z.object({ type: z.enum(["ALL", "DEPARTMENT", "TEAM", "LEVEL", "EMPLOYEE"]), targetId: z.string().nullable(), dynamic: z.boolean() });
const eventSchema = z.object({
  title: z.string().max(140),
  categoryId: z.string().min(1, "Choose a category"),
  topic: z.string().max(200),
  description: z.string().max(4000).nullable().optional(),
  date,
  startTime: time,
  endDate: date,
  endTime: time,
  locationType: z.enum(["IN_OFFICE", "ONLINE", "HYBRID", "EXTERNAL"]),
  locationDetail: z.string().max(300).nullable().optional(),
  meetingUrl: z.string().max(500).nullable().optional(),
  organizerId: z.string().min(1, "Choose an organizer"),
  attendanceRequirement: z.enum(["MANDATORY", "OPTIONAL"]),
  wfoRequirement: z.enum(["IN_OFFICE_REQUIRED", "REMOTE_ALLOWED", "NONE"]),
  reminderMinutes: z.array(z.number().int()).max(5),
  rules: z.array(rule).max(100),
  allowOnOffDays: z.boolean().optional(),
  recurrence: z.object({ freq: z.enum(["NONE", "DAILY", "WEEKLY", "MONTHLY", "CUSTOM"]), interval: z.number().int(), byWeekdays: z.array(z.number().int().min(1).max(7)).max(7), untilDate: date }),
});
const scope = z.enum(["THIS", "FOLLOWING", "SERIES"]);
const refresh = () => revalidatePath("/", "layout");

export async function createEventAction(input: unknown, publish: boolean) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await createEvent(me, eventSchema.parse(input), publish);
    refresh();
    return r;
  }, publish ? "Event published" : "Draft saved");
}

export async function updateEventAction(id: string, input: unknown, editScope: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await updateEvent(me, z.string().parse(id), eventSchema.parse(input), scope.parse(editScope));
    refresh();
    return r;
  }, "Event updated");
}

export async function publishEventAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await publishEvent(me, z.string().parse(id));
    refresh();
    return r;
  }, "Event published");
}

export async function cancelEventAction(id: string, editScope: unknown, reason: string) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await cancelEvent(me, z.string().parse(id), scope.parse(editScope), z.string().max(500).parse(reason));
    refresh();
    return r;
  }, "Event cancelled");
}

export async function deleteDraftAction(id: string, editScope: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await deleteDraft(me, z.string().parse(id), scope.parse(editScope));
    refresh();
    return r;
  }, "Draft deleted");
}

export async function refreshParticipantsAction(id: string, editScope: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await refreshParticipants(me, z.string().parse(id), scope.parse(editScope));
    refresh();
    return r;
  });
}

export async function previewParticipantsAction(rules: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    return previewParticipants(me, z.array(rule).max(100).parse(rules));
  });
}

export async function eventDetailAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    return getEventDetail(me, z.string().parse(id));
  });
}

export async function requestConflictExceptionAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ eventId: z.string(), date, reason: z.string().max(1000) }).parse(input);
    await requestConflictException(me, p);
    refresh();
  }, "Exception request sent to your leader");
}

export async function addCalendarGrantAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        subjectType: z.enum(["EMPLOYEE", "TEAM", "ROLE"]),
        subjectId: z.string().min(1, "Choose who gets the permission"),
        permissionRole: z.enum(["VIEWER", "ORGANIZER", "EDITOR", "MANAGER"]),
        scope: z.enum(["ALL", "DEPARTMENT", "TEAM"]),
        scopeId: z.string().nullable(),
      })
      .parse(input);
    await addCalendarGrant(me, p);
    refresh();
  }, "Calendar permission added");
}

export async function removeCalendarGrantAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await removeCalendarGrant(me, z.string().parse(id));
    refresh();
  }, "Calendar permission removed");
}

export async function upsertEventCategoryAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await upsertEventCategory(me, z.object({ id: z.string().optional(), name: z.string().max(60), color: z.string(), isActive: z.boolean() }).parse(input));
    refresh();
  }, "Category saved");
}

export async function setCalendarVisibilityAction(value: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await setCalendarVisibility(me, z.enum(["ALL", "ASSIGNED"]).parse(value));
    refresh();
  }, "Visibility updated");
}
