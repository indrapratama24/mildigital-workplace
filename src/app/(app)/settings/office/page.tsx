import Link from "next/link";
import { requirePagePermission } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { officeScheduleView } from "@/server/services/office";
import { currentMonthJakarta, parseMonthParam, WEEKDAY_SHORT } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice, Table } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { OfficeMonth, WeeklyPattern, WfoPolicySwitch } from "./office-forms";

export const metadata = { title: "Office schedule" };

const days = (d: number[]) => (d.length ? d.map((x) => WEEKDAY_SHORT[x]).join(", ") : "none (all WFH)");

export default async function OfficeSchedulePage({ searchParams }: { searchParams: Promise<{ month?: string; team?: string }> }) {
  const me = await requirePagePermission("policy.manage");
  const sp = await searchParams;
  const { year, month } = parseMonthParam(sp.month, currentMonthJakarta());
  const view = await officeScheduleView(year, month, sp.team || null);
  const enabled = view.settings.wfoPolicyEnabled;
  const team = view.teamId ? view.teams.find((t) => t.id === view.teamId) : null;
  const base = `/settings/office?${view.teamId ? `team=${view.teamId}&` : ""}`;
  const scopeHref = (teamId: string | null) => `/settings/office?${teamId ? `team=${teamId}&` : ""}month=${year}-${String(month).padStart(2, "0")}`;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="WFO Policy"
          description="When it's on, employees plan their own month against a WFO percentage and submit it to their leader. When it's off, the Super Admin sets the office schedule and every My Work Calendar follows it."
        />
        <CardBody className="space-y-3">
          {can(me, "settings.manage") ? <WfoPolicySwitch enabled={enabled} officeReady={view.settings.officeWfoWeekdays.length > 0} /> : <p className="text-[13px] text-muted">The WFO Policy is {enabled ? "on" : "off"}. Only a Super Admin can switch it.</p>}
          {!enabled && (
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px] text-ink-2">
              <li>Employees can still ask to change a day. Extra office days (WFH → WFO) apply at once, with an optional note; WFO → WFH goes to their leader.</li>
              <li>If you change a date here, it replaces employees&apos; own changes on that date.</li>
            </ul>
          )}
        </CardBody>
      </Card>

      {enabled && <Notice tone="info">You can prepare the office schedule now. It takes effect when the WFO Policy is turned off.</Notice>}

      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Schedule for">
        {[{ id: null as string | null, name: "Company" }, ...view.teams.map((t) => ({ id: t.id as string | null, name: t.name }))].map((t) => (
          <Link
            key={t.id ?? "company"}
            href={scopeHref(t.id)}
            role="tab"
            aria-selected={view.teamId === t.id}
            className={cn("rounded-full border px-3 py-1.5 text-[13px] font-medium", view.teamId === t.id ? "border-brand-600 bg-brand-700 text-white" : "border-line bg-white text-ink-2 hover:border-brand-200")}
          >
            {t.name}
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader
          title={team ? `${team.name}: weekly office days` : "Company: weekly office days"}
          description={team ? "By default a team follows the company. Give it its own days only when it works differently." : "The usual WFO days for everyone. Teams can have their own days."}
        />
        <CardBody>
          <WeeklyPattern view={view} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={team ? `${team.name}: office calendar` : "Company: office calendar"}
          description={
            team
              ? "What this team's calendars show. Change a date for this team only, e.g. a team offsite or an extra office day. Company-wide changes are made in the Company view and win over the team's weekly days."
              : "Select dates to close the office, add an extra office day, or add a note. This applies to everyone, including teams with their own weekly days."
          }
        />
        <CardBody>
          <OfficeMonth view={view} base={base} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Teams" description="Weekly office days per team." />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <th>Team</th>
                <th>Department</th>
                <th>Weekly office days</th>
              </tr>
            </thead>
            <tbody>
              {view.teams.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link href={scopeHref(t.id)} className="font-medium text-ink hover:text-brand-700">
                      {t.name}
                    </Link>
                  </td>
                  <td className="text-muted">{t.department}</td>
                  <td>{t.wfoWeekdays ? <b className="text-ink">{days(t.wfoWeekdays)}</b> : <span className="text-muted">Company ({days(view.settings.officeWfoWeekdays)})</span>}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
