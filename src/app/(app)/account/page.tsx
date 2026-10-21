import { requirePageUser } from "@/server/auth/guard";
import { ROLE_LABELS } from "@/server/authz";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requirePageUser();
  return (
    <>
      <PageHeader eyebrow="Account" title={me.fullName} description={`${me.email} · ${ROLE_LABELS[me.role]}`} />
      <Card className="max-w-lg">
        <CardHeader title="Change password" description="All sessions are signed out after a change." />
        <CardBody>
          <PasswordForm />
        </CardBody>
      </Card>
    </>
  );
}
