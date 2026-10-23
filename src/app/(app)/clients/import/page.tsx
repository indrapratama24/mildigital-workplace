import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { listPackages } from "@/server/services/clients";
import { PageHeader } from "@/components/ui/misc";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { buttonClass } from "@/components/ui/button";
import { CsvImportForm } from "@/components/app/csv-import";
import { importClientsAction } from "@/server/actions/workplace";

export const metadata = { title: "Import clients" };

const FIELDS: [string, string][] = [
  ["client_id", "Empty = new client (ID generated). An existing Client ID updates that client."],
  ["brand_name", "Required."],
  ["client_organization", "Optional legal/business owner."],
  ["status", "Preparation (future date_start), Active, Inactive or Freeze for new clients. Status of existing clients is changed on the client page."],
  ["date_start / date_off", "YYYY-MM-DD or DD/MM/YYYY. date_off is required for Inactive."],
  ["package", "Name of an existing package."],
  ["category", "Name of an existing category."],
  ["industry / sub_industry", "Any text — new values are saved for other brands."],
  ["ad_accounts", "Separate with “;”. New names are added to the list."],
  ["consultant_1 / consultant_2", "Work email or employee ID from the Team Directory."],
  ["additional_consultants / ads_strategists", "Several people separated by “;” (max 3 Ads Strategists)."],
  ["website_url / instagram_url / tiktok_url", "Full https:// links."],
  ["pic_name / pic_phone / pic_email", "Client contact (restricted visibility)."],
  ["brand_description / internal_notes", "Free text."],
];

export default async function ImportClientsPage() {
  await requirePagePermission("client.manage");
  const [packages, categories, adAccounts] = await Promise.all([
    listPackages(),
    db.clientCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.clientAdAccountType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  return (
    <>
      <Link href="/clients" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Client directory
      </Link>
      <PageHeader
        eyebrow="Client & Portfolio"
        title="Import clients"
        description="Upload a CSV with the template columns. Every row is checked first; nothing is saved until all rows are valid."
        actions={
          <>
            <a href="/api/clients/template" className={buttonClass("secondary")}><Download className="h-4 w-4" /> Download template</a>
            <a href="/api/clients/export" className={buttonClass("ghost")}>Export current clients</a>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CsvImportForm run={importClientsAction} doneHref="/clients" doneLabel="Open the client directory" />
        <Card className="self-start">
          <CardHeader title="Columns" description="Same columns as the export — export, edit, re-import." />
          <CardBody className="space-y-2.5 text-[12.5px]">
            {FIELDS.map(([k, v]) => (
              <div key={k}>
                <code className="text-[12px] font-semibold text-brand-700">{k}</code>
                <div className="text-muted">{v}</div>
              </div>
            ))}
            <div className="border-t border-line-2 pt-2.5 text-muted">
              <div><b className="text-ink-2">Packages:</b> {packages.map((p) => p.name).join(", ") || "—"}</div>
              <div><b className="text-ink-2">Categories:</b> {categories.map((c) => c.name).join(", ") || "—"}</div>
              <div><b className="text-ink-2">Ad accounts:</b> {adAccounts.map((a) => a.name).join(", ") || "—"}</div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
