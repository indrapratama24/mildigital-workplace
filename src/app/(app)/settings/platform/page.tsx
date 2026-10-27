import Link from "next/link";
import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { FEATURES } from "@/lib/features";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { PlatformForm } from "../workplace-forms";

const LABELS: Record<string, string> = {
  home: "Home",
  workCalendar: "My Work Calendar",
  internalCalendar: "Internal Calendar",
  requests: "Requests & Approvals",
  companyHub: "Company Hub",
  teamDirectory: "Team Directory",
  clients: "Client & Portfolio",
  knowledgeHub: "Knowledge Hub",
  performance: "Performance & Growth",
  collaboration: "Collaboration Hub",
};

export default async function PlatformPage() {
  await requirePagePermission("settings.manage");
  const s = await getSettings();
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title={s.knowledgeHubName} description="The separate learning application, linked from the sidebar and Home. Single sign-on is not connected yet — employees sign in to it separately." />
        <CardBody><PlatformForm knowledgeHubUrl={s.knowledgeHubUrl} knowledgeHubName={s.knowledgeHubName} /></CardBody>
      </Card>
      <Card>
        <CardHeader title="Modules" description="Availability is defined centrally in src/lib/features.ts and applied to the sidebar, Home and quick actions." />
        <CardBody>
          <Table>
            <thead><tr><th>Module</th><th>Status</th></tr></thead>
            <tbody>
              {Object.entries(FEATURES).map(([k, v]) => (
                <tr key={k}>
                  <td className="text-ink">{k === "knowledgeHub" ? s.knowledgeHubName : (LABELS[k] ?? k)}</td>
                  <td><Badge tone={v === "enabled" ? "success" : v === "external" ? "brand" : "neutral"}>{v === "enabled" ? "Enabled" : v === "external" ? (k === "knowledgeHub" && !s.knowledgeHubUrl ? "External · URL not set" : "External link") : "Coming soon"}</Badge></td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Notifications" />
        <CardBody className="space-y-1.5 text-[13px] text-ink-2">
          <p>• In-app notifications for approvals, delegations, events, published regulations needing acknowledgement and recognition.</p>
          <p>• Reminder timing and escalation deadlines: <Link href="/settings/approvals" className="text-brand-700 hover:underline">Approvals</Link> and <Link href="/settings/system" className="text-brand-700 hover:underline">System & jobs</Link>.</p>
          <p>• Audit logs: <Link href="/settings/security" className="text-brand-700 hover:underline">Security & audit log</Link>.</p>
        </CardBody>
      </Card>
    </div>
  );
}
