"use client";
// Spreadsheet-style bulk editor building blocks: one row per selected record, a cell per chosen column,
// changed cells highlighted, one Save for everything.
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, Columns3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Value = string | number | string[] | null;
const eq = (a: Value | undefined, b: Value | undefined) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify([...((a as string[]) ?? [])].sort()) === JSON.stringify([...((b as string[]) ?? [])].sort()) : (a ?? null) === (b ?? null));

/** Draft edits on top of the original rows. */
export function useBulkDraft<R extends { id: string }>(rows: R[]) {
  const [draft, setDraft] = useState<Record<string, Record<string, Value>>>({});
  const value = <K extends keyof R & string>(row: R, key: K) => (key in (draft[row.id] ?? {}) ? draft[row.id][key] : (row[key] as Value)) as R[K];
  const changed = (row: R, key: keyof R & string) => key in (draft[row.id] ?? {}) && !eq(draft[row.id][key], row[key] as Value);
  const set = (id: string, key: string, v: Value) => setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: v } }));
  const patches = () =>
    rows
      .map((r) => ({ id: r.id, patch: Object.fromEntries(Object.entries(draft[r.id] ?? {}).filter(([k, v]) => !eq(v, r[k as keyof R] as Value))) }))
      .filter((p) => Object.keys(p.patch).length);
  const count = useMemo(() => rows.reduce((n, r) => n + Object.entries(draft[r.id] ?? {}).filter(([k, v]) => !eq(v, r[k as keyof R] as Value)).length, 0), [draft, rows]);
  /** After a save: drop the edits of saved rows, keep those that failed. */
  const keepOnly = (ids: string[]) => setDraft((d) => Object.fromEntries(Object.entries(d).filter(([id]) => ids.includes(id))));
  return { value, changed, set, patches, count, keepOnly };
}

export function BulkToolbar({ backHref, title, changes, saving, onSave, columns, children }: { backHref: string; title: string; changes: number; saving: boolean; onSave: () => void; columns: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="sticky top-16 z-10 -mx-4 mb-3 border-b border-line bg-canvas/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={backHref} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-2 text-[13.5px] font-medium text-ink-2 hover:bg-white">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <span className="min-w-0 truncate font-display text-[15px] font-bold text-ink">{title}</span>
        <span className="ml-auto flex items-center gap-2">
          {columns}
          <Button loading={saving} disabled={!changes} onClick={onSave}>
            Save{changes ? ` ${changes} change${changes === 1 ? "" : "s"}` : ""}
          </Button>
        </span>
      </div>
      {children && <div className="mt-2.5 flex flex-wrap items-end gap-2">{children}</div>}
    </div>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", k);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", k);
    };
  }, [open]);
  return { open, setOpen, ref };
}

export function ColumnPicker({ columns, visible, onChange }: { columns: { key: string; label: string }[]; visible: string[]; onChange: (v: string[]) => void }) {
  const p = usePopover();
  return (
    <div ref={p.ref} className="relative">
      <Button variant="secondary" onClick={() => p.setOpen((o) => !o)} aria-expanded={p.open}>
        <Columns3 className="h-4 w-4" /> Columns
      </Button>
      {p.open && (
        <div className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white p-1.5 shadow-card">
          {columns.map((c) => {
            const on = visible.includes(c.key);
            return (
              <button key={c.key} type="button" onClick={() => onChange(on ? visible.filter((k) => k !== c.key) : columns.map((x) => x.key).filter((k) => k === c.key || visible.includes(k)))} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-canvas">
                <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-brand-700 bg-brand-700 text-white" : "border-line")}>{on && <Check className="h-3 w-3" />}</span>
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const cellBase = "h-9 w-full min-w-0 rounded-lg border border-transparent bg-transparent px-2 text-[13px] text-ink hover:border-line focus:border-brand-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100";
const changedCls = "!bg-brand-50 !border-brand-200";

export function CellText({ value, onChange, changed, label, type = "text", step, list, disabled }: { value: string | number | null; onChange: (v: string) => void; changed: boolean; label: string; type?: string; step?: number; list?: string; disabled?: boolean }) {
  return <input type={type} step={step} list={list} disabled={disabled} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={cn(cellBase, type === "number" && "text-right tabular-nums", changed && changedCls, disabled && "cursor-not-allowed text-subtle")} aria-label={label} />;
}

export function CellSelect({ value, onChange, options, changed, label, empty }: { value: string | null; onChange: (v: string | null) => void; options: { value: string; label: string }[]; changed: boolean; label: string; empty?: string }) {
  return (
    <select value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={cn(cellBase, "cursor-pointer appearance-none pr-6", changed && changedCls)} aria-label={label}>
      {empty !== undefined && <option value="">{empty}</option>}
      {value && !options.some((o) => o.value === value) && <option value={value}>(current)</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

/** A cell holding a list (ad accounts, Ads Strategists): click to tick items. */
export function CellMulti({ value, onChange, options, changed, label, max }: { value: string[]; onChange: (v: string[]) => void; options: { value: string; label: string }[]; changed: boolean; label: string; max?: number }) {
  const p = usePopover();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const names = value.map((v) => options.find((o) => o.value === v)?.label ?? v);
  // The list is positioned against the viewport so the table's scroll box doesn't clip it; it closes on scroll.
  useEffect(() => {
    if (!p.open) return;
    const close = (e: Event) => {
      if (e.target instanceof Node && p.ref.current?.contains(e.target)) return; // scrolling the list itself
      p.setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div ref={p.ref} className="relative">
      <button
        type="button"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const below = window.innerHeight - r.bottom > 280;
          setPos({ top: below ? r.bottom + 4 : Math.max(8, r.top - 264), left: Math.min(r.left, window.innerWidth - 248) });
          p.setOpen((o) => !o);
        }} className={cn(cellBase, "flex items-center gap-1 text-left", changed && changedCls)} aria-label={label} aria-expanded={p.open}>
        <span className={cn("min-w-0 flex-1 truncate", !names.length && "text-subtle")}>{names.length ? names.join(", ") : "—"}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-subtle" />
      </button>
      {p.open && pos && (
        <div style={{ position: "fixed", top: pos.top, left: pos.left }} className="z-50 max-h-64 w-60 overflow-auto rounded-xl border border-line bg-white p-1.5 shadow-card">
          {options.map((o) => {
            const on = value.includes(o.value);
            const full = !on && max !== undefined && value.length >= max;
            return (
              <button key={o.value} type="button" disabled={full} onClick={() => onChange(on ? value.filter((x) => x !== o.value) : [...value, o.value])} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink hover:bg-canvas disabled:opacity-40">
                <span className={cn("flex h-4 w-4 shrink-0 items-center justify-center rounded border", on ? "border-brand-700 bg-brand-700 text-white" : "border-line")}>{on && <Check className="h-3 w-3" />}</span>
                <span className="truncate">{o.label}</span>
              </button>
            );
          })}
          {max !== undefined && <p className="px-2 pt-1 text-[11.5px] text-muted">Max {max}.</p>}
        </div>
      )}
    </div>
  );
}

/** Remembers the chosen columns per editor in this browser. */
export function useColumns(storageKey: string, defaults: string[]) {
  const [visible, setVisible] = useState(defaults);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved) && saved.length) setVisible(saved);
    } catch {}
  }, [storageKey]);
  const update = (v: string[]) => {
    setVisible(v);
    try {
      localStorage.setItem(storageKey, JSON.stringify(v));
    } catch {}
  };
  return [visible, update] as const;
}
