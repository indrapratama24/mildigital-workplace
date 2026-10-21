import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { todayJakarta } from "@/lib/dates";
import { Card, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { NewEmployeeForm } from "../employee-forms";

export const metadata = { title: "Add employee" };

export default async function NewEmployeePage() {
  const me = await requirePagePermission("employee.manage");
  const [departments, teams, levels, leaders] = await Promise.all([
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" } }),
    db.employee.findMany({ where: { isActive: true, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  return (
    <>
      <PageHeader eyebrow="Team Directory" title="Add employee" description="Creates the employee profile and sign-in account. The WFO policy follows the level automatically." />
      <Card className="max-w-3xl">
        <CardBody>
          <NewEmployeeForm
            departments={departments.map((d) => ({ id: d.id, name: d.name }))}
            teams={teams.map((t) => ({ id: t.id, name: t.name }))}
            levels={levels.map((l) => ({ id: l.id, name: l.name }))}
            leaders={leaders.map((l) => ({ id: l.id, name: l.fullName }))}
            canGrantAdmin={can(me, "user.manage")}
            today={todayJakarta()}
          />
        </CardBody>
      </Card>
    </>
  );
}
