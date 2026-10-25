"use client";
// Below lg the side table of contents is hidden, so this bar takes its place: it sticks under the
// top header, shows the section in view and opens a list to jump to another one.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export type JumpGroup = { label?: string; items: { id: string; title: string }[] };

const OFFSET = 136; // header (64) + this bar + breathing room

export function SectionJump({ groups, label }: { groups: JumpGroup[]; label: string }) {
  const items = groups.flatMap((g) => g.items);
  const [current, setCurrent] = useState(items[0]?.id);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const picked = useRef<string | null>(null); // a section chosen near the page end can't scroll to the top

  useEffect(() => {
    const onScroll = () => {
      let at = items[0]?.id;
      for (const it of items) {
        const el = document.getElementById(it.id);
        if (el && el.getBoundingClientRect().top <= OFFSET) at = it.id;
      }
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (!atEnd) picked.current = null;
      setCurrent(atEnd && picked.current ? picked.current : at);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [items.map((i) => i.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (items.length === 0) return null;
  const title = items.find((i) => i.id === current)?.title ?? items[0].title;

  return (
    <div ref={ref} className="sticky top-16 z-10 -mx-4 bg-canvas/90 px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6 lg:hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex h-11 w-full items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-left shadow-sm"
      >
        <span className="shrink-0 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{label}</span>
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">{title}</span>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-subtle transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <nav aria-label={label} className="absolute inset-x-4 top-full mt-1 max-h-[60vh] overflow-y-auto rounded-xl border border-line bg-white p-1.5 shadow-lg sm:inset-x-6">
          {groups.map((g, i) => (
            <div key={i}>
              {g.label && <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</div>}
              {g.items.map((it) => (
                <a
                  key={it.id}
                  href={`#${it.id}`}
                  onClick={() => {
                    picked.current = it.id;
                    setCurrent(it.id);
                    setOpen(false);
                  }}
                  className={cn("flex items-center justify-between rounded-lg px-3 py-2 text-[14px]", it.id === current ? "bg-brand-50 font-medium text-brand-700" : "text-ink-2 hover:bg-canvas")}
                >
                  {it.title}
                  {it.id === current && <Check className="h-4 w-4" />}
                </a>
              ))}
            </div>
          ))}
        </nav>
      )}
    </div>
  );
}
