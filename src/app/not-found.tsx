import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <div className="font-display text-[64px] font-extrabold text-brand-700">404</div>
      <p className="text-muted">This page doesn&apos;t exist or you don&apos;t have access.</p>
      <Link href="/overview" className={buttonClass("primary")}>Back to overview</Link>
    </div>
  );
}
