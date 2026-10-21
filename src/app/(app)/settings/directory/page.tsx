import { requirePagePermission } from "@/server/auth/guard";
import { AUDIENCE_LABEL, DIRECTORY_FIELDS, getVisibility } from "@/server/services/people";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { VisibilityForm } from "./visibility-form";

export default async function DirectoryPrivacyPage() {
  await requirePagePermission("employee.manage");
  const vis = await getVisibility();
  const fields = Object.entries(DIRECTORY_FIELDS).map(([key, f]) => ({ key, label: f.label, group: f.group, max: f.max, value: vis[key as keyof typeof vis] }));
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="What colleagues can see"
          description="Name, job title, employee ID, team, level and leader are always visible to everyone. Choose who else can see each field. People always see their own data; HR sees everything."
        />
        <CardBody>
          <VisibilityForm fields={fields} audiences={AUDIENCE_LABEL} />
        </CardBody>
      </Card>
      <Notice tone="info" title="How audiences work">
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          <li><b>Everyone at MIL</b> — all active employees.</li>
          <li><b>Same team</b> — people sharing a team with the employee, plus their leaders and HR. Ready for a future “team members” view.</li>
          <li><b>Their leaders &amp; HR</b> — the employee&apos;s primary/secondary leaders and HR.</li>
          <li><b>HR only</b> — HR / People Ops and Super Admins.</li>
        </ul>
        <p className="mt-2">NIK, NPWP, bank accounts and family/tax status are locked to HR only. They are encrypted in the database, masked on screen, and every reveal is recorded in the audit log.</p>
      </Notice>
    </div>
  );
}
