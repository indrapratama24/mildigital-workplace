import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { Wordmark } from "@/components/app/brand";
import { SetPasswordForm } from "./form";

export const metadata = { title: "Set a new password" };

/** Shown after an admin password reset; the rest of the app is blocked until a new password is set. */
export default async function ChangePasswordPage() {
  const me = await getCurrentUser();
  if (!me) redirect("/login");
  if (!me.mustChangePassword) redirect("/overview");
  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-md rounded-3xl border border-line bg-white p-7 shadow-card">
        <Wordmark />
        <h1 className="mt-6 font-display text-[24px] font-bold text-ink">Set a new password</h1>
        <p className="mt-1 text-[14px] text-muted">Hi {me.fullName.split(" ")[0]}, your password was reset by an administrator. Choose your own password to continue.</p>
        <SetPasswordForm />
      </div>
    </div>
  );
}
