import Link from "next/link";
import { Megaphone } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { announcementsFor, listSections } from "@/server/services/workplace";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AnnouncementCard } from "@/components/app/workplace/announcement-card";
import { HubSections } from "@/components/app/workplace/hub-sections";

export const metadata = { title: "Company Hub" };

export default async function CompanyPage() {
  const me = await requirePageUser();
  const [sections, news] = await Promise.all([listSections(), announcementsFor(me.employeeId, { take: 3 })]);
  return (
    <HubSections
      label="Company 101"
      sections={sections}
      empty={{ title: "Company 101 is being written", description: "Administrators can add the company introduction, vision, mission and more in Settings → About MIL & categories." }}
      before={
        news.length > 0 && (
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-600" /> Latest announcements</span>} action={<Link href="/company/announcements" className="text-[13px] font-medium text-brand-700 hover:underline">All announcements</Link>} />
            <CardBody className="grid gap-3 md:grid-cols-3">{news.map((a) => <AnnouncementCard key={a.id} a={a} compact />)}</CardBody>
          </Card>
        )
      }
    />
  );
}
