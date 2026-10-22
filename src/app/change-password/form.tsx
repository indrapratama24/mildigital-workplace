"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { logoutAction, setNewPasswordAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function SetPasswordForm() {
  const router = useRouter();
  const [f, setF] = useState({ password: "", confirm: "" });
  const [pending, start] = useTransition();
  const mismatch = f.confirm.length > 0 && f.password !== f.confirm;
  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await setNewPasswordAction(f);
          if (!r.ok) return void toast.error(r.error);
          toast.success(r.message);
          router.replace("/overview");
          router.refresh();
        });
      }}
    >
      <Field label="New password" hint="At least 10 characters, with letters and numbers.">
        <Input type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required />
      </Field>
      <Field label="Confirm new password" error={mismatch ? "The passwords don't match." : undefined}>
        <Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
      </Field>
      <Button type="submit" className="w-full" loading={pending} disabled={!f.password || mismatch}>Save and continue</Button>
      <button type="button" onClick={() => logoutAction()} className="block w-full text-center text-[13px] text-muted hover:text-ink">Sign out</button>
    </form>
  );
}
