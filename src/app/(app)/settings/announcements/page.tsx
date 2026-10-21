import Link from "next/link";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { listAnnouncementsAdmin } from "@/server/services/workplace";
import { formatDateTime, utcToJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { AnnouncementEditor, AnnouncementStatusButtons, type AnnouncementFormValues } from "../workplace-forms";

const local = (d: Date | null) => (d ? `${utcToJakarta(d).date}T${utcToJakarta(d).time}` : "");

export default async function AnnouncementsAdminPage() {
  await requirePagePermission("content.manage");
  const [items, teams, levels, people] = await Promise.all([
    listAnnouncementsAdmin(),
    db.team.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ select: { id: true, name: true }, orderBy: { rank: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
  ]);
  const staff = people.map((p) => ({ id: p.id, name: p.fullName }));
  const categories = [...new Set(["Company update", "Regulation", "Milestone", "Event", ...items.map((i) => i.category)])];
  const now = new Date();
  const empty: AnnouncementFormValues = { title: "", body: "", category: "Company update", priority: "NORMAL", publishAt: local(now).slice(0, 16), expiresAt: "", audienceType: "ALL", teamIds: [], levelIds: [], employeeIds: [], linkUrl: "", attachment: null };
  const props = { teams, levels, people: staff, categories };
  return (
    <Card>
      <CardHeader title="Announcements" description="Shown on Home and in the Company Hub to the targeted audience, from the publication time until expiry." action={<AnnouncementEditor initial={empty} {...props} />} />
      <CardBody>
        {items.length === 0 ? (
          <EmptyState title="No announcements yet" />
        ) : (
          <Table className="min-w-[900px]">
            <thead><tr><th>Title</th><th>Status</th><th>Priority</th><th>Audience</th><th>Publish</th><th>Expires</th><th /></tr></thead>
            <tbody>
              {items.map((a) => {
                const live = a.status === "PUBLISHED" && a.publishAt <= now && (!a.expiresAt || a.expiresAt > now);
                const audience = a.audienceType === "ALL" ? "All employees" : a.audience.map((x) => x.team?.name ?? x.level?.name ?? x.employee?.fullName).filter(Boolean).join(", ");
                return (
                  <tr key={a.id}>
                    <td><Link href={`/company/announcements/${a.id}`} className="font-medium text-ink hover:text-brand-700">{a.title}</Link><div className="text-[11.5px] text-muted">{a.category} · by {a.createdBy.fullName}</div></td>
                    <td><Badge tone={live ? "success" : a.status === "PUBLISHED" ? "brand" : a.status === "ARCHIVED" ? "neutral" : "pending"}>{live ? "live" : a.status === "PUBLISHED" ? (a.publishAt > now ? "scheduled" : "expired") : a.status.toLowerCase()}</Badge></td>
                    <td>{a.priority.toLowerCase()}</td>
                    <td className="max-w-[200px] truncate">{audience}</td>
                    <td className="whitespace-nowrap">{formatDateTime(a.publishAt)}</td>
                    <td className="whitespace-nowrap">{a.expiresAt ? formatDateTime(a.expiresAt) : "—"}</td>
                    <td className="text-right">
                      <div className="flex justify-end gap-1">
                        <AnnouncementEditor
                          id={a.id}
                          {...props}
                          initial={{
                            title: a.title,
                            body: a.body,
                            category: a.category,
                            priority: a.priority,
                            publishAt: local(a.publishAt),
                            expiresAt: local(a.expiresAt),
                            audienceType: a.audienceType,
                            teamIds: a.audience.flatMap((x) => (x.teamId ? [x.teamId] : [])),
                            levelIds: a.audience.flatMap((x) => (x.levelId ? [x.levelId] : [])),
                            employeeIds: a.audience.flatMap((x) => (x.employeeId ? [x.employeeId] : [])),
                            linkUrl: a.linkUrl ?? "",
                            attachment: a.attachment ? { id: a.attachment.id, name: a.attachment.originalName } : null,
                          }}
                        />
                        <AnnouncementStatusButtons id={a.id} status={a.status} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
