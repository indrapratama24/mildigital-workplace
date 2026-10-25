// The body of a section-based Company Hub tab (About MIL and custom categories): a side table of
// contents on desktop, a sticky section menu on smaller screens, and one card per filled section.
import { BookOpen } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { ContentBody } from "@/components/app/content-body";
import { SectionJump } from "@/components/app/section-jump";
import { isEmptyContent } from "@/server/content";

type Section = { id: string; key: string; title: string; body: string };

export function HubSections({ label, sections, before, empty }: { label: string; sections: Section[]; before?: React.ReactNode; empty: { title: string; description: string } }) {
  const filled = sections.filter((s) => !isEmptyContent(s.body));
  return (
    <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <aside className="hidden lg:block">
        <nav className="sticky top-24 space-y-0.5 text-[13.5px]" aria-label={label}>
          <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</div>
          {filled.map((s) => <a key={s.id} href={`#${s.key}`} className="block rounded-xl px-3 py-1.5 text-ink-2 hover:bg-white hover:text-brand-700">{s.title}</a>)}
        </nav>
      </aside>
      <div className="min-w-0 space-y-5">
        <SectionJump label={label} groups={[{ items: filled.map((s) => ({ id: s.key, title: s.title })) }]} />
        {before}
        {filled.length === 0 ? (
          <EmptyState icon={BookOpen} title={empty.title} description={empty.description} />
        ) : (
          filled.map((s) => (
            <Card key={s.id} id={s.key} className="scroll-mt-32 lg:scroll-mt-24">
              <CardHeader title={s.title} />
              <CardBody><ContentBody body={s.body} /></CardBody>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
