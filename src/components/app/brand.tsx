import { cn } from "@/lib/cn";
import { APP_NAME } from "@/lib/brand";

/** MIL Digital mark ("mil" symbol), from the official logo file with the background removed. */
export function MilMark({ className }: { className?: string; gradientId?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mil-mark.png" alt="MIL Digital" width={277} height={172} className={cn("h-auto w-auto select-none", className)} draggable={false} />;
}

/** Full MIL Digital logo (mark + "Digital Marketing Consultant"). */
export function MilLogo({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/mil-logo.png" alt="MIL Digital — Digital Marketing Consultant" width={791} height={172} className={cn("h-auto w-auto select-none", className)} draggable={false} />;
}

export function Wordmark({ className, tone = "dark", id = "wm" }: { className?: string; tone?: "dark" | "light"; id?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span className={cn("font-display text-[22px] font-extrabold tracking-[-0.04em]", tone === "dark" ? "text-ink" : "text-white")}>
        {APP_NAME}
        <span className="text-brand-500">.</span>
      </span>
      <span className={cn("h-6 w-px", tone === "dark" ? "bg-line" : "bg-white/30")} aria-hidden />
      <MilMark className="h-6 w-auto" gradientId={`${id}-${tone}`} />
    </span>
  );
}
