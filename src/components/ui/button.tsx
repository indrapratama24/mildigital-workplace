import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

const variants = {
  primary: "bg-brand-700 text-white hover:bg-brand-800 shadow-[0_6px_18px_rgba(31,55,166,0.25)]",
  secondary: "bg-white text-ink border border-line hover:border-brand-200 hover:bg-brand-50/50",
  ghost: "text-ink-2 hover:bg-brand-50 hover:text-brand-700",
  subtle: "bg-brand-50 text-brand-700 hover:bg-brand-100",
  danger: "bg-danger text-white hover:bg-[#b3261e]",
  "danger-outline": "border border-danger/30 text-danger bg-white hover:bg-danger-soft",
} as const;
const sizes = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-[15px] gap-2" } as const;

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: keyof typeof sizes;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ className, variant = "primary", size = "md", loading, disabled, children, ...props }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

export function buttonClass(variant: keyof typeof variants = "primary", size: keyof typeof sizes = "md", className?: string) {
  return cn("inline-flex items-center justify-center whitespace-nowrap rounded-full font-medium transition-colors", variants[variant], sizes[size], className);
}
