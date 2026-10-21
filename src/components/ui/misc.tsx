import { cn } from "@/lib/cn";
import type { LucideIcon } from "lucide-react";

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[12px] font-medium uppercase tracking-[0.08em] text-brand-600">{eyebrow}</div>}
        <h1 className="font-display text-[26px] font-bold leading-tight text-ink sm:text-[30px]">{title}</h1>
        {description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }: { icon?: LucideIcon; title: string; description?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-2xl border border-dashed border-line px-6 py-12 text-center", className)}>
      {Icon && (
        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="font-medium text-ink">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, icon: Icon }: { label: string; value: React.ReactNode; hint?: React.ReactNode; tone?: "default" | "brand" | "warning" | "danger" | "success"; icon?: LucideIcon }) {
  const toneClass = { default: "text-ink", brand: "text-brand-700", warning: "text-warning", danger: "text-danger", success: "text-success" }[tone ?? "default"];
  return (
    <div className="rounded-2xl border border-line bg-white p-4 shadow-card">
      <div className="flex items-center justify-between text-[12.5px] font-medium text-muted">
        {label}
        {Icon && <Icon className="h-4 w-4 text-subtle" aria-hidden />}
      </div>
      <div className={cn("mt-2 font-display text-[26px] font-bold leading-none tabular", toneClass)}>{value}</div>
      {hint && <div className="mt-1.5 text-[12px] text-muted">{hint}</div>}
    </div>
  );
}

export function Progress({ value, max, target, className }: { value: number; max: number; target?: number; className?: string }) {
  const pct = max ? Math.min(100, (value / max) * 100) : 0;
  const tpct = target !== undefined && max ? Math.min(100, (target / max) * 100) : undefined;
  return (
    <div className={cn("relative h-2 w-full overflow-hidden rounded-full bg-line-2", className)} role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-700 transition-all" style={{ width: `${pct}%` }} />
      {tpct !== undefined && <div className="absolute top-0 h-full w-0.5 bg-ink/60" style={{ left: `calc(${tpct}% - 1px)` }} aria-hidden />}
    </div>
  );
}

export function Table({ className, ...p }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left text-[13px] [&_td]:border-t [&_td]:border-line-2 [&_td]:px-3 [&_td]:py-2.5 [&_th]:whitespace-nowrap [&_th]:px-3 [&_th]:py-2 [&_th]:text-[12px] [&_th]:font-medium [&_th]:text-muted", className)} {...p} />
    </div>
  );
}

export function Avatar({ name, className, photoId }: { name: string; className?: string; photoId?: string | null }) {
  if (photoId)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={`/api/files/${photoId}?inline=1`} alt="" className={cn("h-8 w-8 shrink-0 rounded-full object-cover", className)} />;
  const initials = name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");
  return (
    <span className={cn("inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-brand-100 to-brand-200 text-[12px] font-semibold text-brand-800", className)} aria-hidden>
      {initials}
    </span>
  );
}

export function Notice({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: React.ReactNode; children?: React.ReactNode; className?: string }) {
  const t = {
    info: "border-brand-100 bg-brand-50/70 text-brand-800",
    warning: "border-[#f6dfa4] bg-warning-soft text-[#7a4d00]",
    danger: "border-[#f6c9c4] bg-danger-soft text-[#8c1d15]",
    success: "border-[#bfe5d0] bg-success-soft text-[#0b6b3d]",
  }[tone];
  return (
    <div className={cn("rounded-xl border px-4 py-3 text-[13px]", t, className)} role={tone === "danger" ? "alert" : "status"}>
      {title && <div className="font-semibold">{title}</div>}
      {children && <div className={cn(title && "mt-0.5")}>{children}</div>}
    </div>
  );
}

/** Overlapping avatars for several people (e.g. Ads Strategists on a client). */
export function AvatarGroup({ people, max = 3, className }: { people: { id: string; name: string; photoId?: string | null }[]; max?: number; className?: string }) {
  if (!people.length) return <span className="text-subtle">—</span>;
  const shown = people.slice(0, max);
  return (
    <span className={cn("inline-flex items-center", className)} title={people.map((p) => p.name).join(", ")}>
      <span className="flex -space-x-2">
        {shown.map((p) => <Avatar key={p.id} name={p.name} photoId={p.photoId} className="h-7 w-7 border-2 border-white text-[10.5px]" />)}
      </span>
      {people.length > max && <span className="ml-1 text-[11.5px] font-medium text-muted">+{people.length - max}</span>}
      <span className="sr-only">{people.map((p) => p.name).join(", ")}</span>
    </span>
  );
}
