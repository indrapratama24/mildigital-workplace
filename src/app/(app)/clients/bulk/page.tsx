import { redirect } from "next/navigation";
import { requirePagePermission } from "@/server/auth/guard";
import { clientsForBulk } from "@/server/services/bulk";
import { assignableEmployees, clientFilterOptions } from "@/server/services/clients";
import { todayJakarta } from "@/lib/dates";
import { ClientBulkEditor } from "./editor";

export const metadata = { title: "Bulk edit · Clients" };

export default async function ClientsBulkPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const me = await requirePagePermission("client.manage");
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean);
  if (!ids.length) redirect("/clients");
  const [rows, opts, people] = await Promise.all([clientsForBulk(me, ids), clientFilterOptions(), assignableEmployees()]);
  return (
    <ClientBulkEditor
      rows={rows}
      today={todayJakarta()}
      packages={opts.packages.map((p) => ({ id: p.id, name: p.isActive ? p.name : `${p.name} (archived)` }))}
      categories={opts.categories.map((c) => ({ id: c.id, name: c.name }))}
      industries={opts.industries.map((i) => ({ name: i.name, categoryId: i.categoryId, subIndustries: i.subIndustries.map((s) => s.name) }))}
      adAccounts={opts.adAccounts.filter((a) => a.isActive).map((a) => a.name)}
      people={people.map((p) => ({ id: p.id, name: p.fullName }))}
    />
  );
}
