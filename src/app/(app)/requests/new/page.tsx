import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { requestTypesForForm } from "@/server/services/requests";
import { effectiveOn } from "@/server/services/org";
import { addDays, todayJakarta, toISO } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { RequestForm, type RequestFormInitial } from "@/components/app/requests/request-form";
import { notFound } from "next/navigation";

export const metadata = { title: "New request" };

export default async function NewRequestPage({ searchParams }: { searchParams: Promise<{ id?: string; type?: string }> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const today = todayJakarta();
  const [types, people, myTeam] = await Promise.all([
    requestTypesForForm(me.employeeId),
    db.employee.findMany({
      where: { isActive: true, id: { not: me.employeeId } },
      select: { id: true, fullName: true, memberships: { where: { isPrimary: true, ...effectiveOn(today) }, select: { teamId: true, team: { select: { name: true } } } } },
      orderBy: { fullName: "asc" },
    }),
    db.employeeTeamMembership.findFirst({ where: { employeeId: me.employeeId, isPrimary: true, ...effectiveOn(today) } }),
  ]);
  // teammates first
  const colleagues = people
    .map((p) => ({ id: p.id, fullName: p.fullName, team: p.memberships[0]?.team.name ?? null, same: p.memberships[0]?.teamId === myTeam?.teamId }))
    .sort((a, b) => Number(b.same) - Number(a.same) || a.fullName.localeCompare(b.fullName))
    .map(({ same: _same, ...c }) => c);

  let initial: RequestFormInitial = {
    requestTypeId: sp.type ? types.find((t) => t.code === sp.type)?.id ?? "" : "",
    startDate: addDays(today, 7),
    endDate: addDays(today, 7),
    durationType: "FULL_DAY",
    startTime: "09:00",
    endTime: "11:00",
    reason: "",
    document: null,
    delegations: [],
  };
  if (sp.id) {
    const r = await db.request.findUnique({ where: { id: sp.id }, include: { document: true, delegations: { include: { attachment: true }, orderBy: { createdAt: "asc" } } } });
    if (!r || r.employeeId !== me.employeeId) notFound();
    initial = {
      id: r.id,
      requestTypeId: r.requestTypeId,
      startDate: toISO(r.startDate),
      endDate: toISO(r.endDate),
      durationType: r.durationType,
      startTime: r.startTime ?? "09:00",
      endTime: r.endTime ?? "11:00",
      reason: r.reason,
      document: r.document ? { id: r.document.id, name: r.document.originalName } : null,
      delegations: r.delegations
        .filter((d) => d.status !== "CANCELLED" || r.status === "DRAFT" || r.status === "CHANGES_REQUESTED")
        .map((d) => ({
          delegateId: d.status === "DECLINED" ? "" : d.delegateId,
          previousStatus: d.status === "DECLINED" ? "DECLINED" : undefined,
          handoverNotes: d.handoverNotes,
          tasks: (d.tasks as { task: string; deadline?: string }[]) ?? [],
          coverageStart: toISO(d.coverageStart),
          coverageEnd: toISO(d.coverageEnd),
          attachment: d.attachment ? { id: d.attachment.id, name: d.attachment.originalName } : null,
        })),
    };
  }
  return (
    <>
      <PageHeader eyebrow="Requests & Approvals" title={sp.id ? "Edit request" : "New request"} description="Leave and permissions are not counted as WFH. Fields adapt to the request type." />
      <RequestForm types={types} colleagues={colleagues} initial={initial} employeeName={me.fullName} today={today} />
    </>
  );
}
