import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink, Globe, Camera, Lock, Music2, Pencil } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { getClient } from "@/server/services/clients";
import { DomainError } from "@/server/errors";
import { formatDate, formatDateTime, todayJakarta } from "@/lib/dates";
import { CLIENT_ROLE_LABEL, CLIENT_STATUS_LABEL } from "@/lib/engine/clients";
import { STATUS_TONE } from "@/components/app/clients/status";
import { ArchiveClientButton, ChangeStatusButton } from "@/components/app/clients/client-actions";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, Notice, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Client" };

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  const c = await getClient(me, id).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const manage = can(me, "client.manage");
  const today = todayJakarta();
  const openStatus = c.statusHistory.find((h) => !h.to);
  const days = (n: number) => (n ? `${n.toLocaleString("id-ID")} day${n === 1 ? "" : "s"}` : "—");

  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Client directory
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 font-display text-[24px] font-bold text-white">
            {c.name.split(/\s+/).slice(0, 2).map((s) => s[0]).join("").toUpperCase()}
          </span>
          <div>
            <h1 className="font-display text-[28px] font-extrabold tracking-tight text-ink">{c.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-muted">
              <span className="font-mono">{c.clientCode}</span>
              <Badge tone={STATUS_TONE[c.displayStatus]} dot>{CLIENT_STATUS_LABEL[c.displayStatus]}</Badge>
              {c.package && <Badge tone="brand">{c.package.name}</Badge>}
              {c.organization && <span>· {c.organization}</span>}
            </div>
          </div>
        </div>
        {manage && (
          <div className="flex flex-wrap gap-2">
            {openStatus && c.displayStatus !== "PREPARATION" && <ChangeStatusButton id={c.id} status={c.status} statusFrom={openStatus.from} dateStart={c.dateStart} today={today} />}
            <Link href={`/clients/${c.id}/edit`} className={buttonClass("primary")}>
              <Pencil className="h-4 w-4" /> Edit client
            </Link>
          </div>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Overview" />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-3">
                <KV k="Category" v={c.category ?? "—"} />
                <KV k="Industry" v={c.industry ? `${c.industry}${c.subIndustry ? ` · ${c.subIndustry}` : ""}` : "—"} />
                <KV k="Ad accounts" v={c.adAccounts.length ? c.adAccounts.join(", ") : "—"} />
                <KV k="Date START" v={formatDate(c.dateStart)} />
                <KV k="Date OFF" v={c.dateOff ? formatDate(c.dateOff) : "—"} />
                <KV k="Collaboration period" v={<b className="font-display text-[17px] text-brand-700">{c.period.label}</b>} />
                <KV k="Days active" v={days(c.period.activeDays)} />
                <KV k="Days frozen / inactive" v={c.period.frozenDays + c.period.inactiveDays ? `${days(c.period.frozenDays)} / ${days(c.period.inactiveDays)}` : "—"} />
              </div>
              {c.displayStatus === "PREPARATION" && <Notice>Preparation — collaboration starts on {formatDate(c.dateStart)}. The client becomes Active automatically on that day and isn't counted in Active clients before then.</Notice>}
              {c.period.freezeSince && <Notice tone="warning">Frozen since {formatDate(c.period.freezeSince)} ({c.period.freezeLabel}). Freeze clients are reported separately from Active clients unless configured otherwise.</Notice>}
              {c.period.reactivated && <Notice>Reactivated client — earlier inactive periods are kept in the status history.</Notice>}
              {c.description && <p className="whitespace-pre-line text-[14px] leading-relaxed text-ink-2">{c.description}</p>}
              <div className="flex flex-wrap gap-2">
                {c.websiteUrl && <ExtLink href={c.websiteUrl} icon={Globe} label="Website" />}
                {c.instagramUrl && <ExtLink href={c.instagramUrl} icon={Camera} label="Instagram" />}
                {c.tiktokUrl && <ExtLink href={c.tiktokUrl} icon={Music2} label="TikTok" />}
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Status timeline" description="Effective-dated; monthly reports read the period covering each date." />
            <CardBody>
              <ol className="relative space-y-4 border-l border-line pl-5">
                {[...c.statusHistory].reverse().map((h) => (
                  <li key={h.id} className="relative">
                    <span className="absolute -left-[26px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand-600 ring-1 ring-brand-200" />
                    <div className="flex flex-wrap items-center gap-2 text-[13px]">
                      <Badge tone={STATUS_TONE[h.status]}>{CLIENT_STATUS_LABEL[h.status]}</Badge>
                      <span className="text-ink">{formatDate(h.from)} – {h.to ? formatDate(h.to) : "now"}</span>
                    </div>
                    <div className="mt-0.5 text-[12px] text-muted">
                      {h.fromStatus ? `${CLIENT_STATUS_LABEL[h.fromStatus]} → ${CLIENT_STATUS_LABEL[h.status]}` : "Initial status"}
                      {h.reason && ` · ${h.reason}`}
                      {h.by && ` · by ${h.by}, ${formatDateTime(h.at)}`}
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Engagements & packages" description="An engagement is one continuous collaboration; reactivation starts a new one." />
            <CardBody>
              <Table>
                <thead><tr><th>Engagement</th><th>Package</th><th>Package period</th></tr></thead>
                <tbody>
                  {c.engagements.flatMap((e, i) =>
                    e.packages.map((p, j) => (
                      <tr key={p.id}>
                        <td>{j === 0 ? <span className="text-ink">#{i + 1} · {formatDate(e.start)} – {e.end ? formatDate(e.end) : "ongoing"}</span> : ""}</td>
                        <td className="font-medium text-ink">{p.name}</td>
                        <td className="text-muted">{formatDate(p.from)} – {p.to ? formatDate(p.to) : "now"}</td>
                      </tr>
                    )),
                  )}
                </tbody>
              </Table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Team assignment history" />
            <CardBody>
              <Table>
                <thead><tr><th>Employee</th><th>Role</th><th>From</th><th>To</th></tr></thead>
                <tbody>
                  {c.assignmentHistory.map((a) => (
                    <tr key={a.id} className={a.to ? "text-muted" : ""}>
                      <td><Link href={`/directory/${a.employee.id}`} className="hover:text-brand-700">{a.employee.fullName}</Link></td>
                      <td>{CLIENT_ROLE_LABEL[a.role]}</td>
                      <td>{formatDate(a.from)}</td>
                      <td>{a.to ? formatDate(a.to) : <Badge tone="success">Current</Badge>}</td>
                    </tr>
                  ))}
                  {c.assignmentHistory.length === 0 && <tr><td colSpan={4} className="text-muted">No assignments yet.</td></tr>}
                </tbody>
              </Table>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Assigned team" />
            <CardBody className="space-y-3">
              <TeamLine label="Consultant" people={c.consultant1 ? [c.consultant1] : []} />
              {c.primaryConsultantWaived && <Notice tone="warning">Exception: active without Consultant{c.waiverReason ? ` — ${c.waiverReason}` : ""}.</Notice>}
              <TeamLine label="Consultant 2" people={c.consultant2 ? [c.consultant2] : []} />
              <TeamLine label="Additional consultants" people={c.additional} />
              <TeamLine label={`Ads Strategists (${c.adsStrategists.length}/3)`} people={c.adsStrategists} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Client contact & notes" />
            <CardBody className="space-y-3 text-[13px]">
              {c.sensitiveVisible ? (
                <>
                  <KV k="Client PIC" v={c.picName ?? "—"} />
                  <KV k="PIC phone" v={c.picPhone ? <a href={`tel:${c.picPhone.replace(/[\s()-]/g, "")}`} className="text-brand-700 hover:underline">{c.picPhone}</a> : "—"} />
                  <KV k="PIC email" v={c.picEmail ? <a href={`mailto:${c.picEmail}`} className="text-brand-700 hover:underline">{c.picEmail}</a> : "—"} />
                  <div>
                    <div className="text-[11.5px] text-muted">Internal notes</div>
                    <p className="mt-0.5 whitespace-pre-line text-ink">{c.internalNotes ?? "—"}</p>
                  </div>
                </>
              ) : (
                <p className="flex items-center gap-2 text-muted"><Lock className="h-4 w-4" /> Visible to client managers and the assigned team.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Integrations" description="Linked by Client ID and brand ID once available." />
            <CardBody className="space-y-2 text-[13px]">
              {["ATLAS Brand Overview", "Client Strategy Repository", "Client Performance", "Meeting Notes"].map((n) => (
                <div key={n} className="flex items-center justify-between rounded-xl border border-line-2 px-3 py-2 text-muted">
                  {n}
                  <span className="rounded-full bg-line-2 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide">Coming soon</span>
                </div>
              ))}
            </CardBody>
          </Card>

          {c.retiredCodes.length > 0 && <p className="text-[12px] text-muted">Previous Client IDs (retired): {c.retiredCodes.join(", ")}</p>}
          {manage && <ArchiveClientButton id={c.id} name={c.name} />}
        </div>
      </div>
    </>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}

function TeamLine({ label, people }: { label: string; people: { id: string; name: string; title: string; isActive: boolean; photoId: string | null }[] }) {
  return (
    <div>
      <div className="mb-1 text-[11.5px] font-medium text-muted">{label}</div>
      {people.length === 0 ? (
        <div className="text-[13px] text-subtle">—</div>
      ) : (
        <div className="space-y-1.5">
          {people.map((p) => (
            <Link key={p.id} href={`/directory/${p.id}`} className="flex items-center gap-2.5 rounded-xl px-1 py-1 hover:bg-brand-50">
              <Avatar name={p.name} photoId={p.photoId} />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-ink">{p.name}{!p.isActive && <span className="ml-1 text-[11px] text-danger">(left)</span>}</span>
                <span className="block truncate text-[11.5px] text-muted">{p.title}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ExtLink({ href, icon: Icon, label }: { href: string; icon: typeof Globe; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white px-3 py-1.5 text-[12.5px] font-medium text-ink-2 hover:border-brand-300 hover:text-brand-700">
      <Icon className="h-3.5 w-3.5" /> {label} <ExternalLink className="h-3 w-3 text-subtle" />
    </a>
  );
}
