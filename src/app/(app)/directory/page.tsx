import Link from "next/link";
import { Cake, PartyPopper, Plus, Sparkles, Upload, Users, UserRoundCheck, Clock3, ShieldCheck } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can, ROLE_LABELS } from "@/server/authz";
import { listDirectory } from "@/server/services/people";
import { formatDate, todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, EmptyState, PageHeader, Stat, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export const metadata = { title: "Team Directory" };

const STATUS: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", PROBATION: "Probation", INTERN: "Intern" };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const [{ rows, highlights: h, isHR }, teams, levels, leaders, departments, titles] = await Promise.all([
    listDirectory(me, {
      q: sp.q,
      teamId: sp.team,
      levelId: sp.level,
      leaderId: sp.leader,
      departmentId: sp.department,
      jobTitle: sp.role,
      employmentStatus: sp.employment,
      status: (sp.status as "active" | "inactive" | "all") ?? "active",
    }),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" } }),
    db.employee.findMany({ where: { isActive: true, directReports: { some: {} } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, distinct: ["jobTitle"], select: { jobTitle: true }, orderBy: { jobTitle: "asc" } }),
  ]);
  const view = sp.view === "teams" ? "teams" : "list";
  const viewHref = (v: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, x]) => x) as [string, string][]);
    if (v === "list") p.delete("view");
    else p.set("view", v);
    return `/directory?${p.toString()}`;
  };
  const groups = [...rows.reduce((m, r) => m.set(r.team ?? "No team", [...(m.get(r.team ?? "No team") ?? []), r]), new Map<string, typeof rows>())].sort((a, b) => a[0].localeCompare(b[0]));
  const showEmployment = rows.some((r) => r.employmentStatus !== null);
  const showPhone = rows.some((r) => r.phone !== null);
  const showBirthday = rows.some((r) => r.birthday !== null);
  return (
    <>
      <PageHeader
        eyebrow="Team Directory"
        title="People at MIL Digital"
        description="Who's who across every team: IDs, teams, levels, leaders, tenure and birthdays. What each person can see follows the Directory privacy settings."
        actions={
          <>
            <Link href={`/directory/${me.employeeId}`} className={buttonClass("secondary")}>My profile</Link>
            {can(me, "employee.manage") && (
              <>
                <Link href="/directory/import" className={buttonClass("secondary")}>
                  <Upload className="h-4 w-4" /> Import CSV
                </Link>
                <Link href="/directory/new" className={buttonClass("primary")}>
                  <Plus className="h-4 w-4" /> Add employee
                </Link>
              </>
            )}
          </>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Headcount" value={h.headcount} icon={Users} hint={`${h.teams.length} teams`} />
        <Stat label="Average tenure" value={h.avgTenure} icon={Clock3} />
        <Stat label="New joiners (90 days)" value={h.newJoiners.length} icon={Sparkles} tone="brand" />
        {h.incompleteProfiles !== null ? (
          <Stat label="Incomplete HR profiles" value={h.incompleteProfiles} icon={ShieldCheck} tone={h.incompleteProfiles ? "warning" : "success"} hint="identity, bank, contact…" />
        ) : (
          <Stat label="Birthdays (30 days)" value={h.birthdays.length} icon={Cake} />
        )}
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        <Highlight icon={Cake} title="Upcoming birthdays" empty="No birthdays in the next 30 days.">
          {h.birthdays.slice(0, 6).map((r) => (
            <PersonLine key={r.id} id={r.id} name={r.name} sub={r.team} right={r.next === todayJakarta() ? "Today 🎉" : formatDate(r.next).replace(/ \d{4}$/, "")} />
          ))}
        </Highlight>
        <Highlight icon={PartyPopper} title="Work anniversaries this month" empty="No anniversaries this month.">
          {h.anniversaries.slice(0, 6).map((r) => (
            <PersonLine key={r.id} id={r.id} name={r.name} sub={r.team} right={`${r.years} yr${r.years > 1 ? "s" : ""} · ${formatDate(r.joinDate!).replace(/ \d{4}$/, "")}`} />
          ))}
        </Highlight>
        <Highlight icon={UserRoundCheck} title="New joiners" empty="No new joiners in the last 90 days.">
          {h.newJoiners.slice(0, 6).map((r) => (
            <PersonLine key={r.id} id={r.id} name={r.name} sub={r.title} right={formatDate(r.joinDate!)} />
          ))}
        </Highlight>
      </div>

      <Card>
        <form className="flex flex-wrap gap-2 p-4" method="get">
          <Input name="q" defaultValue={sp.q} placeholder="Search name, ID or title" className="h-9 w-[220px]" />
          <Select name="team" defaultValue={sp.team ?? ""} className="h-9 w-auto">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="level" defaultValue={sp.level ?? ""} className="h-9 w-auto">
            <option value="">All levels</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select name="leader" defaultValue={sp.leader ?? ""} className="h-9 w-auto">
            <option value="">All leaders</option>
            {leaders.map((l) => <option key={l.id} value={l.id}>{l.fullName}</option>)}
          </Select>
          <Select name="department" defaultValue={sp.department ?? ""} className="h-9 w-auto">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="role" defaultValue={sp.role ?? ""} className="h-9 w-auto">
            <option value="">All roles</option>
            {titles.map((t) => <option key={t.jobTitle} value={t.jobTitle}>{t.jobTitle}</option>)}
          </Select>
          {showEmployment && (
            <Select name="employment" defaultValue={sp.employment ?? ""} className="h-9 w-auto">
              <option value="">All employment types</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
          {view === "teams" && <input type="hidden" name="view" value="teams" />}
          {isHR && (
            <Select name="status" defaultValue={sp.status ?? "active"} className="h-9 w-auto">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </Select>
          )}
          <button className={buttonClass("primary", "sm", "h-9")}>Filter</button>
          {(sp.q || sp.team || sp.level || sp.leader || sp.status || sp.department || sp.role || sp.employment) && <Link href={view === "teams" ? "/directory?view=teams" : "/directory"} className={buttonClass("ghost", "sm", "h-9")}>Reset</Link>}
          <span className="ml-auto flex items-center gap-1 rounded-full border border-line bg-white p-1 text-[12.5px]">
            <Link href={viewHref("list")} className={cn("rounded-full px-3 py-1 font-medium", view === "list" ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>List</Link>
            <Link href={viewHref("teams")} className={cn("rounded-full px-3 py-1 font-medium", view === "teams" ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>By team</Link>
          </span>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No one matches these filters" className="m-4" />
        ) : view === "teams" ? (
          <div className="grid gap-4 p-4 pt-0 md:grid-cols-2 xl:grid-cols-3">
            {groups.map(([team, people]) => (
              <div key={team} className="rounded-2xl border border-line-2 p-3">
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="font-display text-[15px] font-bold text-ink">{team}</span>
                  <span className="text-[12px] text-muted">{people.length}</span>
                </div>
                <div className="space-y-0.5">
                  {people.map((r) => (
                    <Link key={r.id} href={`/directory/${r.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                      <Avatar name={r.name} photoId={r.photoId} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-ink">{r.name}</span>
                        <span className="block truncate text-[11.5px] text-muted">{r.title}{r.level ? ` · ${r.level}` : ""}</span>
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="px-2 pb-3">
            <Table className="min-w-[980px] [&_td]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>ID</th>
                  <th>Team</th>
                  <th>Department</th>
                  <th>Level</th>
                  <th>Leader</th>
                  <th>Join date</th>
                  <th>Tenure at MIL</th>
                  {showBirthday && <th>Birthday</th>}
                  {showPhone && <th>Phone</th>}
                  {isHR && <th>Status</th>}
                  {isHR && <th>HR profile</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="hover:bg-canvas/50">
                    <td>
                      <Link href={`/directory/${r.id}`} className="flex items-center gap-2.5">
                        <Avatar name={r.name} photoId={r.photoId} />
                        <span>
                          <span className="block font-medium text-ink hover:text-brand-700">{r.name}</span>
                          <span className="block text-[11.5px] text-muted">{r.title}</span>
                        </span>
                        {!r.isActive && <Badge tone="danger">Inactive</Badge>}
                      </Link>
                    </td>
                    <td className="font-medium text-ink-2">{r.code}</td>
                    <td>{r.team ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.department ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.level ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.leader ? <Link href={`/directory/${r.leader.id}`} className="hover:text-brand-700">{r.leader.fullName}</Link> : <span className="text-subtle">—</span>}</td>
                    <td>{r.joinDate ? formatDate(r.joinDate) : <span className="text-subtle">—</span>}</td>
                    <td>{r.tenure ? <span className="font-medium text-ink">{r.tenure.label}</span> : <span className="text-subtle">—</span>}</td>
                    {showBirthday && <td>{r.birthday ? <span className="inline-flex items-center gap-1"><Cake className="h-3.5 w-3.5 text-subtle" />{r.birthday.label}</span> : <span className="text-subtle">—</span>}</td>}
                    {showPhone && <td>{r.phone ?? <span className="text-subtle">—</span>}</td>}
                    {isHR && (
                      <td>
                        <span className="text-[12px] text-muted">{r.employmentStatus ? STATUS[r.employmentStatus] : "—"}</span>
                        {r.role && r.role !== "EMPLOYEE" && <Badge tone="brand" className="ml-1.5">{ROLE_LABELS[r.role]}</Badge>}
                      </td>
                    )}
                    {isHR && (
                      <td>
                        <span className={cn("inline-flex items-center gap-1.5 text-[12px] font-medium", (r.completeness ?? 0) === 100 ? "text-success" : (r.completeness ?? 0) >= 50 ? "text-warning" : "text-danger")}>
                          <span className="h-1.5 w-12 overflow-hidden rounded-full bg-line-2">
                            <span className="block h-full rounded-full bg-current" style={{ width: `${r.completeness ?? 0}%` }} />
                          </span>
                          {r.completeness}%
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      {isHR && (
        <p className="mt-3 text-[12px] text-muted">
          Control what colleagues can see in <Link href="/settings/directory" className="text-brand-700 hover:underline">Settings → Directory &amp; privacy</Link>. WFO/WFH requirements are on each profile under “Employment &amp; work arrangement”.
        </p>
      )}
    </>
  );
}

function Highlight({ icon: Icon, title, empty, children }: { icon: typeof Cake; title: string; empty: string; children: React.ReactNode[] }) {
  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><Icon className="h-4 w-4 text-brand-600" /> {title}</span>} />
      <CardBody className="space-y-1 pt-3">{children.length ? children : <p className="text-[13px] text-muted">{empty}</p>}</CardBody>
    </Card>
  );
}

function PersonLine({ id, name, sub, right }: { id: string; name: string; sub: string | null; right: string }) {
  return (
    <Link href={`/directory/${id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
      <Avatar name={name} className="h-7 w-7 text-[11px]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{name}</span>
        {sub && <span className="block truncate text-[11.5px] text-muted">{sub}</span>}
      </span>
      <span className="shrink-0 text-[12px] font-medium text-ink-2">{right}</span>
    </Link>
  );
}
