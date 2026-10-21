import Link from "next/link";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "@/components/ui/button";

export function RequestTabs({ active, approvals, delegations, showAll }: { active: "mine" | "approvals" | "delegations" | "all"; approvals: number; delegations: number; showAll?: boolean }) {
  const tabs = [
    { key: "mine", href: "/requests", label: "My requests" },
    { key: "approvals", href: "/approvals", label: "Approvals", count: approvals },
    { key: "delegations", href: "/approvals?tab=delegations", label: "Delegations", count: delegations },
    ...(showAll ? [{ key: "all", href: "/approvals?tab=all", label: "All pending" }] : []),
  ] as { key: string; href: string; label: string; count?: number }[];
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1 rounded-full border border-line bg-white p-1" role="tablist">
        {tabs.map((t) => (
          <Link key={t.key} href={t.href} role="tab" aria-selected={active === t.key} className={cn("flex items-center gap-1.5 rounded-full px-4 py-1.5 text-[13.5px] font-medium", active === t.key ? "bg-brand-700 text-white" : "text-ink-2 hover:text-brand-700")}>
            {t.label}
            {!!t.count && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold leading-5", active === t.key ? "bg-white text-brand-700" : "bg-pending text-white")}>{t.count}</span>}
          </Link>
        ))}
      </div>
      <Link href="/requests/new" className={buttonClass("primary", "md")}>
        <Plus className="h-4 w-4" /> New request
      </Link>
    </div>
  );
}
