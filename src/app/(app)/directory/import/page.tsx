import Link from "next/link";
import { ArrowLeft, Download } from "lucide-react";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { importTeamAction } from "@/server/actions/admin";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { CsvImportForm } from "@/components/app/csv-import";

export const metadata = { title: "Import team" };

const FIELDS: [string, string][] = [
  ["employee_id", "Required. A known ID updates that person; a new ID creates them."],
  ["full_name / email / job_title", "Required for new people. Email changes aren't imported."],
  ["nickname", "Optional."],
  ["employment_status", "PERMANENT, CONTRACT, PROBATION or INTERN (new people default to PROBATION)."],
  ["level", "Level code or name — required for new people. A change for an existing person applies from today."],
  ["department / team", "Department code or name; team name."],
  ["leader / secondary_leader", "Work email or employee ID — existing people or rows in this file."],
  ["start_date", "Join date (new people). YYYY-MM-DD or DD/MM/YYYY."],
  ["leave_eligible_since", "Day they passed probation — annual leave is earned from this month."],
  ["role", "EMPLOYEE or LEADER only (HR/Admin roles are given on the profile)."],
  ["birth_date / phone / role_description", "Optional."],
];

export default async function ImportTeamPage() {
  await requirePagePermission("employee.manage");
  const [levels, departments, teams] = await Promise.all([db.employeeLevel.findMany({ orderBy: { rank: "asc" } }), db.department.findMany({ orderBy: { name: "asc" } }), db.team.findMany({ where: { isActive: true }, orderBy: { name: "asc" } })]);
  return (
    <>
      <Link href="/directory" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-brand-700">
        <ArrowLeft className="h-4 w-4" /> Team Directory
      </Link>
      <PageHeader
        eyebrow="Team Directory"
        title="Import team"
        description="Upload a CSV with the template columns. Every row is checked first; nothing is saved until all rows are valid. Empty cells leave an existing person's data unchanged."
        actions={
          <>
            <a href="/api/employees/template" className={buttonClass("secondary")}><Download className="h-4 w-4" /> Download template</a>
            <a href="/api/employees/export" className={buttonClass("ghost")}>Export current team</a>
          </>
        }
      />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <CsvImportForm run={importTeamAction} doneHref="/directory" doneLabel="Open the Team Directory" />
        <Card className="self-start">
          <CardHeader title="Columns" description="Same columns as the export — export, edit, re-import." />
          <CardBody className="space-y-2.5 text-[12.5px]">
            {FIELDS.map(([k, v]) => (
              <div key={k}>
                <code className="text-[12px] font-semibold text-brand-700">{k}</code>
                <div className="text-muted">{v}</div>
              </div>
            ))}
            <div className="space-y-1 border-t border-line-2 pt-2.5 text-muted">
              <div><b className="text-ink-2">Levels:</b> {levels.map((l) => l.code).join(", ")}</div>
              <div><b className="text-ink-2">Departments:</b> {departments.map((d) => d.code).join(", ")}</div>
              <div><b className="text-ink-2">Teams:</b> {teams.map((t) => t.name).join(", ")}</div>
              <div className="pt-1">New people get no usable password — set a temporary one from their profile (Reset password). Identity, bank and family data are entered on each profile (encrypted).</div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
