"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, SlidersHorizontal } from "lucide-react";
import { updateClientHighlightsAction } from "@/server/actions/workplace";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/field";

/** Choose which portfolio breakdown charts are highlighted, and their order. */
export function HighlightsEditor({ options, selected }: { options: { key: string; title: string }[]; selected: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(selected);
  const [pending, start] = useTransition();
  const ordered = [...sel.map((k) => options.find((o) => o.key === k)!).filter(Boolean), ...options.filter((o) => !sel.includes(o.key))];
  const move = (k: string, d: -1 | 1) =>
    setSel((s) => {
      const i = s.indexOf(k);
      const n = [...s];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setSel(selected); setOpen(true); }}>
        <SlidersHorizontal className="h-3.5 w-3.5" /> Customize
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Portfolio highlights"
        description="Pick up to 6 breakdowns to show, in order. Applies for everyone."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await updateClientHighlightsAction(sel);
                  if (!r.ok) return void toast.error(r.error);
                  toast.success(r.message);
                  setOpen(false);
                  router.refresh();
                })
              }
            >
              Save
            </Button>
          </>
        }
      >
        <div className="space-y-1">
          {ordered.map((o) => {
            const on = sel.includes(o.key);
            const i = sel.indexOf(o.key);
            return (
              <div key={o.key} className="flex items-center justify-between rounded-xl border border-line-2 px-3 py-2">
                <Checkbox checked={on} disabled={!on && sel.length >= 6} onChange={(e) => setSel((s) => (e.target.checked ? [...s, o.key] : s.filter((x) => x !== o.key)))} label={o.title} />
                {on && (
                  <span className="flex">
                    <button type="button" disabled={i === 0} onClick={() => move(o.key, -1)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" disabled={i === sel.length - 1} onClick={() => move(o.key, 1)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Dialog>
    </>
  );
}
