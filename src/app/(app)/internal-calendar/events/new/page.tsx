import { redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/guard";
import { canCreateEvents } from "@/server/services/calendar-access";
import { getEventDetail } from "@/server/services/events";
import { addDays, isValidISO, todayJakarta } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { EventForm, type EventFormValues } from "@/components/app/events/event-form";
import { formOptions, valuesFromDetail } from "../../form-data";

export const metadata = { title: "New event" };

export default async function NewEventPage({ searchParams }: { searchParams: Promise<{ from?: string; date?: string }> }) {
  const me = await requirePageUser();
  if (!(await canCreateEvents(me))) redirect("/internal-calendar");
  const sp = await searchParams;
  const opts = await formOptions();
  const date = sp.date && isValidISO(sp.date) && sp.date >= todayJakarta() ? sp.date : addDays(todayJakarta(), 1);
  let initial: EventFormValues = {
    title: "",
    categoryId: opts.categories[0]?.id ?? "",
    topic: "",
    description: "",
    date,
    startTime: "10:00",
    endDate: date,
    endTime: "11:00",
    locationType: "IN_OFFICE",
    locationDetail: "",
    meetingUrl: "",
    organizerId: me.employeeId,
    attendanceRequirement: "MANDATORY",
    wfoRequirement: "NONE",
    reminderMinutes: [1440, 60],
    allowOnOffDays: false,
    rules: [],
    recurrence: { freq: "NONE", interval: 1, byWeekdays: [], untilDate: date },
  };
  let duplicateOf: string | null = null;
  if (sp.from) {
    const src = await getEventDetail(me, sp.from).catch(() => null);
    if (src) {
      // duplicates start as a one-time event on the next available day with the same details
      initial = { ...valuesFromDetail(src, { keepRecurrence: false }), title: `${src.title} (copy)`, date, endDate: date };
      duplicateOf = src.title;
    }
  }
  return (
    <>
      <PageHeader eyebrow="Internal Calendar" title={duplicateOf ? "Duplicate event" : "New event"} description={duplicateOf ? `Copy of “${duplicateOf}”. Adjust the date and details, then save.` : "Save as a draft or publish straight away. Participants are notified when it's published."} />
      <EventForm mode="create" initial={initial} {...opts} />
    </>
  );
}
