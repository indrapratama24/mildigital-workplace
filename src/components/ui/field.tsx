import { forwardRef } from "react";
import { cn } from "@/lib/cn";

const control =
  "w-full rounded-xl border border-line bg-white px-3 text-sm text-ink placeholder:text-subtle transition-colors focus:border-brand-400 focus:outline-none focus:ring-4 focus:ring-brand-100 disabled:bg-canvas disabled:text-muted";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(control, "h-10", className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(control, "min-h-[88px] py-2.5", className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(control, "h-10 appearance-none bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2212%22 height=%2212%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%235b6480%22 stroke-width=%222.5%22><path d=%22m6 9 6 6 6-6%22/></svg>')] bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8", className)} {...p}>
      {children}
    </select>
  );
});

export function Field({ label, hint, error, required, children, className, htmlFor }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; required?: boolean; children: React.ReactNode; className?: string; htmlFor?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-2">
        {label}
        {required && <span className="ml-0.5 text-danger" aria-hidden>*</span>}
      </label>
      {children}
      {error ? <p className="text-[12px] text-danger" role="alert">{error}</p> : hint ? <p className="text-[12px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function Checkbox({ label, description, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode; description?: React.ReactNode }) {
  return (
    <label className={cn("flex cursor-pointer items-start gap-2.5 text-sm", className)}>
      <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 rounded border-line accent-brand-700" {...p} />
      <span>
        <span className="text-ink">{label}</span>
        {description && <span className="block text-[12px] text-muted">{description}</span>}
      </span>
    </label>
  );
}
