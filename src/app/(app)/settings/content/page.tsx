import Link from "next/link";
import { requirePagePermission } from "@/server/auth/guard";
import { listSections } from "@/server/services/workplace";
import { db } from "@/server/db";
import { docToText } from "@/lib/content/format";
import { formatDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionEditor } from "../workplace-forms";

export default async function ContentPage() {
  await requirePagePermission("content.manage");
  const [sections, employees] = await Promise.all([listSections({ includeHidden: true }), db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })]);
  const people = employees.map((e) => ({ id: e.id, name: e.fullName }));
  return (
    <Card>
      <CardHeader
        title="About MIL / Company 101"
        description={<>Shown in the <Link href="/company" className="text-brand-700 hover:underline">Company Hub</Link>. Empty sections are hidden from employees.</>}
        action={<SectionEditor people={people} />}
      />
      <CardBody className="divide-y divide-line-2">
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
            <SectionEditor section={{ id: s.id, title: s.title, body: s.body, isPublished: s.isPublished, sortOrder: s.sortOrder }} people={people} />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
