import Link from "next/link";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { formatDate, todayJakarta, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { RegulationAdminActions, RegulationEditor, type RegulationFormValues } from "../workplace-forms";

export default async function RegulationsAdminPage() {
  await requirePagePermission("content.manage");
  const [regs, people] = await Promise.all([
    db.companyRegulation.findMany({
      include: {
        owner: { select: { fullName: true } },
        versions: { orderBy: { version: "desc" }, include: { attachment: { select: { id: true, originalName: true } } } },
        _count: { select: { acknowledgements: true } },
      },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const staff = people.map((p) => ({ id: p.id, name: p.fullName }));
  const categories = [...new Set(regs.map((r) => r.category))].sort();
  const empty: RegulationFormValues = { title: "", category: "", summary: "", body: "", effectiveDate: todayJakarta(), documentUrl: "", attachment: null, ownerId: "", requiresAcknowledgement: false, changeNote: "" };
  return (
    <Card>
      <CardHeader title="Company regulations" description="Draft → publish. Editing a published regulation creates a new draft revision; history is kept. Only published regulations are visible to employees." action={<RegulationEditor initial={empty} people={staff} categories={categories} label="New regulation" />} />
      <CardBody>
        {regs.length === 0 ? (
          <EmptyState title="No regulations yet" />
        ) : (
          <Table className="min-w-[860px]">
            <thead><tr><th>Regulation</th><th>Category</th><th>Status</th><th>Version</th><th>Effective</th><th>Owner</th><th /></tr></thead>
            <tbody>
              {regs.map((r) => {
                const latest = r.versions[0];
                const published = r.versions.find((v) => v.id === r.publishedVersionId);
                const hasDraft = !!latest && !latest.publishedAt;
                const values: RegulationFormValues = {
                  title: latest.title,
                  category: r.category,
                  summary: latest.summary ?? "",
                  body: latest.body,
                  effectiveDate: toISO(latest.effectiveDate),
                  documentUrl: latest.documentUrl ?? "",
                  attachment: latest.attachment ? { id: latest.attachment.id, name: latest.attachment.originalName } : null,
                  ownerId: r.ownerId ?? "",
                  requiresAcknowledgement: r.requiresAcknowledgement,
                  changeNote: hasDraft ? latest.changeNote ?? "" : "",
                };
                return (
                  <tr key={r.id}>
                    <td>
                      <Link href={`/company/regulations/${r.id}`} className="font-medium text-ink hover:text-brand-700">{r.title}</Link>
                      {r.requiresAcknowledgement && <div className="text-[11.5px] text-muted">Acknowledgement required · {r._count.acknowledgements} total</div>}
                    </td>
                    <td>{r.category}</td>
                    <td className="space-x-1">
                      <Badge tone={r.status === "PUBLISHED" ? "success" : r.status === "ARCHIVED" ? "neutral" : "pending"}>{r.status.toLowerCase()}</Badge>
                      {hasDraft && r.status === "PUBLISHED" && <Badge tone="pending">draft v{latest.version}</Badge>}
                    </td>
                    <td className="tabular">{published ? `v${published.version}` : "—"}</td>
                    <td>{published ? formatDate(toISO(published.effectiveDate)) : formatDate(toISO(latest.effectiveDate))}</td>
                    <td>{r.owner?.fullName ?? "—"}</td>
                    <td className="text-right">
                      <div className="flex flex-wrap justify-end gap-1">
                        {r.status !== "ARCHIVED" && <RegulationEditor id={r.id} initial={values} people={staff} categories={categories} label={hasDraft ? "Edit draft" : "Revise"} isRevision={!hasDraft} />}
                        <RegulationAdminActions id={r.id} hasDraft={hasDraft} status={r.status} published={!!r.publishedVersionId} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
