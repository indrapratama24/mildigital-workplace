import { requirePagePermission } from "@/server/auth/guard";
import { GRANTABLE, GRANT_PRESETS, PERMISSIONS, ROLE_LABELS } from "@/server/authz";
import { listAccess } from "@/server/services/access";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Avatar, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";
import { GrantEditor } from "../workplace-forms";

export default async function AccessPage() {
  await requirePagePermission("user.manage");
  const users = await listAccess();
  const options = GRANTABLE.map((k) => ({ key: k, label: PERMISSIONS[k] }));
  return (
    <Card>
      <CardHeader
        title="Roles & access"
        description="Roles (Employee, Leader, HR, Super Admin) are set on the employee profile. Here you add individual permissions on top — e.g. make someone a Client / Business Manager without changing their role."
      />
      <CardBody>
        <Table className="min-w-[720px]">
          <thead><tr><th>Person</th><th>Role</th><th>Extra permissions</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.userId}>
                <td><span className="flex items-center gap-2.5"><Avatar name={u.name} /><span><span className="block font-medium text-ink">{u.name}</span><span className="block text-[11.5px] text-muted">{u.title}</span></span></span></td>
                <td><Badge tone={u.role === "SUPER_ADMIN" ? "brand" : u.role === "HR" ? "success" : "neutral"}>{ROLE_LABELS[u.role]}</Badge></td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {u.grants.length === 0 && <span className="text-subtle">—</span>}
                    {u.grants.map((g) => <code key={g} className="rounded-md bg-brand-50 px-1.5 py-0.5 text-[11.5px] text-brand-700">{g}</code>)}
                  </div>
                </td>
                <td className="text-right">{u.role !== "SUPER_ADMIN" && <GrantEditor userId={u.userId} name={u.name} grants={u.grants} inherited={u.inherited} options={options} presets={GRANT_PRESETS} />}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </CardBody>
    </Card>
  );
}
