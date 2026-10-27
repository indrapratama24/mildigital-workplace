"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Eye } from "lucide-react";
import { updateClientVisibilityAction } from "@/server/actions/workplace";
import { VISIBILITY_ROLES, type PortfolioVisibility, type VisibilityRole } from "@/lib/portfolio-visibility";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const ROLE_LABEL: Record<VisibilityRole, string> = { EMPLOYEE: "Employee", LEADER: "Leader", HR: "HR" };

/** Choose which portfolio stats and breakdowns each role can see. */
export function VisibilityEditor({ groups, value }: { groups: { label: string; items: { key: string; title: string; note?: string }[] }[]; value: PortfolioVisibility }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(value);
  const [pending, start] = useTransition();
  const all = groups.flatMap((g) => g.items.map((i) => i.key));
  const toggle = (role: VisibilityRole, key: string) => setSel((s) => ({ ...s, [role]: s[role].includes(key) ? s[role].filter((k) => k !== key) : [...s[role], key] }));
  const toggleRole = (role: VisibilityRole) => setSel((s) => ({ ...s, [role]: all.every((k) => s[role].includes(k)) ? [] : all }));

  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => { setSel(value); setOpen(true); }}>
        <Eye className="h-3.5 w-3.5" /> Who can see
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title="Who can see the portfolio summary"
        description="Pick what each role sees above the client list. Super Admin and client package managers always see everything."
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              loading={pending}
              onClick={() =>
                start(async () => {
                  const r = await updateClientVisibilityAction(sel);
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
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-[12px] text-muted">
              <th className="pb-2 text-left font-medium" />
              {VISIBILITY_ROLES.map((r) => (
                <th key={r} className="w-[72px] pb-2 text-center font-medium">
                  <button type="button" onClick={() => toggleRole(r)} className="rounded px-1 hover:text-brand-700" title="Select all / none">{ROLE_LABEL[r]}</button>
                </th>
              ))}
            </tr>
          </thead>
          {groups.map((g) => (
            <tbody key={g.label} className="border-t border-line-2">
              <tr><td colSpan={4} className="pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</td></tr>
              {g.items.map((it) => (
                <tr key={it.key}>
                  <td className="py-1.5 text-ink">
                    {it.title}
                    {it.note && <span className="ml-1.5 text-[11.5px] text-subtle">{it.note}</span>}
                  </td>
                  {VISIBILITY_ROLES.map((r) => (
                    <td key={r} className="text-center">
                      <input type="checkbox" aria-label={`${ROLE_LABEL[r]} can see ${it.title}`} checked={sel[r].includes(it.key)} onChange={() => toggle(r, it.key)} className="h-4 w-4 rounded border-line accent-brand-700" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </Dialog>
    </>
  );
}
