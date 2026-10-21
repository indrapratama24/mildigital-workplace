import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/session";
import { MilLogo, Wordmark } from "@/components/app/brand";
import { LoginForm } from "./login-form";
import { APP_NAME, COMPANY } from "@/lib/brand";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getCurrentUser()) redirect("/overview");
  const { next } = await searchParams;
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#f6f8fd] px-4 py-10">
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:radial-gradient(ellipse_at_center,black,transparent_75%)]" aria-hidden />
      <div className="pointer-events-none absolute right-[-160px] top-[-120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,rgba(31,99,238,0.18),transparent_62%)]" aria-hidden />
      <div className="relative w-full max-w-[420px]">
        <Link href="/" className="mb-8 flex justify-center">
          <Wordmark />
        </Link>
        <div className="rounded-3xl border border-white bg-white/90 p-7 shadow-[0_20px_60px_rgba(31,55,166,0.12)] backdrop-blur sm:p-8">
          <h1 className="font-display text-[26px] font-bold tracking-tight text-ink">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use your {COMPANY} work email to access {APP_NAME}.</p>
          <LoginForm next={next} />
        </div>
        <p className="mt-6 text-center text-[12.5px] text-muted">Trouble signing in? Contact People Operations.</p>
        <div className="mt-8 flex justify-center opacity-90">
          <MilLogo className="!h-8" />
        </div>
      </div>
    </div>
  );
}
