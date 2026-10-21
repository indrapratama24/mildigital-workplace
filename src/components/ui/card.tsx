import { cn } from "@/lib/cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-line bg-surface shadow-card", className)} {...p} />;
}
export function CardHeader({ className, title, description, action, children }: { className?: string; title?: React.ReactNode; description?: React.ReactNode; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-5", className)}>
      <div className="min-w-0">
        {title && <h3 className="text-[15px] font-semibold text-ink">{title}</h3>}
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
        {children}
      </div>
      {action}
    </div>
  );
}
export function CardBody({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...p} />;
}
