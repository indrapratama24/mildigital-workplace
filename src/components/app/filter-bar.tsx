"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Tidy GET filter form: a search row, then the dropdowns in an even grid. Changing a dropdown applies it
 * immediately; on phones the dropdowns fold behind a "Filters" button showing how many are active.
 */
export function FilterBar({
  search,
  activeCount,
  resetHref,
  hidden = {},
  right,
  children,
}: {
  search: { name: string; value?: string; placeholder: string };
  activeCount: number;
  resetHref: string;
  /** Extra query params to keep (e.g. month, view). */
  hidden?: Record<string, string | undefined>;
  /** Right side of the search row (e.g. a List / By team switch). */
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const [open, setOpen] = useState(activeCount > 0);
  return (
    <form
      ref={form}
      method="get"
      className="space-y-3 p-4"
      onSubmit={() => {
        // Keep the URL short: blank fields are left out of the query string.
        for (const el of Array.from(form.current?.elements ?? [])) {
          if ((el instanceof HTMLInputElement || el instanceof HTMLSelectElement) && el.name && !el.value) el.disabled = true;
        }
      }}
      onChange={(e) => {
        if ((e.target as HTMLElement).tagName === "SELECT") form.current?.requestSubmit();
      }}
    >
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1 basis-[220px]">
          <span className="sr-only">{search.placeholder}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" aria-hidden />
          <input
            name={search.name}
            defaultValue={search.value}
            placeholder={search.placeholder}
            className="h-10 w-full rounded-xl border border-line bg-white pl-9 pr-3 text-sm text-ink placeholder:text-subtle focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100"
          />
        </label>
        <button type="submit" className="h-10 rounded-xl bg-brand-700 px-4 text-[13.5px] font-medium text-white hover:bg-brand-800">
          Search
        </button>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={cn("inline-flex h-10 items-center gap-1.5 rounded-xl border px-3 text-[13.5px] font-medium sm:hidden", activeCount ? "border-brand-300 bg-brand-50 text-brand-700" : "border-line bg-white text-ink-2")}
        >
          <SlidersHorizontal className="h-4 w-4" /> Filters{activeCount ? ` (${activeCount})` : ""}
        </button>
        {activeCount > 0 && (
          <Link href={resetHref} className="inline-flex h-10 items-center gap-1 rounded-xl px-2.5 text-[13px] font-medium text-muted hover:bg-canvas hover:text-ink">
            <X className="h-3.5 w-3.5" /> Reset
          </Link>
        )}
        {right && <div className="ml-auto">{right}</div>}
      </div>
      <div className={cn("grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))] [&_select]:h-10 [&_select]:w-full", open ? "grid" : "hidden sm:grid")}>{children}</div>
    </form>
  );
}
