"use client";
import { useActionState } from "react";
import { ArrowUpRight } from "lucide-react";
import { loginAction } from "@/server/actions/auth";
import { Field, Input } from "@/components/ui/field";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/misc";

export function LoginForm({ next }: { next?: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Work email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="username" required placeholder="nama@mildigital.id" />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      {state?.error && <Notice tone="danger">{state.error}</Notice>}
      <Button type="submit" size="lg" className="w-full gap-3" loading={pending}>
        Sign in <ArrowUpRight className="h-4 w-4" />
      </Button>
    </form>
  );
}
