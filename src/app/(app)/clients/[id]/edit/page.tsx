import { notFound } from "next/navigation";
import { requirePagePermission } from "@/server/auth/guard";
import { can } from "@/server/authz";
import { assignableEmployees, clientFilterOptions, getClient, listPackages } from "@/server/services/clients";
import { getSettings } from "@/server/services/settings";
import { DomainError } from "@/server/errors";
import { todayJakarta } from "@/lib/dates";
import { PageHeader } from "@/components/ui/misc";
import { ClientForm } from "@/components/app/clients/client-form";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  const me = await requirePagePermission("client.manage");
  const { id } = await params;
  const c = await getClient(me, id).catch((e) => {
    if (e instanceof DomainError && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const [packages, active, settings, opts] = await Promise.all([listPackages({ includeInactive: true }), assignableEmployees(), getSettings(), clientFilterOptions()]);
  // Keep currently assigned people selectable even if they have since left the company.
  const assigned = [c.consultant1, c.consultant2, ...c.additional, ...c.adsStrategists].filter((p): p is NonNullable<typeof p> => !!p);
  const people = [...active, ...assigned.filter((a) => !active.some((p) => p.id === a.id)).map((a) => ({ id: a.id, fullName: `${a.name} (left)`, jobTitle: a.title }))];
  const openStatus = c.statusHistory.find((h) => !h.to);
  return (
    <>
      <PageHeader eyebrow={c.clientCode} title={`Edit ${c.name}`} description="Status and team changes are kept in the client history." />
      <ClientForm
        mode="edit"
        clientId={c.id}
        initial={{
          clientCode: c.clientCode,
          name: c.name,
          organizationName: c.organization ?? "",
          status: c.status,
          dateStart: c.dateStart,
          dateOff: c.dateOff ?? "",
          packageId: c.package?.id ?? "",
          primary: c.consultant1?.id ?? "",
          secondary: c.consultant2?.id ?? "",
          additional: c.additional.map((p) => p.id),
          adsStrategists: c.adsStrategists.map((p) => p.id),
          asAdAccounts: Object.fromEntries(c.adsStrategists.map((p) => [p.id, p.adAccounts])),
          waivePrimary: c.primaryConsultantWaived,
          waiverReason: c.waiverReason ?? "",
          categoryId: c.categoryId ?? "",
          industryName: c.industry ?? "",
          subIndustryName: c.subIndustry ?? "",
          adAccounts: c.adAccounts,
          description: c.description ?? "",
          websiteUrl: c.websiteUrl ?? "",
          instagramUrl: c.instagramUrl ?? "",
          tiktokUrl: c.tiktokUrl ?? "",
          picName: c.picName ?? "",
          picPhone: c.picPhone ?? "",
          picEmail: c.picEmail ?? "",
          internalNotes: c.internalNotes ?? "",
        }}
        packages={packages}
        people={people}
        today={todayJakarta()}
        requirePrimary={settings.clientRequirePrimaryConsultant}
        canChangeCode={can(me, "settings.manage")}
        canEditSensitive={c.sensitiveVisible}
        statusFrom={openStatus?.from}
        taxonomy={{ categories: opts.categories, industries: opts.industries, adAccounts: opts.adAccounts }}
      />
    </>
  );
}
