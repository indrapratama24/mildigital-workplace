import { requirePagePermission } from "@/server/auth/guard";
import { CSV_TEMPLATE } from "@/server/services/org";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { ImportForm } from "../employee-forms";

export const metadata = { title: "Import employees" };

export default async function ImportPage() {
  await requirePagePermission("employee.manage");
  return (
    <>
      <PageHeader eyebrow="Team Directory" title="Bulk import" description="Validate first; the import is all-or-nothing. Leaders can be existing employees or rows in the same file. CSV can only grant Employee or Leader roles." />
      <Card className="max-w-4xl">
        <CardHeader title="Columns" description="employee_id, full_name, email, job_title, employment_status, level_code, department_code, team_name, leader_email, secondary_leader_email, start_date (YYYY-MM-DD), role, birth_date (optional), phone (optional). Identity, bank and family data are entered by HR on each profile (they're encrypted)." />
        <CardBody>
          <ImportForm template={CSV_TEMPLATE} />
        </CardBody>
      </Card>
    </>
  );
}
