import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/misc";
import { RequestTypeDialog } from "../forms";

const req = (r: string) => (r === "REQUIRED" ? <Badge tone="brand">Required</Badge> : r === "OPTIONAL" ? <Badge tone="neutral">Optional</Badge> : <span className="text-subtle">—</span>);

export default async function RequestTypesPage() {
  await requirePagePermission("requestType.manage");
  const types = await db.requestType.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <Card>
      <CardHeader title="Request categories" description="Field visibility, document, reason, advance-notice and delegation rules per request type." action={<RequestTypeDialog />} />
      <CardBody>
        <Table>
          <thead><tr><th>Type</th><th>Category</th><th>Delegation</th><th>Document</th><th>Min reason</th><th>Notice</th><th>Half / hourly</th><th>Balance</th><th>Sensitive</th><th /></tr></thead>
          <tbody>
            {types.map((t) => (
              <tr key={t.id} className={t.isActive ? "" : "opacity-50"}>
                <td><div className="font-medium text-ink">{t.name}</div><div className="text-[11px] text-subtle">{t.code}</div></td>
                <td>{t.category.replace(/_/g, " ").toLowerCase()}</td>
                <td>{req(t.delegation)}</td>
                <td>{req(t.documentRequirement)}</td>
                <td className="tabular">{t.reasonMinLength}</td>
                <td className="tabular">{t.advanceNoticeDays}d</td>
                <td>{t.allowHalfDay ? "½" : "—"} / {t.allowHourly ? "hourly" : "—"}</td>
                <td>{t.deductsBalance ? `${t.defaultEntitlement ?? 0}d/yr` : "—"}</td>
                <td>{t.isSensitive ? <Badge tone="warning">Yes</Badge> : "—"}</td>
                <td className="text-right">
                  <RequestTypeDialog initial={{ id: t.id, code: t.code, name: t.name, category: t.category, description: t.description ?? "", documentRequirement: t.documentRequirement, delegation: t.delegation, reasonMinLength: t.reasonMinLength, advanceNoticeDays: t.advanceNoticeDays, allowHalfDay: t.allowHalfDay, allowHourly: t.allowHourly, deductsBalance: t.deductsBalance, defaultEntitlement: t.defaultEntitlement, isSensitive: t.isSensitive, isActive: t.isActive }} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
