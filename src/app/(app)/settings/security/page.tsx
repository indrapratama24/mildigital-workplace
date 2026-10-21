import Link from "next/link";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Permission } from "@/server/authz";
import { formatDateTime } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table } from "@/components/ui/misc";
import { Input } from "@/components/ui/field";
import { buttonClass } from "@/components/ui/button";
import type { Role } from "@prisma/client";

export default async function SecurityPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  await requirePagePermission("audit.view");
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = sp.q ? { OR: [{ action: { contains: sp.q, mode: "insensitive" as const } }, { entityType: { contains: sp.q, mode: "insensitive" as const } }, { entityId: sp.q }] } : {};
  const [logs, total, users] = await Promise.all([
    db.auditLog.findMany({ where, include: { actor: { include: { employee: { select: { fullName: true } } } } }, orderBy: { createdAt: "desc" }, take: 50, skip: (page - 1) * 50 }),
    db.auditLog.count({ where }),
    db.user.findMany({ include: { employee: { select: { id: true, fullName: true } } }, orderBy: [{ role: "desc" }, { email: "asc" }] }),
  ]);
  const roles = Object.keys(ROLE_PERMISSIONS) as Role[];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Roles & permissions" description="Least privilege by default. Leaders see only their direct reports; HR has company scope." />
          <CardBody>
            <Table>
              <thead><tr><th>Permission</th>{roles.map((r) => <th key={r} className="text-center">{ROLE_LABELS[r]}</th>)}</tr></thead>
              <tbody>
                {(Object.keys(PERMISSIONS) as Permission[]).map((p) => (
                  <tr key={p}>
                    <td><div className="text-ink">{PERMISSIONS[p]}</div><div className="text-[11px] text-subtle">{p}</div></td>
                    {roles.map((r) => <td key={r} className="text-center">{ROLE_PERMISSIONS[r].has(p) ? <span className="text-success">●</span> : <span className="text-line">○</span>}</td>)}
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="User access" description="Change roles from the employee profile. Deactivation revokes sessions immediately." />
          <CardBody>
            <Table>
              <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.employee ? <Link href={`/directory/${u.employee.id}`} className="font-medium text-ink hover:text-brand-700">{u.employee.fullName}</Link> : u.email}<div className="text-[11px] text-subtle">{u.email}</div></td>
                    <td><Badge tone={u.role === "EMPLOYEE" ? "neutral" : "brand"}>{ROLE_LABELS[u.role]}</Badge></td>
                    <td>{u.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="danger">Disabled</Badge>}</td>
                    <td className="whitespace-nowrap text-muted">{formatDateTime(u.lastLoginAt)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHeader title="Audit log" description={`${total} entries · append-only (database-enforced)`} />
        <form className="flex gap-2 px-5 pt-3" method="get">
          <Input name="q" defaultValue={sp.q} placeholder="Filter by action, entity or ID" className="h-9 max-w-sm" />
          <button className={buttonClass("primary", "sm", "h-9")}>Filter</button>
        </form>
        <CardBody>
          <Table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id}>
                  <td className="whitespace-nowrap text-muted">{formatDateTime(l.createdAt)}</td>
                  <td>{l.actor?.employee?.fullName ?? l.actor?.email ?? "System"}</td>
                  <td><code className="rounded bg-canvas px-1.5 py-0.5 text-[12px]">{l.action}</code></td>
                  <td className="text-[12px]">{l.entityType}<div className="max-w-[160px] truncate text-subtle">{l.entityId}</div></td>
                  <td className="max-w-[420px]">
                    {(l.before || l.after || l.metadata) && (
                      <details>
                        <summary className="cursor-pointer text-[12px] text-brand-700">View</summary>
                        <pre className="mt-1 max-h-60 overflow-auto rounded-lg bg-canvas p-2 text-[11px]">{JSON.stringify({ before: l.before, after: l.after, metadata: l.metadata }, null, 2)}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-3 flex justify-between text-[13px]">
            {page > 1 ? <Link className="text-brand-700" href={`/settings/security?page=${page - 1}${sp.q ? `&q=${sp.q}` : ""}`}>← Newer</Link> : <span />}
            {page * 50 < total && <Link className="text-brand-700" href={`/settings/security?page=${page + 1}${sp.q ? `&q=${sp.q}` : ""}`}>Older →</Link>}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
