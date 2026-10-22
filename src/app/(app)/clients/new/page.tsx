import { requirePagePermission } from "@/server/auth/guard";
import { assignableEmployees, clientFilterOptions, listPackages } from "@/server/services/clients";
import { getSettings } from "@/server/services/settings";
import { todayJakarta } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { ClientForm } from "@/components/app/clients/client-form";
import { EMPTY_CLIENT } from "@/components/app/clients/form-values";

export const metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requirePagePermission("client.manage");
  const [packages, people, settings, opts] = await Promise.all([listPackages(), assignableEmployees(), getSettings(), clientFilterOptions()]);
  const today = todayJakarta();
  return (
    <>
      <PageHeader eyebrow="Client & Portfolio" title="Add client" description="Brand, collaboration, package and team. The Client ID is generated automatically unless you enter one." />
      <ClientForm
        mode="create"
        initial={{ ...EMPTY_CLIENT, dateStart: today, packageId: packages[0]?.id ?? "" }}
        packages={packages}
        people={people}
        today={today}
        requirePrimary={settings.clientRequirePrimaryConsultant}
        canChangeCode
        canEditSensitive
        taxonomy={{ categories: opts.categories, industries: opts.industries, adAccounts: opts.adAccounts }}
      />
    </>
  );
}
