import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { SystemSettingsForm } from "../forms";

export default async function SystemPage() {
  await requirePagePermission("settings.manage");
  const settings = await getSettings();
  return (
    <Card>
      <CardHeader title="System settings" description="Timezone is fixed to Asia/Jakarta. Daily jobs send deadline reminders, detect WFO shortfalls and escalate overdue approvals (schedule POST /api/cron daily)." />
      <CardBody>
        <SystemSettingsForm initial={settings} />
      </CardBody>
    </Card>
  );
}
