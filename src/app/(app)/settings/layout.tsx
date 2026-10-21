import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { SETTINGS_GROUPS } from "./nav";
import { SettingsTabs } from "./tabs";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePageUser();
  const groups = SETTINGS_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => can(me, i.perm)).map(({ href, label }) => ({ href, label })) })).filter((g) => g.items.length);
  if (!groups.length) redirect("/overview?denied=1");
  return (
    <>
      <PageHeader eyebrow="Settings & Administration" title="Administration" description="Changes to policies, content, clients and access are written to the audit log. Permissions are checked on the server." />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <SettingsTabs groups={groups} />
        </aside>
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
