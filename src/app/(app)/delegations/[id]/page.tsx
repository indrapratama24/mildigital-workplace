import { notFound, redirect } from "next/navigation";
import { Paperclip, ShieldCheck } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { getDelegationForDelegate } from "@/server/services/requests";
import { DomainError } from "@/server/errors";
import { formatDate, formatDateRange, formatDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, PageHeader } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { DecisionPanel } from "@/components/app/requests/decision-panel";

export const metadata = { title: "Delegation" };

export default async function DelegationPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  let d;
  try {
    d = await getDelegationForDelegate(me, id);
  } catch (e) {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    if (e instanceof DomainError) redirect("/approvals?tab=delegations");
    throw e;
  }
  return (
    <>
      <PageHeader eyebrow="Delegation" title={`Cover for ${d.delegator.fullName}`} description={`${d.delegator.jobTitle} · ${d.awayLabel} ${formatDateRange(d.awayFrom, d.awayTo)}`} actions={<StatusBadge status={d.status} />} />
      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Handover" description={`Coverage period ${formatDateRange(d.coverageStart, d.coverageEnd)}`} />
            <CardBody className="space-y-4 text-sm">
              <p className="whitespace-pre-line text-ink">{d.handoverNotes}</p>
              {d.tasks.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[12.5px] font-medium text-muted">Tasks & deadlines</div>
                  <ul className="space-y-1.5">
                    {d.tasks.map((t, i) => (
                      <li key={i} className="flex justify-between gap-3 rounded-lg bg-canvas px-3 py-2">
                        <span>{t.task}</span>
                        {t.deadline && <span className="whitespace-nowrap text-muted">{formatDate(t.deadline)}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {d.attachment && (
                <a href={`/api/files/${d.attachment.id}`} className="inline-flex items-center gap-1.5 text-brand-700 hover:underline">
                  <Paperclip className="h-4 w-4" /> {d.attachment.name}
                </a>
              )}
            </CardBody>
          </Card>
          {d.coDelegates.length > 0 && (
            <Card>
              <CardHeader title="Also covering" description="Other colleagues asked to cover parts of this handover." />
              <CardBody className="flex flex-wrap gap-2 text-[13px]">
                {d.coDelegates.map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-2 rounded-full border border-line px-3 py-1">
                    {c.name} <StatusBadge status={c.status} />
                  </span>
                ))}
              </CardBody>
            </Card>
          )}
          {d.thread.length > 0 && (
            <Card>
              <CardHeader title="Conversation" />
              <CardBody className="space-y-2 text-[13px]">
                {d.thread.map((t, i) => (
                  <div key={i} className="rounded-xl bg-canvas px-3 py-2">
                    <span className="font-medium capitalize text-ink">{t.actor} · {t.action.replace(/_/g, " ").toLowerCase()}</span>
                    <span className="text-muted"> · {formatDateTime(new Date(t.at))}</span>
                    {t.comment && <div className="mt-0.5 text-ink-2">“{t.comment}”</div>}
                  </div>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          {d.stepId ? (
            <Card className="border-brand-200">
              <CardHeader title="Your response" description="You're confirming you can cover this work — not approving their leave. Their leader decides that next." />
              <CardBody>
                <DecisionPanel stepId={d.stepId} kind="DELEGATE" redirectTo="/approvals?tab=delegations" />
              </CardBody>
            </Card>
          ) : d.awaitingClarification ? (
            <Notice tone="warning">Waiting for {d.delegator.fullName} to answer your question.</Notice>
          ) : (
            <Notice tone="info">No action needed. Request status: {d.requestStatus.replace(/_/g, " ").toLowerCase()}.</Notice>
          )}
          <Notice tone="info">
            <span className="flex gap-2">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" /> For privacy, you only see the handover details — not the reason for the time off or any supporting documents.
            </span>
          </Notice>
        </div>
      </div>
    </>
  );
}
