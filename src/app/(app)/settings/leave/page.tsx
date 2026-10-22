import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { yearEndChoices } from "@/server/services/requests";
import { db } from "@/server/db";
import { todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Notice, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { LeaveRulesForm } from "../forms";

export default async function LeaveRulesPage() {
  const me = await requirePagePermission("requestType.manage");
  const year = Number(todayJakarta().slice(0, 4));
  const [settings, annualTypes, choices] = await Promise.all([
    getSettings(),
    db.requestType.findMany({ where: { annualRules: true }, select: { name: true, advanceNoticeDays: true, defaultEntitlement: true, monthlyAccrual: true, eligibleStatuses: true } }),
    yearEndChoices(me, year),
  ]);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Annual leave rules" description={`Applied to: ${annualTypes.map((t) => t.name).join(", ") || "no request type yet (tick “Annual leave rules” on a request type)"}. Checked when the request is submitted and shown in the request form.`} />
        <CardBody className="space-y-4">
          {annualTypes.map((t) => (
            <Notice key={t.name}>
              <b>{t.name}</b>: {t.defaultEntitlement ?? 0} days/year{t.monthlyAccrual ? ", earned 1 per month from the eligibility date" : ""} · {t.eligibleStatuses.length ? `for ${t.eligibleStatuses.map((s) => s.toLowerCase()).join("/")} employees (after probation)` : "for everyone"} · request at least {t.advanceNoticeDays} days ahead. Edit these in Request types.
            </Notice>
          ))}
          <LeaveRulesForm initial={{ annualLeaveRules: settings.annualLeaveRules, leaveYearEnd: settings.leaveYearEnd }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title={`Year-end choices · ${year}`} description="What each employee chose for their leftover annual leave. “Effective” is re-checked against the balance on 31 Dec (and the max tradable)." />
        <CardBody>
          {choices.length === 0 ? (
            <EmptyState title="No choices yet" description={`Employees can choose from ${settings.leaveYearEnd.windowDays} days before 31 December.`} />
          ) : (
            <Table>
              <thead><tr><th>Employee</th><th>Choice</th><th>Days chosen</th><th>Leftover on 31 Dec</th><th>Effective</th></tr></thead>
              <tbody>
                {choices.map((c) => (
                  <tr key={c.id}>
                    <td className="font-medium text-ink">{c.employee.fullName} <span className="text-[11.5px] text-muted">{c.employee.employeeCode}</span></td>
                    <td><Badge tone={c.option === "CASH" ? "success" : "brand"}>{c.option === "CASH" ? "Withdraw (cash)" : "Carry over"}</Badge></td>
                    <td className="tabular">{c.days}</td>
                    <td className="tabular">{c.leftover}</td>
                    <td className="tabular font-semibold">{c.effectiveDays}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
