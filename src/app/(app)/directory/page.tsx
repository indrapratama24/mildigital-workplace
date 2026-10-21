import Link from "next/link";
import { Cake, Crown, Lock, PlaneTakeoff, Plus, Upload, Users } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { directoryHighlights, listDirectory } from "@/server/services/people";
import { formatDate, formatWeekdayShort, todayJakarta } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, EmptyState, PageHeader, Stat, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { LeadersEditor } from "./leaders-editor";

export const metadata = { title: "Team Directory" };

export default async function DirectoryPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const me = await requirePageUser();
  const sp = await searchParams;
  const today = todayJakarta();
  const manageLeaders = can(me, "settings.manage");
  const [{ rows, highlights: h, isHR }, hl, teams, levels, departments, titles, everyone] = await Promise.all([
    listDirectory(me, {
      q: sp.q,
      teamId: sp.team,
      levelId: sp.level,
      departmentId: sp.department,
      jobTitle: sp.role,
      status: (sp.status as "active" | "inactive" | "all") ?? "active",
    }),
    directoryHighlights(7),
    db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" } }),
    db.department.findMany({ orderBy: { name: "asc" } }),
    db.employee.findMany({ where: { isActive: true }, distinct: ["jobTitle"], select: { jobTitle: true }, orderBy: { jobTitle: "asc" } }),
    manageLeaders ? db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true, jobTitle: true }, orderBy: { fullName: "asc" } }) : Promise.resolve([]),
  ]);
  const view = sp.view === "teams" ? "teams" : "list";
  const viewHref = (v: string) => {
    const p = new URLSearchParams(Object.entries(sp).filter(([, x]) => x) as [string, string][]);
    if (v === "list") p.delete("view");
    else p.set("view", v);
    return `/directory?${p.toString()}`;
  };
  const groups = [...rows.reduce((m, r) => m.set(r.team ?? "No team", [...(m.get(r.team ?? "No team") ?? []), r]), new Map<string, typeof rows>())].sort((a, b) => a[0].localeCompare(b[0]));
  const outToday = hl.out.filter((o) => o.now);
  const short = (d: string) => `${formatWeekdayShort(d)}, ${formatDate(d).replace(/ \d{4}$/, "")}`;
  const hidden = <Lock className="h-3 w-3 text-line" aria-label="Hidden by privacy settings or not filled in" />;

  return (
    <>
      <PageHeader
        eyebrow="Team Directory"
        title="People at MIL Digital"
        description="Who's who across every team: roles, teams, leaders and how to reach them. What each person can see follows the Directory privacy settings."
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

      <div className="mb-5 grid grid-cols-2 gap-3">
        <Stat label="Team Members" value={h.headcount} icon={Users} hint={`${hl.teams.length} teams`} />
        <Stat label="Out Today" value={outToday.length} icon={PlaneTakeoff} tone={outToday.length ? "warning" : "default"} hint="on leave or permission" />
      </div>

      <div className="mb-5 grid gap-4 lg:grid-cols-3">
        {(hl.leaders.length > 0 || manageLeaders) && (
          <Card>
            <CardHeader
              title={<span className="flex items-center gap-2"><Crown className="h-4 w-4 text-brand-600" /> Leaders</span>}
              action={
                manageLeaders ? (
                  <LeadersEditor
                    curated={hl.curated}
                    initial={hl.leaders.map((l) => ({ employeeId: l.id, caption: hl.curated && l.caption !== l.title ? l.caption : "" }))}
                    people={everyone.map((e) => ({ id: e.id, name: e.fullName, title: e.jobTitle }))}
                  />
                ) : undefined
              }
            />
            <CardBody className="space-y-1 pt-3">
              {hl.leaders.length === 0 && <p className="text-[13px] text-muted">No leaders highlighted. Use Edit to choose who appears here.</p>}
              {hl.leaders.map((l) => (
                <Link key={l.id} href={`/directory/${l.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                  <Avatar name={l.name} photoId={l.photoId} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium text-ink">{l.name}</span>
                    <span className="block truncate text-[11.5px] text-muted">{l.caption}</span>
                  </span>
                </Link>
              ))}
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><PlaneTakeoff className="h-4 w-4 text-leave" /> On leave or permission</span>} description="Today and the next 7 days" />
          <CardBody className="space-y-1 pt-3">
            {hl.out.length === 0 && <p className="text-[13px] text-muted">Everyone is in — no approved leave or permission this week.</p>}
            {hl.out.slice(0, 8).map((o) => (
              <Link key={o.id} href={`/directory/${o.employee.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                <Avatar name={o.employee.name} photoId={o.employee.photoId} className="h-7 w-7 text-[11px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{o.employee.name}</span>
                  <span className="block truncate text-[11.5px] text-muted">
                    {o.now ? (o.end === today ? (o.halfDay ? `Today, ${o.halfDay}` : "Today only") : `Until ${short(o.end)}`) : o.start === o.end ? short(o.start) : `${short(o.start)} – ${short(o.end)}`}
                    {o.employee.team && ` · ${o.employee.team}`}
                  </span>
                </span>
                <Badge tone={o.kind === "Leave" ? "leave" : "permission"} className="shrink-0">{o.now ? `${o.kind} · now` : o.kind}</Badge>
              </Link>
            ))}
            {hl.out.length > 8 && <p className="px-2 text-[12px] text-muted">+{hl.out.length - 8} more</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><Cake className="h-4 w-4 text-brand-600" /> Birthdays</span>} description="Next 30 days" />
          <CardBody className="space-y-1 pt-3">
            {h.birthdays.length === 0 && <p className="text-[13px] text-muted">No birthdays in the next 30 days (or birthdays are private).</p>}
            {h.birthdays.slice(0, 8).map((b) => (
              <Link key={b.id} href={`/directory/${b.id}`} className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-brand-50">
                <Avatar name={b.name} photoId={b.photoId} className="h-7 w-7 text-[11px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{b.name}</span>
                  {b.team && <span className="block truncate text-[11.5px] text-muted">{b.team}</span>}
                </span>
                <span className={cn("shrink-0 text-[12px] font-medium", b.next === today ? "text-brand-700" : "text-ink-2")}>{b.next === today ? "Today 🎉" : short(b.next)}</span>
              </Link>
            ))}
            {h.birthdays.length > 8 && <p className="px-2 text-[12px] text-muted">+{h.birthdays.length - 8} more</p>}
          </CardBody>
        </Card>
      </div>

      <Card>
        <form className="flex flex-wrap gap-2 p-4" method="get">
          <Input name="q" defaultValue={sp.q} placeholder="Search name, nickname, ID or role" className="h-9 w-[240px]" />
          <Select name="team" defaultValue={sp.team ?? ""} className="h-9 w-auto">
            <option value="">All teams</option>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
          <Select name="department" defaultValue={sp.department ?? ""} className="h-9 w-auto">
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select name="level" defaultValue={sp.level ?? ""} className="h-9 w-auto">
            <option value="">All levels</option>
            {levels.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
          <Select name="role" defaultValue={sp.role ?? ""} className="h-9 w-auto">
            <option value="">All roles</option>
            {titles.map((t) => <option key={t.jobTitle} value={t.jobTitle}>{t.jobTitle}</option>)}
          </Select>
          {isHR && (
            <Select name="status" defaultValue={sp.status ?? "active"} className="h-9 w-auto">
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="all">All</option>
            </Select>
          )}
          {view === "teams" && <input type="hidden" name="view" value="teams" />}
          <button className={buttonClass("primary", "sm", "h-9")}>Filter</button>
          {(sp.q || sp.team || sp.level || sp.status || sp.department || sp.role) && <Link href={view === "teams" ? "/directory?view=teams" : "/directory"} className={buttonClass("ghost", "sm", "h-9")}>Reset</Link>}
          <span className="ml-auto flex items-center gap-1 rounded-full border border-line bg-white p-1 text-[12.5px]">
            <Link href={viewHref("list")} className={cn("rounded-full px-3 py-1 font-medium", view === "list" ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>List</Link>
            <Link href={viewHref("teams")} className={cn("rounded-full px-3 py-1 font-medium", view === "teams" ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>By team</Link>
          </span>
        </form>
        {rows.length === 0 ? (
          <EmptyState icon={Users} title="No one matches these filters" className="m-4" />
        ) : view === "teams" ? (
          <div className="grid gap-4 p-4 pt-0 md:grid-cols-2 xl:grid-cols-3">
            {groups.map(([team, people]) => {
              const lead = hl.teams.find((t) => t.name === team)?.lead;
              return (
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
                        {lead?.id === r.id && <Badge tone="brand">Lead</Badge>}
                      </Link>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="px-2 pb-3">
            <Table className="min-w-[1180px] [&_td]:whitespace-nowrap">
              <thead>
                <tr>
                  <th>Name & role</th>
                  <th>Nickname</th>
                  <th>Team</th>
                  <th>Department</th>
                  <th>Level</th>
                  <th>Join date</th>
                  <th>Birthday</th>
                  <th>Work email</th>
                  <th>Phone</th>
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
                    <td>{r.nickname ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.team ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.department ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.level ?? <span className="text-subtle">—</span>}</td>
                    <td>{r.joinDate ? <span title={r.tenure?.label}>{formatDate(r.joinDate)}</span> : hidden}</td>
                    <td>{r.birthday ? <span className="inline-flex items-center gap-1"><Cake className="h-3.5 w-3.5 text-subtle" />{r.birthday.label}</span> : hidden}</td>
                    <td>{r.email ? <a href={`mailto:${r.email}`} className="text-brand-700 hover:underline">{r.email}</a> : hidden}</td>
                    <td>{r.phone ? <a href={`tel:${r.phone.replace(/\s/g, "")}`} className="hover:text-brand-700">{r.phone}</a> : hidden}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-muted">
        <Lock className="mr-1 inline h-3 w-3" /> hidden by privacy settings or not filled in.
        {isHR && (
          <>
            {" "}Control what colleagues can see in <Link href="/settings/directory" className="text-brand-700 hover:underline">Settings → Employees & privacy</Link>. WFO/WFH requirements are on each profile under “Employment &amp; work arrangement”.
          </>
        )}
      </p>
    </>
  );
}
