import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { ApprovalSettingsForm } from "../forms";

export default async function ApprovalSettingsPage() {
  await requirePagePermission("settings.manage");
  const [settings, hr, types] = await Promise.all([
    getSettings(),
    db.employee.findMany({ where: { isActive: true, user: { role: { in: ["HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.requestType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Approval routing" description="Leader approval follows each employee's effective primary leader. Self-approval is always blocked." />
        <CardBody>
          <ApprovalSettingsForm initial={settings} hrPeople={hr.map((h) => ({ id: h.id, name: h.fullName }))} />
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Peer delegation by request type" description="Edit in Settings → Request types." />
        <CardBody className="flex flex-wrap gap-2 text-[13px]">
          {types.map((t) => (
            <span key={t.id} className="rounded-full border border-line px-3 py-1">
              {t.name}: <b>{t.delegation === "NONE" ? "bypass" : t.delegation.toLowerCase()}</b>
            </span>
          ))}
        </CardBody>
      </Card>
      <Notice tone="info">Leader approval of monthly plans can be switched off per policy version (“Leader approval required”). HR exception approval is configured per policy (“Exceptions require HR approval”).</Notice>
    </div>
  );
}
