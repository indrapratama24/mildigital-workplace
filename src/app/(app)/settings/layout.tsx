import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { getSettings } from "@/server/services/settings";
import { SETTINGS_GROUPS } from "./nav";
import { SettingsTabs } from "./tabs";

export const metadata = { title: "Settings" };

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const [me, { knowledgeHubName }] = await Promise.all([requirePageUser(), getSettings()]);
  // the platform page is named after the Knowledge Hub, whose name is editable
  const named = (href: string, label: string) => (href === "/settings/platform" ? `${knowledgeHubName} & notifications` : label);
  const groups = SETTINGS_GROUPS.map((g) => ({ label: g.label, items: g.items.filter((i) => can(me, i.perm)).map(({ href, label }) => ({ href, label: named(href, label) })) })).filter((g) => g.items.length);
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
