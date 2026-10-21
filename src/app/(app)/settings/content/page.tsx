import Link from "next/link";
import { requirePagePermission } from "@/server/auth/guard";
import { listSections } from "@/server/services/workplace";
import { formatDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SectionEditor } from "../workplace-forms";

export default async function ContentPage() {
  await requirePagePermission("content.manage");
  const sections = await listSections({ includeHidden: true });
  return (
    <Card>
      <CardHeader
        title="About MIL / Company 101"
        description={<>Shown in the <Link href="/company" className="text-brand-700 hover:underline">Company Hub</Link>. Empty sections are hidden from employees.</>}
        action={<SectionEditor />}
      />
      <CardBody className="divide-y divide-line-2">
        {sections.map((s) => (
          <div key={s.id} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 font-medium text-ink">
                {s.title}
                {!s.isPublished && <Badge>Hidden</Badge>}
                {!s.body.trim() && <Badge tone="warning">Empty</Badge>}
              </div>
              <div className="truncate text-[12px] text-muted">{s.body.trim() ? s.body.slice(0, 120) : "No content yet"} · updated {formatDateTime(s.updatedAt)}</div>
            </div>
            <SectionEditor section={{ id: s.id, title: s.title, body: s.body, isPublished: s.isPublished, sortOrder: s.sortOrder }} />
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
