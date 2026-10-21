import { notFound, redirect } from "next/navigation";
import { requirePageUser } from "@/server/auth/guard";
import { getEventDetail } from "@/server/services/events";
import { DomainError } from "@/server/errors";
import { PageHeader } from "@/components/ui/misc";
import { EventForm } from "@/components/app/events/event-form";
import { formOptions, valuesFromDetail } from "../../../form-data";

export const metadata = { title: "Edit event" };

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  const e = await getEventDetail(me, id).catch((err) => {
    if (err instanceof DomainError) return null;
    throw err;
  });
  if (!e) notFound();
  if (!e.perms.canEdit || e.status === "CANCELLED") redirect(`/internal-calendar/events/${id}`);
  const opts = await formOptions();
  return (
    <>
      <PageHeader eyebrow="Internal Calendar" title={`Edit · ${e.title}`} description={e.recurrence ? `Recurring: ${e.recurrence.rule}. Choose which occurrences to update.` : "Changes to published events are recorded and participants are notified."} />
      <EventForm mode="edit" eventId={e.id} status={e.status} isSeries={!!e.recurrence} initial={valuesFromDetail(e, { keepRecurrence: true })} {...opts} />
    </>
  );
}
