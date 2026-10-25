import Link from "next/link";
import { requirePagePermission } from "@/server/auth/guard";
import { listHubCategories, listSections } from "@/server/services/workplace";
import { db } from "@/server/db";
import { docToText } from "@/lib/content/format";
import { formatDateTime } from "@/lib/dates";
import { cn } from "@/lib/cn";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CategoryEditor, ConfirmDelete, SectionEditor } from "../workplace-forms";

const BUILT_IN = [
  { title: "Announcements", href: "/settings/announcements" },
  { title: "Regulations", href: "/settings/regulations" },
  { title: "Recognition", href: "/settings/recognition" },
];

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ category?: string }> }) {
  await requirePagePermission("content.manage");
  const { category: wanted } = await searchParams;
  const categories = await listHubCategories({ includeHidden: true });
  const current = categories.find((c) => c.id === wanted) ?? null;
  const [sections, employees] = await Promise.all([
    listSections({ includeHidden: true, categoryId: current?.id ?? null }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const people = employees.map((e) => ({ id: e.id, name: e.fullName }));
  const pageName = current?.title ?? "About MIL";
  const hubHref = current ? `/company/${current.slug}` : "/company";

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Company Hub categories" description="Each category is a tab in the Company Hub. Add your own next to the built-in ones." action={<CategoryEditor />} />
        <CardBody className="divide-y divide-line-2 pt-0">
          <CategoryRow title="About MIL" note="Built-in · Company 101 sections" selected={!current} href="/settings/content" />
          {categories.map((c) => (
            <CategoryRow
              key={c.id}
              title={c.title}
              note={`${c._count.sections} section${c._count.sections === 1 ? "" : "s"} · /company/${c.slug}`}
              hidden={!c.isPublished}
              selected={current?.id === c.id}
              href={`/settings/content?category=${c.id}`}
            >
              <CategoryEditor category={{ id: c.id, title: c.title, description: c.description ?? "", isPublished: c.isPublished, sortOrder: c.sortOrder }} />
              <ConfirmDelete
                kind="category"
                id={c.id}
                title={c.title}
                description={c._count.sections ? `The tab and its ${c._count.sections} section${c._count.sections === 1 ? "" : "s"} will be removed from the Company Hub. This can't be undone.` : "The tab will be removed from the Company Hub. This can't be undone."}
              />
            </CategoryRow>
          ))}
          {BUILT_IN.map((b) => <CategoryRow key={b.title} title={b.title} note="Built-in · managed on its own page" href={b.href} />)}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={current ? current.title : "About MIL / Company 101"}
          description={<>Sections shown in the <Link href={hubHref} className="text-brand-700 hover:underline">Company Hub → {pageName}</Link>. Empty sections are hidden from employees.</>}
          action={<SectionEditor categoryId={current?.id ?? null} people={people} />}
        />
        <CardBody className="divide-y divide-line-2">
          {sections.length === 0 && <p className="py-6 text-center text-[13.5px] text-muted">No sections yet. Add the first one to fill this tab.</p>}
          {sections.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-ink">
                  {s.title}
                  {!s.isPublished && <Badge>Hidden</Badge>}
                  {!docToText(s.body) && <Badge tone="warning">Empty</Badge>}
                </div>
                <div className="truncate text-[12px] text-muted">{docToText(s.body, 120) || "No content yet"} · updated {formatDateTime(s.updatedAt)}</div>
              </div>
              <div className="flex shrink-0 items-center">
                <SectionEditor section={{ id: s.id, title: s.title, body: s.body, isPublished: s.isPublished, sortOrder: s.sortOrder }} people={people} />
                <ConfirmDelete kind="section" id={s.id} title={s.title} description={`The section will be removed from ${pageName}. This can't be undone.`} />
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}

function CategoryRow({ title, note, href, selected, hidden, children }: { title: string; note: string; href: string; selected?: boolean; hidden?: boolean; children?: React.ReactNode }) {
  return (
    <div className={cn("-mx-2 flex items-center justify-between gap-3 rounded-xl px-2 py-2.5", selected && "bg-brand-50/70")}>
      <Link href={href} className="min-w-0 flex-1">
        <div className={cn("flex items-center gap-2 font-medium", selected ? "text-brand-700" : "text-ink hover:text-brand-700")}>
          {title}
          {hidden && <Badge>Hidden</Badge>}
          {selected && <Badge tone="brand">Editing below</Badge>}
        </div>
        <div className="truncate text-[12px] text-muted">{note}</div>
      </Link>
      {children && <div className="flex shrink-0 items-center">{children}</div>}
    </div>
  );
}
