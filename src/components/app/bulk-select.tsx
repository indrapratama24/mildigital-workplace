"use client";
// Bulk selection for list tables: "Bulk edit" shows tick boxes on the left; with rows ticked the same button
// opens the spreadsheet editor. Rows and the header render <BulkCell> / <BulkHeaderCell>.
import { useRouter } from "next/navigation";
import { createContext, useContext, useMemo, useState } from "react";
import { CheckSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BulkState {
  active: boolean;
  selected: Set<string>;
  toggle: (id: string) => void;
  setMany: (ids: string[], on: boolean) => void;
  start: () => void;
  stop: () => void;
}

const Ctx = createContext<BulkState | null>(null);
const useBulk = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error("Bulk components must be inside <BulkProvider>.");
  return c;
};

export function BulkProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const value = useMemo<BulkState>(
    () => ({
      active,
      selected,
      toggle: (id) =>
        setSelected((s) => {
          const n = new Set(s);
          if (n.has(id)) n.delete(id);
          else n.add(id);
          return n;
        }),
      setMany: (ids, on) =>
        setSelected((s) => {
          const n = new Set(s);
          for (const id of ids) on ? n.add(id) : n.delete(id);
          return n;
        }),
      start: () => setActive(true),
      stop: () => {
        setActive(false);
        setSelected(new Set());
      },
    }),
    [active, selected],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** The "Bulk edit" button. First click shows the tick boxes; with rows ticked it opens the bulk editor (`href?ids=…`). */
export function BulkToggle({ href }: { href: string }) {
  const b = useBulk();
  const router = useRouter();
  const n = b.selected.size;
  return (
    <>
      {b.active && (
        <Button variant="ghost" onClick={b.stop}>
          <X className="h-4 w-4" /> Cancel
        </Button>
      )}
      <Button variant={b.active ? "primary" : "secondary"} disabled={b.active && n === 0} onClick={() => (b.active ? router.push(`${href}?ids=${[...b.selected].join(",")}`) : b.start())}>
        <CheckSquare className="h-4 w-4" /> {b.active ? (n ? `Bulk edit ${n} selected` : "Select rows…") : "Bulk edit"}
      </Button>
    </>
  );
}

export function BulkCell({ id, label }: { id: string; label: string }) {
  const b = useBulk();
  if (!b.active) return null;
  return (
    <td className="bulk-col w-10 min-w-10 !pr-0">
      <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand-700" checked={b.selected.has(id)} onChange={() => b.toggle(id)} aria-label={`Select ${label}`} />
    </td>
  );
}

export function BulkHeaderCell({ ids }: { ids: string[] }) {
  const b = useBulk();
  if (!b.active) return null;
  const all = ids.length > 0 && ids.every((id) => b.selected.has(id));
  return (
    <th className="bulk-col w-10 min-w-10 !pr-0">
      <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand-700" checked={all} onChange={() => b.setMany(ids, !all)} aria-label="Select all on this page" />
    </th>
  );
}
