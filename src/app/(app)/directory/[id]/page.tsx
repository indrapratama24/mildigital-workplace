import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { getProfile } from "@/server/services/people";
import { DomainError } from "@/server/errors";
import { PeopleSections } from "../people-sections";
import { can, ROLE_LABELS } from "@/server/authz";
import { canViewEmployee, isLeaderOf } from "@/server/services/org";
import { loadMonthContexts } from "@/server/services/calendar";
import { balancesFor } from "@/server/services/requests";
import { addMonths, currentMonthJakarta, formatDate, formatMonth, monthParam, monthStart, todayJakarta, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, PageHeader, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { clientsForEmployee } from "@/server/services/clients";
import { CLIENT_ROLE_LABEL, CLIENT_STATUS_LABEL } from "@/lib/engine/clients";
import { STATUS_TONE } from "@/components/app/clients/status";
import { PhotoControl } from "@/components/app/workplace/photo-control";
import { ResetPasswordButton } from "../reset-password";
import { ActiveToggle, BalanceForm, ChangeLevelForm, EditEmployeeForm, LeaderForm, PolicyOverrideForm } from "../employee-forms";

export const metadata = { title: "Employee" };

export default async function EmployeePage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePageUser();
  const { id } = await params;
  // Everyone can open the directory profile (fields filtered by visibility settings).
  // Employment & work-arrangement details stay with the employee, their leaders and HR.
  const profile = await getProfile(me, id).catch((err) => {
    if (err instanceof DomainError && err.code === "NOT_FOUND") return null;
    throw err;
  });
  if (!profile) notFound();
  const canSeeWork = await canViewEmployee(me, id);
  const e = await db.employee.findUnique({
    where: { id },
    include: {
      user: true,
      department: true,
      memberships: { include: { team: true }, orderBy: { effectiveFrom: "desc" } },
      levelAssignments: { include: { level: true }, orderBy: { effectiveFrom: "desc" } },
      reportsTo: { include: { leader: true }, orderBy: { effectiveFrom: "desc" } },
      policyAssignments: { include: { policy: true }, orderBy: { effectiveFrom: "desc" } },
    },
  });
  if (!e) notFound();
  const today = todayJakarta();
  const cur = currentMonthJakarta();
  const nxt = addMonths(cur.year, cur.month, 1);
  const manage = can(me, "employee.manage");
  const canLevel = manage || (can(me, "team.changeLevel") && (await isLeaderOf(db, me.employeeId, id)) && me.employeeId !== id);
  const [ctxNow, ctxNext, departments, teams, levels, leaders, policies, balances] = await Promise.all([
    loadMonthContexts([id], cur.year, cur.month),
    loadMonthContexts([id], nxt.year, nxt.month),
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" } }),
    db.employee.findMany({ where: { isActive: true, id: { not: id }, user: { role: { in: ["LEADER", "HR", "SUPER_ADMIN"] } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.policy.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    balancesFor(id, cur.year),
  ]);
  const clients = await clientsForEmployee(id);
  const months = [ctxNow.get(id)!, ctxNext.get(id)!];
  const currentTeam = e.memberships.find((m) => !m.effectiveTo || toISO(m.effectiveTo) >= today);
  const currentLevel = e.levelAssignments.find((l) => toISO(l.effectiveFrom) <= today && (!l.effectiveTo || toISO(l.effectiveTo) >= today));
  const defaultDate = monthStart(nxt.year, nxt.month);
  const range = (a: Date, b: Date | null) => `${formatDate(toISO(a))} – ${b ? formatDate(toISO(b)) : "present"}`;

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/directory" className="hover:underline">Team Directory</Link>}
        title={
          <span className="flex items-center gap-3">
            {me.employeeId === e.id || manage ? <PhotoControl employeeId={e.id} name={e.fullName} photoId={e.photoId} /> : <Avatar name={e.fullName} photoId={e.photoId} className="h-11 w-11 text-[15px]" />} {e.fullName}
          </span>
        }
        description={`${e.employeeCode} · ${e.jobTitle}${profile.level ? ` · ${profile.level}` : ""}${profile.teams[0] ? ` · ${profile.teams[0].name}` : ""}`}
        actions={
          <>
            {!e.isActive && <Badge tone="danger">Inactive</Badge>}
            {canSeeWork && <Badge tone="brand">{e.user ? ROLE_LABELS[e.user.role] : "No account"}</Badge>}
            {canSeeWork && <Link href={`/calendar?employee=${e.id}`} className={buttonClass("secondary", "sm")}>View work calendar</Link>}
            {can(me, "user.manage") && e.user && e.id !== me.employeeId && <ResetPasswordButton employeeId={e.id} name={e.fullName} />}
            {manage && <ActiveToggle id={e.id} active={e.isActive} name={e.fullName} />}
          </>
        }
      />
      <PeopleSections profile={profile} />
      <Card className="mt-5">
        <CardHeader title="Assigned clients" description="From Client & Portfolio — the same assignment records shown on each client." />
        <CardBody>
          {clients.length === 0 ? (
            <p className="text-[13px] text-muted">Not assigned to any client.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {clients.map((c) => (
                <Link key={c.id} href={`/clients/${c.id}`} className="flex items-center justify-between gap-2 rounded-xl border border-line-2 px-3 py-2 hover:border-brand-200 hover:bg-brand-50/40">
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium text-ink">{c.name}</span>
                    <span className="block text-[11.5px] text-muted">{CLIENT_ROLE_LABEL[c.role]} · since {formatDate(c.since)}</span>
                  </span>
                  <Badge tone={STATUS_TONE[c.status]}>{CLIENT_STATUS_LABEL[c.status]}</Badge>
                </Link>
              ))}
            </div>
          )}
        </CardBody>
      </Card>
      {canSeeWork && (
      <>
      <h2 className="mb-3 mt-8 font-display text-[19px] font-bold text-ink">Employment & work arrangement</h2>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="WFO requirement" description="Calculated from the policy applicable each month." />
          <CardBody className="grid gap-3 sm:grid-cols-2">
            {months.map((m) => (
              <div key={m.month} className="rounded-xl bg-canvas p-3 text-[13px]">
                <div className="font-medium text-ink">{formatMonth(m.year, m.month)}</div>
                {m.requirement && m.policy ? (
                  <>
                    <div className="mt-1 font-display text-[22px] font-bold text-brand-700">{m.requirement.effectiveMinimumWfo} WFO <span className="text-[14px] font-medium text-muted">/ max {m.requirement.maxWfhDays} WFH</span></div>
                    <div className="text-muted">{m.policy.version.policy.name}</div>
                  </>
                ) : (
                  <div className="text-danger">No policy</div>
                )}
              </div>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="History" description="Effective-dated; past months are evaluated with what applied then." />
          <CardBody className="space-y-3 text-[13px]">
            <HistoryList title="Level" rows={e.levelAssignments.map((l) => ({ k: l.id, label: l.level.name, range: range(l.effectiveFrom, l.effectiveTo), note: l.reason }))} />
            <HistoryList title="Reporting" rows={e.reportsTo.map((r) => ({ k: r.id, label: `${r.leader.fullName} (${r.type.toLowerCase()})`, range: range(r.effectiveFrom, r.effectiveTo) }))} />
            <HistoryList title="Team" rows={e.memberships.map((m) => ({ k: m.id, label: m.team.name, range: range(m.effectiveFrom, m.effectiveTo) }))} />
            {e.policyAssignments.length > 0 && <HistoryList title="Policy overrides" rows={e.policyAssignments.map((p) => ({ k: p.id, label: p.policy.name, range: range(p.effectiveFrom, p.effectiveTo), note: p.reason }))} />}
          </CardBody>
        </Card>
        {manage && (
          <Card>
            <CardHeader title="Profile" />
            <CardBody>
              <EditEmployeeForm
                id={e.id}
                initial={{ fullName: e.fullName, jobTitle: e.jobTitle, employmentStatus: e.employmentStatus, departmentId: e.departmentId ?? "", teamId: currentTeam?.teamId ?? "", role: e.user?.role ?? "EMPLOYEE", levelId: currentLevel?.levelId ?? "", roleDescription: e.roleDescription ?? "", fullTimeSince: e.fullTimeSince ? toISO(e.fullTimeSince) : "" }}
                departments={departments.map((d) => ({ id: d.id, name: d.name }))}
                teams={teams.map((t) => ({ id: t.id, name: t.name }))}
                levels={levels.map((l) => ({ id: l.id, name: l.name }))}
                levelDefaultDate={monthStart(cur.year, cur.month)}
                canGrantAdmin={can(me, "user.manage")}
              />
            </CardBody>
          </Card>
        )}
        {canLevel && !manage && (
          <Card>
            <CardHeader title="Change level" description="Future months use the new level's policy; earlier months keep the old one." />
            <CardBody>
              <ChangeLevelForm employeeId={e.id} levels={levels.map((l) => ({ id: l.id, name: l.name }))} defaultDate={defaultDate} />
            </CardBody>
          </Card>
        )}
        {manage && (
          <Card>
            <CardHeader title="Reporting line" />
            <CardBody>
              <LeaderForm
                employeeId={e.id}
                leaders={leaders.map((l) => ({ id: l.id, name: l.fullName }))}
                defaultDate={today}
                current={{
                  PRIMARY: e.reportsTo.find((r) => r.type === "PRIMARY" && toISO(r.effectiveFrom) <= today && (!r.effectiveTo || toISO(r.effectiveTo) >= today))?.leaderId ?? "",
                  SECONDARY: e.reportsTo.find((r) => r.type === "SECONDARY" && toISO(r.effectiveFrom) <= today && (!r.effectiveTo || toISO(r.effectiveTo) >= today))?.leaderId ?? "",
                }}
              />
            </CardBody>
          </Card>
        )}
        {(can(me, "policy.manage") || manage) && (
          <Card>
            <CardHeader title="Policy override" description="Explicit, authorised exception to the level's policy." />
            <CardBody>
              <PolicyOverrideForm employeeId={e.id} policies={policies.map((p) => ({ id: p.id, name: p.name }))} defaultDate={defaultDate} />
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title={`Leave balance ${cur.year}`} />
          <CardBody>
            <Table>
              <thead><tr><th>Type</th><th>Entitled</th><th>Used</th><th>Pending</th><th>Remaining</th></tr></thead>
              <tbody>
                {balances.map((b) => (
                  <tr key={b.type.id}>
                    <td>{b.type.name}</td>
                    <td className="tabular">{b.entitled}</td>
                    <td className="tabular">{b.used}</td>
                    <td className="tabular">{b.pending}</td>
                    <td className="font-semibold tabular">{b.remaining}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {can(me, "requestType.manage") && balances.map((b) => (
              <div key={b.type.id} className="mt-3">
                <div className="mb-1 text-[12px] font-medium text-muted">Adjust {b.type.name}</div>
                <BalanceForm employeeId={e.id} typeId={b.type.id} year={cur.year} entitled={b.entitled} adjusted={0} />
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
      </>
      )}
      {canSeeWork && <p className="mt-4 text-[12px] text-muted">Plans: <Link className="text-brand-700 hover:underline" href={`/calendar?month=${monthParam(cur.year, cur.month)}&employee=${e.id}`}>{formatMonth(cur.year, cur.month)}</Link> · <Link className="text-brand-700 hover:underline" href={`/calendar?month=${monthParam(nxt.year, nxt.month)}&employee=${e.id}`}>{formatMonth(nxt.year, nxt.month)}</Link></p>}
    </>
  );
}

function HistoryList({ title, rows }: { title: string; rows: { k: string; label: string; range: string; note?: string | null }[] }) {
  return (
    <div>
      <div className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted">{title}</div>
      {rows.length === 0 && <div className="text-subtle">—</div>}
      {rows.map((r) => (
        <div key={r.k} className="flex flex-wrap justify-between gap-2 border-b border-line-2 py-1">
          <span className="text-ink">{r.label}{r.note ? <span className="text-muted"> · {r.note}</span> : null}</span>
          <span className="text-muted">{r.range}</span>
        </div>
      ))}
    </div>
  );
}
