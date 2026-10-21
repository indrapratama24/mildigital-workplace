"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/cn";

type Group = { label: string; items: { href: string; label: string }[] };

/** Grouped settings navigation: a vertical list on desktop, a grouped select on small screens. */
export function SettingsTabs({ groups }: { groups: Group[] }) {
  const path = usePathname();
  const router = useRouter();
  const current = groups.flatMap((g) => g.items).find((i) => path.startsWith(i.href))?.href ?? "";
  return (
    <>
      <label className="block lg:hidden">
        <span className="sr-only">Settings section</span>
        <select value={current} onChange={(e) => router.push(e.target.value)} className="h-10 w-full rounded-xl border border-line bg-white px-3 text-[14px] text-ink">
          {groups.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.items.map((i) => <option key={i.href} value={i.href}>{i.label}</option>)}
            </optgroup>
          ))}
        </select>
      </label>
      <nav className="hidden space-y-4 lg:block" aria-label="Settings">
        {groups.map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((i) => (
                <Link
                  key={i.href}
                  href={i.href}
                  aria-current={current === i.href ? "page" : undefined}
                  className={cn("block rounded-xl px-3 py-1.5 text-[13.5px] font-medium", current === i.href ? "bg-white text-brand-700 shadow-card" : "text-ink-2 hover:bg-white/70 hover:text-brand-700")}
                >
                  {i.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </nav>
    </>
  );
}
