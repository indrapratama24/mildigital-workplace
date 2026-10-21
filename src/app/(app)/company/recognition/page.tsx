import Link from "next/link";
import { Award, Cake, PartyPopper, Sparkles, TrendingUp } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { recognitionFeed } from "@/server/services/workplace";
import { formatDate, todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar } from "@/components/ui/misc";

export const metadata = { title: "Recognition" };

export default async function RecognitionPage() {
  const me = await requirePageUser();
  const feed = await recognitionFeed(me, { manualDays: 120 });
  const today = todayJakarta();
  const short = (d: string) => formatDate(d).replace(/ \d{4}$/, "");
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Section icon={Award} title="Recognition & milestones" empty="No recognition posted recently.">
        {feed.manual.map((m) => (
          <Line key={m.id} id={m.employee.id} name={m.employee.fullName} photoId={m.employee.photoId} title={m.title} sub={m.message ?? m.employee.jobTitle} right={short(m.date)} />
        ))}
      </Section>
      <Section icon={TrendingUp} title="Promotions" empty="No level promotions in the last 120 days.">
        {feed.promotions.map((p) => <Line key={`${p.employee.id}${p.date}`} id={p.employee.id} name={p.employee.fullName} photoId={p.employee.photoId} title={`${p.from} → ${p.to}`} sub={p.employee.jobTitle} right={short(p.date)} />)}
      </Section>
      <Section icon={Cake} title="Upcoming birthdays" empty="No birthdays in the next 30 days (or birthdays are private).">
        {feed.birthdays.map((b) => <Line key={b.id} id={b.id} name={b.name} title={b.isToday ? "Today 🎉" : short(b.date)} sub={b.team} right="" />)}
      </Section>
      <Section icon={PartyPopper} title="Work anniversaries this month" empty="No anniversaries this month.">
        {feed.anniversaries.map((a) => <Line key={a.id} id={a.id} name={a.name} title={`${a.years} year${a.years > 1 ? "s" : ""} at MIL`} sub={a.team} right={short(`${today.slice(0, 4)}${a.date.slice(4)}`)} />)}
      </Section>
      <Section icon={Sparkles} title="Welcome to the team" empty="No new joiners in the last 90 days.">
        {feed.newJoiners.map((n) => <Line key={n.id} id={n.id} name={n.name} title={n.title} sub={null} right={short(n.date)} />)}
      </Section>
    </div>
  );
}

function Section({ icon: Icon, title, empty, children }: { icon: typeof Award; title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" /> {title}</span>} />
      <CardBody className="space-y-1 pt-3">{children.length ? children : <p className="text-[13px] text-muted">{empty}</p>}</CardBody>
    </Card>
  );
}

function Line({ id, name, photoId, title, sub, right }: { id: string; name: string; photoId?: string | null; title: string; sub: string | null; right: string }) {
  return (
    <Link href={`/directory/${id}`} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-brand-50">
      <Avatar name={name} photoId={photoId} className="h-9 w-9" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-medium text-ink">{name} · <span className="text-brand-700">{title}</span></span>
        {sub && <span className="block truncate text-[12px] text-muted">{sub}</span>}
      </span>
      {right && <span className="shrink-0 text-[12px] font-medium text-ink-2">{right}</span>}
    </Link>
  );
}
