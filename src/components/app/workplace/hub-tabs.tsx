"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const TABS = [
  { href: "/company", label: "About MIL", exact: true },
  { href: "/company/announcements", label: "Announcements" },
  { href: "/company/regulations", label: "Regulations" },
  { href: "/company/recognition", label: "Recognition" },
];

export function HubTabs() {
  const path = usePathname();
  return (
    <nav className="mb-5 flex gap-1 overflow-x-auto rounded-full border border-line bg-white p-1" aria-label="Company Hub">
      {TABS.map((t) => {
        const active = t.exact ? path === t.href : path.startsWith(t.href);
        return (
          <Link key={t.href} href={t.href} aria-current={active ? "page" : undefined} className={cn("whitespace-nowrap rounded-full px-4 py-1.5 text-[13.5px] font-medium", active ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
