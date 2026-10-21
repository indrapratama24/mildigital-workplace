import { Megaphone } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { announcementsFor } from "@/server/services/workplace";
import { EmptyState } from "@/components/ui/misc";
import { AnnouncementCard } from "@/components/app/workplace/announcement-card";

export const metadata = { title: "Announcements" };

export default async function AnnouncementsPage() {
  const me = await requirePageUser();
  const items = await announcementsFor(me.employeeId, { take: 100 });
  if (!items.length) return <EmptyState icon={Megaphone} title="No current announcements" description="Published announcements for you appear here until they expire." />;
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{items.map((a) => <AnnouncementCard key={a.id} a={a} />)}</div>;
}
