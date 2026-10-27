"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import * as D from "@radix-ui/react-dialog";
import { ChevronDown, ExternalLink, Menu, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { featureStatus } from "@/lib/features";
import { NAV_GROUPS, type NavItem } from "./nav";
import { Wordmark } from "./brand";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface SidebarProps {
  allowed: string[];
  badges: { approvals: number };
  knowledgeHubUrl: string | null;
  knowledgeHubName: string;
}

const GROUPS_KEY = "mil.nav.collapsedGroups";
/** Hidden when the desktop rail is collapsed (data-sidebar=collapsed on the app frame). */
const railHidden = "lg:group-data-[sidebar=collapsed]/frame:hidden";

export function SidebarNav({ allowed, badges, knowledgeHubUrl, knowledgeHubName, onNavigate, rail = true }: SidebarProps & { onNavigate?: () => void; rail?: boolean }) {
  const pathname = usePathname();
  const [closed, setClosed] = useState<string[]>([]);
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    try {
      setClosed(JSON.parse(localStorage.getItem(GROUPS_KEY) ?? "[]"));
    } catch {
      /* storage unavailable */
    }
  }, []);
  const toggle = (id: string) =>
    setClosed((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  const hide = rail ? railHidden : "";

  const itemClass = (active: boolean) =>
    cn(
      "group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium transition-colors",
      rail && "lg:group-data-[sidebar=collapsed]/frame:justify-center lg:group-data-[sidebar=collapsed]/frame:px-0",
      active ? "bg-brand-700 text-white shadow-[0_6px_16px_rgba(31,55,166,0.25)]" : "text-ink-2 hover:bg-white hover:text-brand-700",
    );

  const render = (item: NavItem) => {
    const n = item.id === "knowledge" ? { ...item, label: knowledgeHubName } : item;
    const status = n.feature ? featureStatus(n.feature) : "enabled";
    const Icon = n.icon;
    if (status === "coming_soon") {
      return (
        <div key={n.id} aria-disabled="true" title={`${n.label} — coming soon`} className={cn(itemClass(false), "cursor-default text-subtle hover:bg-transparent hover:text-subtle")}>
          <Icon className="h-[18px] w-[18px] shrink-0 text-line" aria-hidden />
          <span className={cn("flex-1 truncate", hide)}>{n.label}</span>
          <span className={cn("rounded-full bg-line-2 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted", hide)}>Soon</span>
        </div>
      );
    }
    if (status === "external") {
      const content = (
        <>
          <Icon className="h-[18px] w-[18px] shrink-0 text-subtle group-hover:text-brand-600" aria-hidden />
          <span className={cn("line-clamp-2 flex-1 text-balance text-left leading-snug", hide)}>{n.label}</span>
          <ExternalLink className={cn("h-3.5 w-3.5 text-subtle", hide)} aria-hidden />
        </>
      );
      return knowledgeHubUrl ? (
        <a key={n.id} href={knowledgeHubUrl} target="_blank" rel="noopener noreferrer" title={`${n.label} (opens in a new tab)`} className={itemClass(false)} onClick={onNavigate}>
          {content}
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      ) : (
        <button key={n.id} type="button" title={n.label} className={itemClass(false)} onClick={() => setKbOpen(true)}>
          {content}
        </button>
      );
    }
    if (!n.href || !allowed.includes(n.id)) return null;
    const active = (n.match ?? [n.href]).some((m) => pathname === m || pathname.startsWith(`${m}/`));
    const badge = n.badgeKey ? badges[n.badgeKey] : 0;
    return (
      <Link key={n.id} href={n.href} onClick={onNavigate} aria-current={active ? "page" : undefined} title={n.label} className={cn(itemClass(active), "relative")}>
        <Icon className={cn("h-[18px] w-[18px] shrink-0", active ? "text-white" : "text-subtle group-hover:text-brand-600")} aria-hidden />
        <span className={cn("flex-1 truncate", hide)}>{n.label}</span>
        {badge > 0 && (
          <span
            className={cn(
              "min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5",
              rail && "lg:group-data-[sidebar=collapsed]/frame:absolute lg:group-data-[sidebar=collapsed]/frame:right-1 lg:group-data-[sidebar=collapsed]/frame:top-0.5 lg:group-data-[sidebar=collapsed]/frame:min-w-4 lg:group-data-[sidebar=collapsed]/frame:text-[10px] lg:group-data-[sidebar=collapsed]/frame:leading-4",
              active ? "bg-white text-brand-700" : "bg-pending text-white",
            )}
          >
            {badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className="space-y-4" aria-label="Main">
      {NAV_GROUPS.map((g) => {
        const items = g.items.map(render).filter(Boolean);
        if (!items.length) return null;
        const isClosed = closed.includes(g.id) && !g.items.some((n) => n.href && pathname.startsWith(n.href));
        return (
          <div key={g.id}>
            <button
              type="button"
              onClick={() => toggle(g.id)}
              aria-expanded={!isClosed}
              className={cn("mb-1 flex w-full items-center justify-between px-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-subtle hover:text-ink-2", hide)}
            >
              {g.label}
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isClosed && "-rotate-90")} aria-hidden />
            </button>
            {rail && <div className="mx-auto mb-1 hidden h-px w-8 bg-line lg:group-data-[sidebar=collapsed]/frame:block" aria-hidden />}
            <div className={cn("space-y-0.5", isClosed && "hidden", rail && isClosed && "lg:group-data-[sidebar=collapsed]/frame:block")}>{items}</div>
          </div>
        );
      })}
      <Dialog
        open={kbOpen}
        onOpenChange={setKbOpen}
        title={`${knowledgeHubName} is in development`}
        description="MIL Academy, our learning platform, is still being built. The link will appear here as soon as an administrator configures it in Settings → Platform."
        footer={<Button onClick={() => setKbOpen(false)}>Got it</Button>}
      />
    </nav>
  );
}

/** Desktop rail toggle. The state lives on the app frame (data-sidebar) and in a cookie, so the server renders the right width. */
export function SidebarToggle() {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    setCollapsed(document.getElementById("app-frame")?.dataset.sidebar === "collapsed");
  }, []);
  const flip = () => {
    const next = !collapsed;
    setCollapsed(next);
    const frame = document.getElementById("app-frame");
    if (frame) frame.dataset.sidebar = next ? "collapsed" : "expanded";
    document.cookie = `mil_sidebar=${next ? "collapsed" : "expanded"}; path=/; max-age=31536000; samesite=lax`;
  };
  const Icon = collapsed ? PanelLeftOpen : PanelLeftClose;
  return (
    <button type="button" onClick={flip} className="hidden rounded-full p-2 text-ink-2 hover:bg-white hover:text-brand-700 lg:inline-flex" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
      <Icon className="h-5 w-5" aria-hidden />
    </button>
  );
}

export function MobileNav(props: SidebarProps) {
  const [open, setOpen] = useState(false);
  return (
    <D.Root open={open} onOpenChange={setOpen}>
      <D.Trigger className="rounded-full p-2 text-ink-2 hover:bg-white lg:hidden" aria-label="Open menu">
        <Menu className="h-5 w-5" />
      </D.Trigger>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30 lg:hidden" />
        <D.Content className="fixed inset-y-0 left-0 z-50 w-[280px] overflow-y-auto bg-canvas p-4 shadow-pop lg:hidden">
          <D.Title className="sr-only">Menu</D.Title>
          <D.Description className="sr-only">Main navigation</D.Description>
          <div className="mb-6 flex items-center justify-between">
            <Wordmark id="drawer" />
            <D.Close className="rounded-full p-1.5 hover:bg-white" aria-label="Close menu">
              <X className="h-5 w-5" />
            </D.Close>
          </div>
          <SidebarNav {...props} rail={false} onNavigate={() => setOpen(false)} />
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
