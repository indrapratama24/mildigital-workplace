import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { listPackages } from "@/server/services/clients";
import { getSettings } from "@/server/services/settings";
import { CLIENT_ROLE_LABEL, MAX_ADS_STRATEGISTS } from "@/lib/engine/clients";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { ClientRulesForm, PackageRow } from "../workplace-forms";

export default async function ClientSettingsPage() {
  await requirePagePermission("clientPackage.manage");
  const [packages, settings, usage] = await Promise.all([
    listPackages({ includeInactive: true }),
    getSettings(),
    db.clientEngagementPackage.groupBy({ by: ["packageId"], where: { effectiveTo: null, engagement: { endDate: null, brand: { archivedAt: null } } }, _count: { _all: true } }),
  ]);
  const count = (id: string) => usage.find((u) => u.packageId === id)?._count._all ?? 0;
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Client packages" description="Options in the client form. Packages used by any client are archived instead of deleted. No prices or inclusions are assumed." />
        <CardBody>
          {packages.map((p) => <PackageRow key={p.id} pkg={{ id: p.id, name: p.name, description: p.description, isActive: p.isActive, sortOrder: p.sortOrder }} clients={count(p.id)} />)}
          <PackageRow />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Client status & counting rules" />
        <CardBody className="space-y-5">
          <Table>
            <thead><tr><th>Status</th><th>Meaning</th><th>Active client count</th></tr></thead>
            <tbody>
              <tr><td><Badge tone="success">Active</Badge></td><td>Currently collaborating with MIL</td><td>Included</td></tr>
              <tr><td><Badge tone="permission">Freeze</Badge></td><td>Temporarily suspended; stays a separate status</td><td>{settings.clientFreezeCountsAsActive ? "Included (configured)" : "Excluded (default)"}</td></tr>
              <tr><td><Badge>Inactive</Badge></td><td>Collaboration ended — requires Date OFF</td><td>Excluded</td></tr>
            </tbody>
          </Table>
          <ClientRulesForm initial={{ clientRequirePrimaryConsultant: settings.clientRequirePrimaryConsultant, clientFreezeCountsAsActive: settings.clientFreezeCountsAsActive }} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Assignment rules" description="Enforced by the server and the database." />
        <CardBody className="space-y-1.5 text-[13px] text-ink-2">
          <p>• One current {CLIENT_ROLE_LABEL.CONSULTANT_PRIMARY} and one {CLIENT_ROLE_LABEL.CONSULTANT_SECONDARY} per client; any number of additional consultants.</p>
          <p>• At most {MAX_ADS_STRATEGISTS} current Ads Strategists per client.</p>
          <p>• An employee holds one role per client at a time; employees can serve many clients.</p>
          <p>• Removing someone ends their assignment (end date) — history is never deleted.</p>
          <p>• New clients count as “new” only in the month of their first Date START; reactivations are not new clients.</p>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Client access" description="Who can do what. Grant these in Platform → Roles & access." />
        <CardBody className="space-y-1.5 text-[13px] text-ink-2">
          <p>• Everyone: directory, brand information, status, package and assigned team.</p>
          <p>• Assigned consultants & Ads Strategists: also PIC contact and internal notes of their clients.</p>
          <p>• <code className="text-brand-700">client.sensitive</code>: PIC contact and notes of every client. <code className="text-brand-700">client.manage</code>: create, edit, status, assignments. <code className="text-brand-700">client.export</code>: CSV export.</p>
        </CardBody>
      </Card>
    </div>
  );
}
