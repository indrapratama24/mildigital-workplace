import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { visibleEmployeeIds } from "@/server/services/org";
import { getPlannerData } from "@/server/services/schedules";
import { addMonths, currentMonthJakarta, monthParam, parseMonthParam } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { Planner } from "@/components/app/planner/planner";
import { DomainError } from "@/server/errors";
import { redirect } from "next/navigation";

export const metadata = { title: "My Work Calendar" };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ month?: string; employee?: string }> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const { year, month } = parseMonthParam(sp.month, currentMonthJakarta());
  const employeeId = sp.employee ?? me.employeeId;
  const scope = await visibleEmployeeIds(me);
  const employees =
    scope === null || scope.length > 1
      ? await db.employee.findMany({ where: { isActive: true, id: scope ? { in: scope } : undefined }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } })
      : null;
  let data;
  try {
    data = await getPlannerData(me, employeeId, year, month);
  } catch (e) {
    if (e instanceof DomainError && e.code === "FORBIDDEN") redirect("/calendar");
    throw e;
  }
  const prev = addMonths(year, month, -1);
  const next = addMonths(year, month, 1);
  const emp = employeeId !== me.employeeId ? `&employee=${employeeId}` : "";
  const isSelf = employeeId === me.employeeId;
  return (
    <>
      <PageHeader
        eyebrow={isSelf ? "My Work Calendar" : "Viewing team member"}
        title={isSelf ? "Plan your month" : data.employee.fullName}
        description={
          isSelf
            ? "Click working days to switch between WFO and WFH. Mandatory days are locked, weekends and holidays are disabled. Submit when the plan meets your target."
            : `${data.employee.jobTitle} · read-only view of their plan, leave and attendance.`
        }
      />
      <Planner data={data} employees={employees} prevHref={`/calendar?month=${monthParam(prev.year, prev.month)}${emp}`} nextHref={`/calendar?month=${monthParam(next.year, next.month)}${emp}`} />
    </>
  );
}
