import Link from "next/link";
import { CheckCircle2, ScrollText } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { listRegulations } from "@/server/services/workplace";
import { formatDate } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { EmptyState, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { Input, Select } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";

export const metadata = { title: "Company regulations" };

export default async function RegulationsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const [rows, all] = await Promise.all([listRegulations(me, { q: sp.q, category: sp.category }), listRegulations(me)]);
  const categories = [...new Set(all.map((r) => r.category))].sort();
  return (
    <Card>
      <form className="flex flex-wrap gap-2 p-4" method="get">
        <Input name="q" defaultValue={sp.q} placeholder="Search regulations" className="h-9 w-[240px]" />
        <Select name="category" defaultValue={sp.category ?? ""} className="h-9 w-auto">
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <button className={buttonClass("primary", "sm", "h-9")}>Filter</button>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon={ScrollText} title="No published regulations" className="m-4" />
      ) : (
        <div className="px-2 pb-3">
          <Table className="min-w-[720px]">
            <thead><tr><th>Regulation</th><th>Category</th><th>Version</th><th>Effective</th><th>Last updated</th><th>Owner</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><Link href={`/company/regulations/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.title}</Link>{r.summary && <div className="max-w-[360px] truncate text-[11.5px] text-muted">{r.summary}</div>}</td>
                  <td>{r.category}</td>
                  <td className="tabular">v{r.version}</td>
                  <td className="whitespace-nowrap">{r.effectiveDate ? formatDate(r.effectiveDate) : "—"}</td>
                  <td className="whitespace-nowrap">{formatDate(r.updatedAt)}</td>
                  <td>{r.owner?.fullName ?? "—"}</td>
                  <td>{r.requiresAcknowledgement && (r.acknowledged ? <span className="inline-flex items-center gap-1 text-[12px] text-success"><CheckCircle2 className="h-3.5 w-3.5" /> Acknowledged</span> : <Badge tone="pending">Please acknowledge</Badge>)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </Card>
  );
}
