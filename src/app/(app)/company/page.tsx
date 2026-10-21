import Link from "next/link";
import { BookOpen, Megaphone } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { announcementsFor, listSections } from "@/server/services/workplace";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { ContentBody } from "@/components/app/content-body";
import { isEmptyContent } from "@/server/content";
import { AnnouncementCard } from "@/components/app/workplace/announcement-card";

export const metadata = { title: "Company Hub" };

export default async function CompanyPage() {
  const me = await requirePageUser();
  const [sections, news] = await Promise.all([listSections(), announcementsFor(me.employeeId, { take: 3 })]);
  const filled = sections.filter((s) => !isEmptyContent(s.body));
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-0.5 text-[13.5px]" aria-label="About MIL">
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">Company 101</div>
          {filled.map((s) => <a key={s.id} href={`#${s.key}`} className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">{s.title}</a>)}
        </nav>
      </aside>
      <div className="min-w-0 space-y-5">
        {news.length > 0 && (
          <Card>
            <CardHeader title={<span className="flex items-center gap-2"><Megaphone className="h-4 w-4 text-brand-600" /> Latest announcements</span>} action={<Link href="/company/announcements" className="text-[13px] font-medium text-brand-700 hover:underline">All announcements</Link>} />
            <CardBody className="grid gap-3 md:grid-cols-3">{news.map((a) => <AnnouncementCard key={a.id} a={a} compact />)}</CardBody>
          </Card>
        )}
        {filled.length === 0 ? (
          <EmptyState icon={BookOpen} title="Company 101 is being written" description="Administrators can add the company introduction, vision, mission and more in Settings → About MIL." />
        ) : (
          filled.map((s) => (
            <Card key={s.id} id={s.key} className="scroll-mt-24">
              <CardHeader title={s.title} />
              <CardBody><ContentBody body={s.body} /></CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
