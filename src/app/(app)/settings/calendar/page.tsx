import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/misc";
import { CategoryRow, GrantForm, RevokeGrant, VisibilitySetting } from "../calendar-forms";
import { listCalendarGrants } from "@/server/services/calendar-admin";
import { CALENDAR_ROLE_LABEL } from "@/server/services/calendar-access";
import { getSettings } from "@/server/services/settings";
import { formatDate, toISO } from "@/lib/dates";

export default async function CalendarSettingsPage() {
  await requirePagePermission("team.manage");
  const [grants, categories, settings, employees, teams, departments] = await Promise.all([
    listCalendarGrants(),
    db.internalEventCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    getSettings(),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.department.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const deps = departments;
  return (
    <div className="space-y-5">
      <Card id="calendar-permissions">
        <CardHeader
          title="Internal Calendar permissions"
          description="Who may create and manage internal events. Super Admins can manage everything. Being a participant or a team leader never grants edit rights by itself."
        />
        <CardBody className="space-y-4">
          <VisibilitySetting value={settings.calendarVisibility} />
          {grants.length === 0 ? (
            <p className="text-[13px] text-muted">No calendar permissions yet — only Super Admins can create events.</p>
          ) : (
            <Table>
              <thead><tr><th>Granted to</th><th>Calendar role</th><th>Scope</th><th>Assigned by</th><th /></tr></thead>
              <tbody>
                {grants.map((g) => (
                  <tr key={g.id}>
                    <td><div className="font-medium text-ink">{g.subject}</div><div className="text-[11px] text-subtle">{g.subjectType}</div></td>
                    <td><Badge tone={g.role === "MANAGER" ? "brand" : g.role === "EDITOR" ? "success" : "neutral"}>{CALENDAR_ROLE_LABEL[g.role]}</Badge></td>
                    <td>{g.scope}</td>
                    <td className="text-muted">{g.assignedBy} · {formatDate(toISO(g.createdAt))}</td>
                    <td className="text-right"><RevokeGrant id={g.id} /></td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
          <GrantForm employees={employees.map((e) => ({ id: e.id, name: e.fullName }))} teams={teams.map((t) => ({ id: t.id, name: t.name }))} departments={deps} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Event categories" description="Colours are used in the Internal Calendar and on event dots in work calendars." />
        <CardBody>
          {categories.map((c) => <CategoryRow key={c.id} c={{ id: c.id, name: c.name, color: c.color, isActive: c.isActive }} />)}
          <CategoryRow />
        </CardBody>
      </Card>
    </div>
  );
}
