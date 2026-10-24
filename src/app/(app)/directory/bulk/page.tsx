import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { employeesForBulk } from "@/server/services/bulk";
import { todayJakarta } from "@/lib/dates";
import { EmployeeBulkEditor } from "./editor";

export const metadata = { title: "Bulk edit · Team Directory" };

export default async function DirectoryBulkPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const me = await requirePagePermission("employee.manage");
  const ids = ((await searchParams).ids ?? "").split(",").filter(Boolean);
  if (!ids.length) redirect("/directory");
  const [rows, teams, departments, levels, people, leaveTypes] = await Promise.all([
    employeesForBulk(me, ids),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, departmentId: true } }),
    db.department.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" }, select: { id: true, name: true } }),
    db.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    db.requestType.findMany({ where: { category: "LEAVE", isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true } }),
  ]);
  return (
    <EmployeeBulkEditor
      rows={rows}
      today={todayJakarta()}
      teams={teams}
      departments={departments}
      levels={levels}
      people={people.map((p) => ({ id: p.id, name: p.fullName }))}
      leaveTypes={leaveTypes}
      canAdjustLeave={can(me, "requestType.manage")}
    />
  );
}
