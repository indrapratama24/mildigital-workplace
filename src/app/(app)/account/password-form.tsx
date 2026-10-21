"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { changePasswordAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

export function PasswordForm() {
  const [f, setF] = useState({ current: "", next: "", confirm: "" });
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <Field label="Current password"><Input type="password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} /></Field>
      <Field label="New password" hint="10+ characters with letters and numbers."><Input type="password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
      <Field label="Confirm new password" error={f.confirm && f.confirm !== f.next ? "Passwords don't match" : null}><Input type="password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      <Button
        loading={pending}
        disabled={!f.current || !f.next || f.next !== f.confirm}
        onClick={() =>
          start(async () => {
            const r = await changePasswordAction({ current: f.current, next: f.next });
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            window.location.href = "/login";
          })
        }
      >
        Update password
      </Button>
    </div>
  );
}
