import Link from "next/link";
import { Settings2 } from "lucide-react";
import { requirePageUser } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { PageHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { HubTabs } from "@/components/app/workplace/hub-tabs";

export default async function CompanyLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePageUser();
  return (
    <>
      <PageHeader
        eyebrow="Organization"
        title="Company Hub"
        description="Everything about MIL Digital in one place: who we are, how we work, the rules we follow and what's happening."
        actions={can(me, "content.manage") ? <Link href="/settings/content" className={buttonClass("secondary")}><Settings2 className="h-4 w-4" /> Manage content</Link> : undefined}
      />
      <HubTabs />
      {children}
    </>
  );
}
