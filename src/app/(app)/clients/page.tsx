import Link from "next/link";
import { Briefcase, CircleCheck, CirclePause, CircleX, Download, Hourglass, Layers, Megaphone, Plus, Shapes, Sparkles, Tag, Upload, UserRound, Users } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { clientFilterOptions, listClients, type ClientFilters } from "@/server/services/clients";
import { PORTFOLIO_BREAKDOWNS, portfolioSummary, type PortfolioBreakdown } from "@/server/services/client-metrics";
import { getSettings } from "@/server/services/settings";
import { HighlightsEditor } from "@/components/app/clients/highlights-editor";
import { FilterBar } from "@/components/app/filter-bar";
import { addMonths, currentMonthJakarta, formatDate, formatMonth, monthParam, parseMonthParam } from "@/lib/dates";
import { CLIENT_STATUS_LABEL } from "@/lib/engine/clients";
import { STATUS_TONE } from "@/components/app/clients/status";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, AvatarGroup, EmptyState, PageHeader, Stat, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Select } from "@/components/ui/field";

export const metadata = { title: "Client & Portfolio" };


export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const cur = currentMonthJakarta();
  const m = parseMonthParam(sp.month, cur);
  const filters: ClientFilters = {
    q: sp.q,
    status: (sp.status as ClientFilters["status"]) ?? "ALL",
    packageId: sp.package || undefined,
    consultantId: sp.consultant || undefined,
    asId: sp.as || undefined,
    categoryId: sp.category || undefined,
    industryId: sp.industry || undefined,
    adAccountId: sp.ad || undefined,
    sort: (sp.sort as ClientFilters["sort"]) ?? "name",
    page: Number(sp.page ?? 1) || 1,
  };
  const [list, opts, summary, settings] = await Promise.all([listClients(me, filters), clientFilterOptions(), portfolioSummary(m.year, m.month), getSettings()]);
  const highlights = settings.clientHighlights.filter((k): k is PortfolioBreakdown => k in PORTFOLIO_BREAKDOWNS);
  const canCustomize = can(me, "clientPackage.manage");
  const prev = addMonths(m.year, m.month, -1);
  const next = addMonths(m.year, m.month, 1);
  const isCurrent = m.year === cur.year && m.month === cur.month;
  const qs = (patch: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v));
    return `/clients?${p.toString()}`;
  };
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "month") as [string, string][]).toString();

  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Client & Portfolio"
        description="Every brand MIL Digital works with — current and past — with its package, assigned team and status history."
        actions={
          <>
            {can(me, "client.export") && (
              <a href={`/api/clients/export?${exportQs}`} className={buttonClass("secondary")}>
                <Download className="h-4 w-4" /> Export CSV
              </a>
            )}
            {can(me, "client.manage") && (
              <Link href="/clients/import" className={buttonClass("secondary")}>
                <Upload className="h-4 w-4" /> Import CSV
              </Link>
            )}
            {can(me, "client.manage") && (
              <Link href="/clients/new" className={buttonClass("primary")}>
                <Plus className="h-4 w-4" /> Add client
              </Link>
            )}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[17px] font-bold text-ink">
          Portfolio · {formatMonth(m.year, m.month)}
          <span className="ml-2 text-[12.5px] font-normal text-muted">as of {formatDate(summary.asOf)}</span>
        </h2>
        <div className="flex items-center gap-1 rounded-full border border-line bg-white p-1 text-[13px]">
          <Link href={qs({ month: monthParam(prev.year, prev.month), page: undefined })} className="rounded-full px-3 py-1 text-ink-2 hover:text-brand-700">← {formatMonth(prev.year, prev.month)}</Link>
          {!isCurrent && <Link href={qs({ month: undefined, page: undefined })} className="rounded-full bg-brand-700 px-3 py-1 font-medium text-white">This month</Link>}
          {!isCurrent && <Link href={qs({ month: monthParam(next.year, next.month), page: undefined })} className="rounded-full px-3 py-1 text-ink-2 hover:text-brand-700">{formatMonth(next.year, next.month)} →</Link>}
        </div>
      </div>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Active clients" value={summary.active} icon={CircleCheck} tone="success" hint={summary.freezeCountsAsActive ? "incl. freeze" : undefined} />
        <Stat label="Preparation" value={summary.preparation} icon={Hourglass} hint="starting soon — not counted yet" />
        <Stat label="Freeze" value={summary.freeze} icon={CirclePause} hint={summary.freezeCountsAsActive ? "counted as active" : "not counted as active"} />
        <Stat label="Inactive" value={summary.inactive} icon={CircleX} />
        <Stat label="Total clients" value={summary.total} icon={Briefcase} tone="brand" />
        <Stat label={isCurrent ? "New this month" : "New in month"} value={summary.newThisPeriod} icon={Sparkles} hint="first collaboration starts" />
      </div>
      {(highlights.length > 0 || canCustomize) && (
        <div className="mb-5">
          {canCustomize && (
            <div className="mb-2 flex justify-end">
              <HighlightsEditor options={Object.entries(PORTFOLIO_BREAKDOWNS).map(([key, v]) => ({ key, title: v.title }))} selected={highlights} />
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {highlights.map((k) => (
              <Breakdown key={k} title={PORTFOLIO_BREAKDOWNS[k].title} icon={BREAKDOWN_ICON[k]} rows={summary[PORTFOLIO_BREAKDOWNS[k].key]} total={summary.active} />
            ))}
          </div>
        </div>
      )}

      <Card>
        <FilterBar
          search={{ name: "q", value: sp.q, placeholder: "Search brand or Client ID" }}
          activeCount={[sp.q, sp.status && sp.status !== "ALL" ? sp.status : undefined, sp.package, sp.consultant, sp.as, sp.category, sp.industry, sp.ad].filter(Boolean).length}
          resetHref={sp.month ? `/clients?month=${sp.month}` : "/clients"}
          hidden={{ month: sp.month }}
          right={
            <Select name="sort" defaultValue={sp.sort ?? "name"} className="h-10 w-auto" aria-label="Sort">
              <option value="name">Sort: Brand A–Z</option>
              <option value="code">Sort: Client ID</option>
              <option value="start_desc">Sort: Date START (newest)</option>
              <option value="start_asc">Sort: Date START (oldest)</option>
              <option value="period_desc">Sort: Period (longest)</option>
              <option value="period_asc">Sort: Period (shortest)</option>
            </Select>
          }
        >
          <Select name="status" defaultValue={sp.status ?? "ALL"} aria-label="Status">
            <option value="ALL">All statuses</option>
            <option value="PREPARATION">Preparation</option>
            <option value="ACTIVE">Active</option>
            <option value="FREEZE">Freeze</option>
            <option value="INACTIVE">Inactive</option>
          </Select>
          <Select name="package" defaultValue={sp.package ?? ""} aria-label="Package">
            <option value="">All packages</option>
            {opts.packages.map((p) => <option key={p.id} value={p.id}>{p.name}{p.isActive ? "" : " (archived)"}</option>)}
          </Select>
          <Select name="category" defaultValue={sp.category ?? ""} aria-label="Category">
            <option value="">All categories</option>
            {opts.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select name="industry" defaultValue={sp.industry ?? ""} aria-label="Industry">
            <option value="">All industries</option>
            {opts.industries.filter((i) => !sp.category || i.categoryId === sp.category).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </Select>
          <Select name="consultant" defaultValue={sp.consultant ?? ""} aria-label="Consultant">
            <option value="">All consultants</option>
            {opts.consultants.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
          <Select name="as" defaultValue={sp.as ?? ""} aria-label="Ads Strategist">
            <option value="">All Ads Strategists</option>
            {opts.adsStrategists.map((p) => <option key={p.id} value={p.id}>{p.fullName}</option>)}
          </Select>
          <Select name="ad" defaultValue={sp.ad ?? ""} aria-label="Ad account">
            <option value="">All ad accounts</option>
            {opts.adAccounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </FilterBar>
        {list.rows.length === 0 ? (
          <EmptyState icon={Briefcase} title={list.total === 0 && !Object.keys(sp).some((k) => k !== "month" && k !== "sort") ? "No clients yet" : "No clients match these filters"} description={can(me, "client.manage") ? "Add the first client to start the portfolio." : undefined} className="m-4" />
        ) : (
          <div className="px-2 pb-3">
            <Table className="min-w-[1060px] [&_td]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>Client ID</th>
                  <th>Brand name</th>
                  <th>Status</th>
                  <th>Package</th>
                  <th>Date START</th>
                  <th>Period</th>
                  <th>Consultant</th>
                  <th>Consultant 2</th>
                  <th>AS assigned</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {list.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/50">
                    <td className="font-mono text-[12.5px] text-ink-2">{r.clientCode}</td>
                    <td>
                      <Link href={`/clients/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.name}</Link>
                      {(r.industry || r.category) && <div className="text-[11.5px] text-muted">{[r.category, r.industry, r.subIndustry].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[r.displayStatus]} dot>{CLIENT_STATUS_LABEL[r.displayStatus]}</Badge>
                      {r.displayStatus === "PREPARATION" && <div className="mt-0.5 text-[11px] text-muted">starts {formatDate(r.dateStart)}</div>}
                    </td>
                    <td>{r.package?.name ?? <span className="text-subtle">—</span>}</td>
                    <td>{formatDate(r.dateStart)}</td>
                    <td>
                      <span className="font-medium text-ink">{r.period.label}</span>
                      {r.status === "INACTIVE" && r.dateOff && <div className="text-[11.5px] text-muted">off {formatDate(r.dateOff)}</div>}
                      {r.period.freezeSince && <div className="text-[11.5px] text-permission">frozen {r.period.freezeLabel}</div>}
                    </td>
                    <td><PersonCell p={r.consultant1} /></td>
                    <td><PersonCell p={r.consultant2} /></td>
                    <td><AvatarGroup people={r.adsStrategists} /></td>
                    <td className="text-right">
                      <Link href={`/clients/${r.id}`} className="text-[12.5px] font-medium text-brand-700 hover:underline">View</Link>
                      {can(me, "client.manage") && <Link href={`/clients/${r.id}/edit`} className="ml-3 text-[12.5px] font-medium text-ink-2 hover:text-brand-700">Edit</Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="flex items-center justify-between px-3 pt-3 text-[12.5px] text-muted">
              <span>{list.total} client{list.total === 1 ? "" : "s"} · page {list.page} of {list.pages}</span>
              <span className="flex gap-2">
                {list.page > 1 && <Link href={qs({ page: list.page - 1 })} className={buttonClass("secondary", "sm")}>Previous</Link>}
                {list.page < list.pages && <Link href={qs({ page: list.page + 1 })} className={buttonClass("secondary", "sm")}>Next</Link>}
              </span>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

const BREAKDOWN_ICON: Record<PortfolioBreakdown, typeof Layers> = {
  package: Layers,
  category: Shapes,
  industry: Briefcase,
  subIndustry: Tag,
  consultant: UserRound,
  adsStrategist: Users,
  adAccount: Megaphone,
};

function PersonCell({ p }: { p: { id: string; name: string; photoId?: string | null } | null }) {
  if (!p) return <span className="text-subtle">—</span>;
  return (
    <Link href={`/directory/${p.id}`} className="inline-flex items-center gap-2 hover:text-brand-700">
      <Avatar name={p.name} photoId={p.photoId} className="h-6 w-6 text-[10px]" />
      {p.name}
    </Link>
  );
}

function Breakdown({ title, icon: Icon, rows, total }: { title: string; icon: typeof Layers; rows: { key: string; label: string; count: number }[]; total: number }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" /> {title}</span>} />
      <CardBody className="space-y-2 pt-3">
        {rows.length === 0 && <p className="text-[13px] text-muted">No active clients.</p>}
        {rows.slice(0, 6).map((r) => (
          <div key={r.key} className="text-[13px]">
            <div className="flex justify-between"><span className="truncate text-ink-2">{r.label}</span><span className="tabular font-medium text-ink">{r.count}</span></div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line-2"><div className="h-full rounded-full bg-brand-600" style={{ width: `${total ? (r.count / total) * 100 : 0}%` }} /></div>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}
