import Link from "next/link";
import { FileText, GitPullRequestArrow } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { listMyRequests, yearEndStatus } from "@/server/services/requests";
import { YearEndCard } from "@/components/app/requests/year-end-card";
import { listMyRevisions, describeChanges } from "@/server/services/revisions";
import { formatDate, formatDateRange, formatDateTime, formatMonth, toISO } from "@/lib/dates";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState, PageHeader, Table } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/status";
import { RequestTabs } from "@/components/app/requests/tabs";
import { can } from "@/server/authz";

export const metadata = { title: "Requests & Approvals" };

export default async function RequestsPage() {
  const me = await requirePageUser();
  const [requests, revisions, approvals, delegations, yearEnd] = await Promise.all([
    listMyRequests(me.employeeId),
    listMyRevisions(me.employeeId),
    db.approvalStep.count({ where: { assigneeId: me.employeeId, kind: { in: ["LEADER", "HR", "FINAL"] }, status: "PENDING", workflow: { status: "PENDING" } } }),
    db.approvalStep.count({ where: { assigneeId: me.employeeId, kind: "DELEGATE", status: { in: ["PENDING", "CLARIFICATION_REQUESTED"] }, workflow: { status: "PENDING" } } }),
    yearEndStatus(me.employeeId),
  ]);
  return (
    <>
      <PageHeader eyebrow="Requests & Approvals" title="My requests" description="Leave, permissions, offsite duty and schedule changes — with their approval status." />
      {yearEnd && (yearEnd.open || yearEnd.choice) && (
        <YearEndCard
          info={{
            year: yearEnd.year,
            typeName: yearEnd.type.name,
            open: yearEnd.open,
            opensOn: yearEnd.opensOn,
            closesOn: yearEnd.closesOn,
            projectedRemaining: yearEnd.projectedRemaining,
            tradable: yearEnd.tradable,
            maxDays: yearEnd.maxDays,
            carryUntilLabel: formatDate(yearEnd.carryUntil),
            closesLabel: formatDate(yearEnd.closesOn),
            choice: yearEnd.choice,
          }}
        />
      )}
      <RequestTabs active="mine" approvals={approvals} delegations={delegations} showAll={can(me, "approval.reassign")} />
      <div className="space-y-5">
        <Card>
          <CardHeader title="Leave & permission requests" />
          {requests.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={FileText} title="No requests yet" description="Annual leave, sick leave, permissions and offsite duty appear here." />
            </div>
          ) : (
            <div className="px-2 pb-3 pt-2">
              <Table>
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Dates</th>
                    <th>Days</th>
                    <th>Delegates</th>
                    <th>Status</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => (
                    <tr key={r.id} className="hover:bg-canvas/60">
                      <td>
                        <Link href={`/requests/${r.id}`} className="font-medium text-ink hover:text-brand-700">
                          {r.requestType.name}
                        </Link>
                        {r.durationType !== "FULL_DAY" && <span className="ml-1.5 text-[11.5px] text-muted">{r.durationType === "HOURLY" ? `${r.startTime}–${r.endTime}` : r.durationType === "HALF_DAY_AM" ? "AM" : "PM"}</span>}
                      </td>
                      <td className="whitespace-nowrap">{formatDateRange(toISO(r.startDate), toISO(r.endDate))}</td>
                      <td className="tabular">{r.workingDays}</td>
                      <td>{r.delegations.length ? r.delegations.map((d) => d.delegate.fullName).join(", ") : <span className="text-subtle">—</span>}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="whitespace-nowrap text-muted">{formatDateTime(r.updatedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Schedule changes" description="Revisions to approved monthly plans. Request one from your calendar." action={<Link href="/calendar" className="text-[13px] font-medium text-brand-700 hover:underline">Open calendar</Link>} />
          {revisions.length === 0 ? (
            <div className="p-5">
              <EmptyState icon={GitPullRequestArrow} title="No schedule changes" />
            </div>
          ) : (
            <div className="px-2 pb-3 pt-2">
              <Table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Change</th>
                    <th>Reason</th>
                    <th>Status</th>
                    <th>Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {revisions.map((r) => (
                    <tr key={r.id}>
                      <td className="whitespace-nowrap">{formatMonth(r.schedule.year, r.schedule.month)}</td>
                      <td className="min-w-[240px]">
                        {describeChanges(r.items.map((i) => ({ date: toISO(i.date), toMode: i.toMode, isReplacement: i.isReplacement })))}
                        {r.requiresException && <span className="ml-1.5 rounded bg-warning-soft px-1.5 text-[11px] font-medium text-warning">exception</span>}
                      </td>
                      <td className="max-w-[260px] truncate text-muted">{r.reason}</td>
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="whitespace-nowrap text-muted">{formatDateTime(r.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
