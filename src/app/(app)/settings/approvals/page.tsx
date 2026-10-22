import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/misc";
import { ApprovalSettingsForm, FinalApprovalForm } from "../forms";

export default async function ApprovalSettingsPage() {
  await requirePagePermission("settings.manage");
  const [settings, hr, types, approvers] = await Promise.all([
    getSettings(),
    db.employee.findMany({ where: { isActive: true, user: { role: { in: ["HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.requestType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.employee.findMany({ where: { isActive: true, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
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
        <CardHeader title="Final approval" description="An extra approval after the leader — e.g. the CEO approving all leave. Turn it off by choosing “No final approval”." />
        <CardBody>
          <FinalApprovalForm
            initial={{ finalApproverEmployeeId: settings.finalApproverEmployeeId, finalApprovalRequestTypes: settings.finalApprovalRequestTypes }}
            approvers={approvers.map((a) => ({ id: a.id, name: a.fullName }))}
            types={types.filter((t) => t.category !== "ADDITIONAL_WFH" && t.category !== "SCHEDULE_CHANGE").map((t) => ({ id: t.id, name: t.name, category: t.category }))}
          />
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
