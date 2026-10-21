import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Paperclip } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { getAnnouncement } from "@/server/services/workplace";
import { DomainError } from "@/server/errors";
import { formatDateTime } from "@/lib/dates";
import { Card, CardBody } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/misc";
import { RichText } from "@/components/app/rich-text";

export default async function AnnouncementPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  const a = await getAnnouncement(me, id).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const now = new Date();
  const live = a.status === "PUBLISHED" && a.publishAt <= now && (!a.expiresAt || a.expiresAt > now);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/company/announcements" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand-700"><ArrowLeft className="h-4 w-4" /> Announcements</Link>
      {!live && <Notice tone="warning" className="mb-4">Preview — this announcement is not currently visible to employees ({a.status.toLowerCase()}).</Notice>}
      <Card>
        <CardBody className="space-y-4 p-6">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone="brand">{a.category}</Badge>
            {a.priority !== "NORMAL" && <Badge tone={a.priority === "CRITICAL" ? "danger" : "warning"}>{a.priority.toLowerCase()}</Badge>}
          </div>
          <h2 className="font-display text-[26px] font-extrabold tracking-tight text-ink">{a.title}</h2>
          <div className="text-[12.5px] text-muted">{formatDateTime(a.publishAt)} · {a.createdBy.fullName}{a.expiresAt && ` · until ${formatDateTime(a.expiresAt)}`}</div>
          <RichText text={a.body} />
          <div className="flex flex-wrap gap-2">
            {a.linkUrl && <a href={a.linkUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300"><ExternalLink className="h-3.5 w-3.5" /> Open link</a>}
            {a.attachment && <a href={`/api/files/${a.attachment.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300"><Paperclip className="h-3.5 w-3.5" /> {a.attachment.originalName}</a>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
