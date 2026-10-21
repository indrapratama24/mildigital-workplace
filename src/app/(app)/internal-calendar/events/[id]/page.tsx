import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { getEventDetail } from "@/server/services/events";
import { DomainError } from "@/server/errors";
import { Card, CardBody } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { EventDetailView } from "@/components/app/events/event-detail-view";

export const metadata = { title: "Event" };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  let e;
  try {
    e = await getEventDetail(me, id);
  } catch (err) {
    if (err instanceof DomainError && err.code === "NOT_FOUND") notFound();
    if (err instanceof DomainError && err.code === "FORBIDDEN")
      return <Notice tone="warning" title="Not available">This event is only visible to its participants.</Notice>;
    throw err;
  }
  return (
    <>
      <Link href={`/internal-calendar?month=${e.date.slice(0, 7)}`} className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-brand-700 hover:underline">
        <ArrowLeft className="h-4 w-4" /> Internal Calendar
      </Link>
      <PageHeader eyebrow={e.category.name} title={e.title} description={`${e.topic} · ${e.timeLabel}`} />
      <Card className="max-w-3xl">
        <CardBody>
          <EventDetailView e={e} />
        </CardBody>
      </Card>
    </>
  );
}
