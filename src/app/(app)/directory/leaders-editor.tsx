"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Pencil, Plus, X } from "lucide-react";
import { setDirectoryLeadersAction } from "@/server/actions/people";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Select } from "@/components/ui/field";
import { Avatar, Notice } from "@/components/ui/misc";

type Person = { id: string; name: string; title: string };
type Row = { employeeId: string; caption: string };

/** Super Admin: choose which leaders the Team Directory highlights, their order and an optional caption. */
export function LeadersEditor({ initial, curated, people }: { initial: Row[]; curated: boolean; people: Person[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Row[]>(initial);
  const [pending, start] = useTransition();
  const byId = new Map(people.map((p) => [p.id, p]));
  const move = (i: number, d: -1 | 1) =>
    setRows((r) => {
      const n = [...r];
      [n[i], n[i + d]] = [n[i + d], n[i]];
      return n;
    });
  const save = () =>
    start(async () => {
      const r = await setDirectoryLeadersAction(rows.map((x) => ({ employeeId: x.employeeId, caption: x.caption.trim() || null })));
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      setOpen(false);
      router.refresh();
    });
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setRows(initial); setOpen(true); }}>
        <Pencil className="h-3.5 w-3.5" /> Edit
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        className="sm:max-w-2xl"
        title="Highlighted leaders"
        description="Choose who appears in the Leaders card and in which order. The caption is optional — leave it empty to show the teams they lead (or their job title)."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button loading={pending} onClick={save}>Save</Button>
          </>
        }
      >
        {!curated && <Notice className="mb-3">Not customised yet — currently every team lead is shown. Saving makes this list the one shown.</Notice>}
        <div className="space-y-2">
          {rows.map((r, i) => {
            const p = byId.get(r.employeeId);
            return (
              <div key={r.employeeId} className="flex items-center gap-2 rounded-xl border border-line-2 p-2">
                <Avatar name={p?.name ?? "?"} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-ink">{p?.name ?? "Unknown"}</div>
                  <Input value={r.caption} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, caption: e.target.value } : y)))} placeholder={`Caption (optional) — e.g. Head of ${p?.title ?? "…"}`} className="mt-1 h-8 text-[12.5px]" maxLength={80} />
                </div>
                <div className="flex flex-col">
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move up"><ArrowUp className="h-3.5 w-3.5" /></button>
                  <button type="button" disabled={i === rows.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-muted hover:bg-canvas disabled:opacity-30" aria-label="Move down"><ArrowDown className="h-3.5 w-3.5" /></button>
                </div>
                <button type="button" onClick={() => setRows((x) => x.filter((_, j) => j !== i))} className="rounded p-1.5 text-muted hover:bg-danger-soft hover:text-danger" aria-label={`Remove ${p?.name ?? ""}`}><X className="h-4 w-4" /></button>
              </div>
            );
          })}
          {rows.length === 0 && <p className="text-[13px] text-muted">No leaders highlighted — the card will be hidden for everyone except Super Admins.</p>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-subtle" />
          <Select value="" onChange={(e) => e.target.value && setRows((x) => [...x, { employeeId: e.target.value, caption: "" }])} className="h-9 flex-1" aria-label="Add a leader">
            <option value="">Add a person…</option>
            {people.filter((p) => !rows.some((r) => r.employeeId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name} — {p.title}</option>)}
          </Select>
        </div>
      </Dialog>
    </>
  );
}
