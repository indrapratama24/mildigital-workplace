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

/** "WORKPLACE" logo (image, transparent background) next to the MIL mark. */
export function Wordmark({ className, tone = "dark", id = "wm", compact = false }: { className?: string; tone?: "dark" | "light"; id?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center", compact ? "gap-2" : "gap-2.5", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={tone === "dark" ? "/brand/workplace-logo.png" : "/brand/workplace-logo-light.png"}
        alt={APP_NAME}
        width={1181}
        height={159}
        className={cn("w-auto shrink-0 select-none", compact ? "h-4" : "h-5")}
        draggable={false}
      />
      <span className={cn("w-px", compact ? "h-5" : "h-6", tone === "dark" ? "bg-line" : "bg-white/30")} aria-hidden />
      <MilMark className={cn("w-auto", compact ? "h-5" : "h-6")} gradientId={`${id}-${tone}`} />
    </span>
  );
}
