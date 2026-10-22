"use client";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Copy, KeyRound, RefreshCw } from "lucide-react";
import { resetPasswordAction } from "@/server/actions/auth";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Notice } from "@/components/ui/misc";

/** Readable temporary password, e.g. "Mil-river-4827". */
function generate() {
  const words = ["river", "maple", "orbit", "coral", "ember", "lotus", "pixel", "cedar", "comet", "delta", "harbor", "sunny"];
  const pick = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
  return `Mil-${words[pick(words.length)]}-${String(1000 + pick(9000))}`;
}

export function ResetPasswordButton({ employeeId, name }: { employeeId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState("");
  const [done, setDone] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => { setPw(generate()); setDone(false); setOpen(true); }}>
        <KeyRound className="h-4 w-4" /> Reset password
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Reset password · ${name}`}
        description="Give them this temporary password. They'll be signed out everywhere now and must choose their own password (and confirm it) when they next sign in."
        footer={
          done ? (
            <Button onClick={() => setOpen(false)}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await resetPasswordAction({ employeeId, temporaryPassword: pw });
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(r.message);
                    setDone(true);
                  })
                }
              >
                Set temporary password
              </Button>
            </>
          )
        }
      >
        <Field label="Temporary password" hint="At least 10 characters with letters and numbers. Share it privately (not in a group chat).">
          <div className="flex gap-2">
            <Input value={pw} onChange={(e) => setPw(e.target.value)} disabled={done} className="font-mono" autoComplete="off" />
            {!done && <Button variant="secondary" onClick={() => setPw(generate())} aria-label="Generate another"><RefreshCw className="h-4 w-4" /></Button>}
            <Button variant="secondary" onClick={() => navigator.clipboard.writeText(pw).then(() => toast.success("Copied"))} aria-label="Copy"><Copy className="h-4 w-4" /></Button>
          </div>
        </Field>
        {done && <Notice tone="success" className="mt-3">Done. {name.split(" ")[0]} can sign in with this password and will be asked to set a new one.</Notice>}
      </Dialog>
    </>
  );
}
