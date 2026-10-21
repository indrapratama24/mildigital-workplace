import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Paperclip } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { getRegulation } from "@/server/services/workplace";
import { DomainError } from "@/server/errors";
import { formatDate, formatDateTime, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, Table } from "@/components/ui/misc";
import { RichText } from "@/components/app/rich-text";
import { AcknowledgeButton } from "@/components/app/workplace/ack-button";

export default async function RegulationPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  const r = await getRegulation(me, id).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const v = r.publishedVersion ?? r.draft;
  if (!v) notFound();
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-4">
        <Link href="/company/regulations" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand-700"><ArrowLeft className="h-4 w-4" /> Regulations</Link>
        {!r.publishedVersion && <Notice tone="warning">Draft preview — not visible to employees until published.</Notice>}
        {r.status === "ARCHIVED" && <Notice tone="warning">Archived — no longer shown to employees.</Notice>}
        <Card>
          <CardBody className="space-y-4 p-6">
            <div className="flex flex-wrap items-center gap-1.5"><Badge tone="brand">{r.category}</Badge><Badge>v{v.version}</Badge></div>
            <h2 className="font-display text-[26px] font-extrabold tracking-tight text-ink">{v.title}</h2>
            {v.summary && <p className="text-[15px] text-muted">{v.summary}</p>}
            {v.body.trim() && <RichText text={v.body} />}
            <div className="flex flex-wrap gap-2">
              {v.documentUrl && <a href={v.documentUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300"><ExternalLink className="h-3.5 w-3.5" /> Open document</a>}
              {v.attachment && <a href={`/api/files/${v.attachment.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-brand-700 hover:border-brand-300"><Paperclip className="h-3.5 w-3.5" /> {v.attachment.originalName}</a>}
            </div>
          </CardBody>
        </Card>
        {r.requiresAcknowledgement && r.publishedVersion && (
          <Card>
            <CardBody className="flex flex-wrap items-center justify-between gap-3">
              {r.acknowledgedAt ? (
                <span className="flex items-center gap-2 text-[14px] text-success"><CheckCircle2 className="h-5 w-5" /> You acknowledged v{r.publishedVersion.version} on {formatDateTime(r.acknowledgedAt)}.</span>
              ) : (
                <>
                  <span className="text-[14px] text-ink-2">Please confirm you have read version {r.publishedVersion.version}.</span>
                  <AcknowledgeButton id={r.id} />
                </>
              )}
            </CardBody>
          </Card>
        )}
      </div>
      <div className="space-y-4 lg:pt-9">
        <Card>
          <CardHeader title="Details" />
          <CardBody className="space-y-2 text-[13px]">
            <div><span className="text-muted">Effective</span><div className="text-ink">{formatDate(toISO(v.effectiveDate))}</div></div>
            <div><span className="text-muted">Last updated</span><div className="text-ink">{formatDate(v.publishedAt ?? v.updatedAt)}</div></div>
            <div><span className="text-muted">Owner</span><div className="text-ink">{r.owner?.fullName ?? "—"}</div></div>
            {r.ackStats && <div><span className="text-muted">Acknowledged</span><div className="text-ink">{r.ackStats.acknowledged} of {r.ackStats.total} active employees</div></div>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Revision history" />
          <CardBody>
            <Table>
              <thead><tr><th>v</th><th>Effective</th><th>Note</th></tr></thead>
              <tbody>
                {r.versions.map((x) => (
                  <tr key={x.id}>
                    <td>{x.version}{!x.publishedAt && <span className="ml-1 text-[11px] text-pending">draft</span>}</td>
                    <td className="whitespace-nowrap">{formatDate(toISO(x.effectiveDate))}</td>
                    <td className="text-muted">{x.changeNote ?? (x.version === 1 ? "First version" : "—")}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
