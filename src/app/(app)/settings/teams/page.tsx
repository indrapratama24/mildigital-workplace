import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { effectiveOn } from "@/server/services/org";
import { todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/misc";
import { DepartmentForm, TeamDialog } from "../forms";

export default async function TeamsPage() {
  await requirePagePermission("team.manage");
  const today = todayJakarta();
  const [departments, teams, approvers] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.team.findMany({ include: { department: true, lead: true, backupApprover: true, _count: { select: { memberships: { where: effectiveOn(today) } } } }, orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { isActive: true, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const deps = departments.map((d) => ({ id: d.id, name: d.name }));
  const apps = approvers.map((a) => ({ id: a.id, name: a.fullName }));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Teams" description="Reporting lines are set per employee in the Team Directory; team leads and backup approvers drive fallback routing." action={<TeamDialog departments={deps} approvers={apps} />} />
        <CardBody>
          <Table>
            <thead><tr><th>Team</th><th>Department</th><th>Lead</th><th>Backup approver</th><th>Members</th><th>Status</th><th /></tr></thead>
            <tbody>
              {teams.map((t) => (
                <tr key={t.id}>
                  <td className="font-medium text-ink">{t.name}</td>
                  <td>{t.department.name}</td>
                  <td>{t.lead?.fullName ?? "—"}</td>
                  <td>{t.backupApprover?.fullName ?? "—"}</td>
                  <td className="tabular">{t._count.memberships}</td>
                  <td><Badge tone={t.isActive ? "success" : "neutral"}>{t.isActive ? "Active" : "Inactive"}</Badge></td>
                  <td className="text-right"><TeamDialog initial={{ id: t.id, name: t.name, departmentId: t.departmentId, leadId: t.leadId, backupApproverId: t.backupApproverId, isActive: t.isActive }} departments={deps} approvers={apps} /></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Departments" />
        <CardBody className="space-y-3">
          {departments.map((d) => <DepartmentForm key={d.id} initial={{ id: d.id, code: d.code, name: d.name }} />)}
          <div className="border-t border-line-2 pt-3"><DepartmentForm /></div>
        </CardBody>
      </Card>
    </div>
  );
}
