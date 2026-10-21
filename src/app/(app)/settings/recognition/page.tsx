import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { listRecognitionAdmin } from "@/server/services/workplace";
import { formatDate, todayJakarta, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ArchiveRecognitionButton, RecognitionEditor } from "../workplace-forms";

export default async function RecognitionAdminPage() {
  await requirePagePermission("content.manage");
  const [items, people] = await Promise.all([listRecognitionAdmin(), db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })]);
  const staff = people.map((p) => ({ id: p.id, name: p.fullName }));
  return (
    <Card>
      <CardHeader
        title="Recognition"
        description="Manual entries (promotions, recognition, milestones). Birthdays and anniversaries are automatic and follow each person's directory privacy settings; level promotions are detected from level history."
        action={<RecognitionEditor initial={{ employeeId: "", kind: "RECOGNITION", title: "", message: "", date: todayJakarta(), status: "PUBLISHED" }} people={staff} />}
      />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="No manual recognition yet" />
        ) : (
          <Table>
            <thead><tr><th>Employee</th><th>Type</th><th>Title</th><th>Date</th><th>Status</th><th /></tr></thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium text-ink">{r.employee.fullName}</td>
                  <td>{r.kind.toLowerCase()}</td>
                  <td>{r.title}</td>
                  <td>{formatDate(toISO(r.date))}</td>
                  <td><Badge tone={r.status === "PUBLISHED" ? "success" : "neutral"}>{r.status.toLowerCase()}</Badge></td>
                  <td className="text-right">
                    {r.status !== "ARCHIVED" && (
                      <div className="flex justify-end gap-1">
                        <RecognitionEditor id={r.id} people={staff} initial={{ employeeId: r.employeeId, kind: r.kind, title: r.title, message: r.message ?? "", date: toISO(r.date), status: r.status === "DRAFT" ? "DRAFT" : "PUBLISHED" }} />
                        <ArchiveRecognitionButton id={r.id} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
