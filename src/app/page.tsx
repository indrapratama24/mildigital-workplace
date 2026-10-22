import Link from "next/link";
import { ArrowUpRight, BookOpenText, Briefcase, Building2, CalendarClock, CalendarDays, Contact, HeartHandshake, Inbox, Lightbulb, Sparkles, TrendingUp } from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { MilLogo, MilMark, Wordmark } from "@/components/app/brand";
import { Avatar } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { APP_NAME, COMPANY } from "@/lib/brand";

export const dynamic = "force-dynamic";

async function loadLanding() {
  const [user, activeCount, teamCount, people] = await Promise.all([
    getCurrentUser(),
    db.employee.count({ where: { isActive: true } }),
    db.team.count({ where: { isActive: true } }),
    db.employee.findMany({ where: { isActive: true }, select: { fullName: true }, take: 4, orderBy: { startDate: "asc" } }),
  ]);
  return { user, activeCount, teamCount, people };
}

const principles = [
  {
    icon: Lightbulb,
    title: "Insightful",
    body: "We look past the obvious. Curiosity and data turn every brief, campaign and conversation into insight our clients and teammates can act on.",
  },
  {
    icon: HeartHandshake,
    title: "Companionship",
    body: "We grow together — with our clients as partners, and with each other as one team that shares knowledge, covers for one another and celebrates wins.",
  },
  {
    icon: TrendingUp,
    title: "Continuous Improvement",
    body: "Every day is a chance to do a little better. We learn, reflect, share what works and keep raising the bar for our work and ourselves.",
  },
];

const modules = [
  { icon: Building2, title: "Company Hub", body: "Who we are and how we work: Company 101, regulations, announcements and recognition for great work." },
  { icon: Contact, title: "Team Directory", body: "Find the right person fast — teams, leaders, contacts and who's out today, with privacy built in." },
  { icon: Briefcase, title: "Client & Portfolio", body: "Every brand we work with, its package, assigned team and collaboration history in one place." },
  { icon: CalendarDays, title: "My Work Calendar", body: "Plan where you work each month, check in, and keep your schedule and your leader in sync." },
  { icon: CalendarClock, title: "Internal Calendar", body: "Learning & development sessions, team meetings and company events — with reminders." },
  { icon: Inbox, title: "Requests & Approvals", body: "Leave and permissions with handovers to teammates and clear approvals, all tracked." },
];

export default async function HomePage() {
  const { user, activeCount, teamCount, people } = await loadLanding();
  const cta = user ? { href: "/overview", label: `Open ${APP_NAME}` } : { href: "/login", label: `Sign in to ${APP_NAME}` };

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-[#f6f8fd]">
      {/* backdrop */}
      <div className="pointer-events-none absolute inset-0 bg-grid [mask-image:linear-gradient(to_bottom,black,black_55%,transparent)]" aria-hidden />
      <div className="pointer-events-none absolute -left-40 -top-40 h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,rgba(79,130,247,0.18),transparent_65%)]" aria-hidden />
      <div className="pointer-events-none absolute right-[-120px] top-[120px] h-[640px] w-[640px] rounded-full bg-[radial-gradient(circle,rgba(31,99,238,0.16),transparent_62%)]" aria-hidden />

      {/* nav */}
      <header className="relative z-10 mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <Link href="/" aria-label={`${APP_NAME} home`}>
          <Wordmark />
        </Link>
        <nav className="hidden items-center gap-1 rounded-full border border-white bg-white/80 p-1.5 shadow-[0_4px_24px_rgba(31,55,166,0.08)] backdrop-blur md:flex" aria-label="Primary">
          {[
            ["Home", "#top", true],
            ["Our principles", "#principles", false],
            ["What's inside", "#inside", false],
          ].map(([label, href, active]) => (
            <a key={String(label)} href={String(href)} className={active ? "rounded-full bg-brand-700 px-5 py-2 text-[15px] font-medium text-white" : "rounded-full px-5 py-2 text-[15px] font-medium text-ink-2 hover:text-brand-700"}>
              {label}
            </a>
          ))}
        </nav>
        <Link href={cta.href} className="group inline-flex items-center gap-3 rounded-full bg-brand-700 py-1.5 pl-5 pr-1.5 text-[15px] font-medium text-white shadow-[0_8px_24px_rgba(31,55,166,0.28)] hover:bg-brand-800">
          {user ? "Workspace" : "Sign in"}
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-700 transition-transform group-hover:rotate-45">
            <ArrowUpRight className="h-4 w-4" />
          </span>
        </Link>
      </header>

      {/* hero */}
      <main id="top" className="relative z-10">
        <section className="mx-auto grid max-w-[1240px] items-center gap-12 px-4 pb-20 pt-10 sm:px-8 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white bg-white/70 px-3 py-1 text-[13px] font-medium text-brand-700 shadow-sm backdrop-blur">
              <Sparkles className="h-3.5 w-3.5" /> {COMPANY} Workplace
            </div>
            <h1 className="font-display text-[48px] font-extrabold leading-[0.98] tracking-[-0.045em] text-ink sm:text-[68px] lg:text-[80px]">
              Work, learn
              <br />
              <span className="text-brand-700">and grow together.</span>
            </h1>
            <p className="mt-7 max-w-[560px] text-[17px] leading-relaxed text-muted sm:text-[19px]">
              One place to stay informed and get work done at {COMPANY} — the company, the people and the clients we work with, our calendars, requests and everything in between.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-6">
              <Link href={cta.href} className="group inline-flex items-center gap-4 rounded-full bg-brand-700 py-2 pl-8 pr-2 text-[17px] font-semibold text-white shadow-[0_12px_32px_rgba(31,55,166,0.3)] hover:bg-brand-800">
                {cta.label}
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-brand-700 transition-transform group-hover:rotate-45">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
              </Link>
              <div className="flex items-center gap-4">
                <div className="flex -space-x-3">
                  {people.map((p) => (
                    <Avatar key={p.fullName} name={p.fullName} className="h-11 w-11 border-[3px] border-white text-[13px] shadow-sm" />
                  ))}
                </div>
                <div>
                  <div className="font-display text-[17px] font-bold text-ink">{activeCount} teammates</div>
                  <div className="text-[14px] text-muted">{teamCount} teams, one {COMPANY}</div>
                </div>
              </div>
            </div>
          </div>

          {/* visual */}
          <div className="relative mx-auto aspect-square w-full max-w-[560px]">
            <div className="absolute inset-[6%] rounded-full border border-brand-200/70" aria-hidden />
            <div className="absolute inset-[20%] rounded-full bg-[radial-gradient(circle,rgba(79,130,247,0.22),transparent_70%)]" aria-hidden />
            <MilMark className="absolute left-1/2 top-1/2 !w-[60%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_30px_50px_rgba(27,60,127,0.22)]" />
            <Chip className="left-[2%] top-[16%] animate-float" icon={<Lightbulb className="h-4 w-4 text-brand-700" />}>Insightful</Chip>
            <Chip className="right-[0%] top-[8%] animate-float-delayed" icon={<HeartHandshake className="h-4 w-4 text-brand-500" />}>Companionship</Chip>
            <Chip className="bottom-[10%] left-[4%] animate-float-delayed" icon={<TrendingUp className="h-4 w-4 text-success" />}>Continuous Improvement</Chip>
            <Chip className="bottom-[22%] right-[0%] animate-float" icon={<BookOpenText className="h-4 w-4 text-leave" />}>Learn together</Chip>
          </div>
        </section>

        {/* principles */}
        <section id="principles" className="mx-auto max-w-[1240px] scroll-mt-8 px-4 py-16 sm:px-8">
          <SectionTitle eyebrow="Our principles" title="How we work at MIL Digital" body="Three principles guide how we serve our clients and how we treat each other — and they shape this workplace too." />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {principles.map((p, i) => (
              <div key={p.title} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-7 text-white shadow-[0_16px_40px_rgba(19,34,106,0.25)]">
                <div className="absolute -right-6 -top-10 font-display text-[120px] font-extrabold text-white/[0.06]" aria-hidden>
                  0{i + 1}
                </div>
                <p.icon className="h-6 w-6 text-brand-200" />
                <h3 className="mt-5 text-[22px] font-bold">{p.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-brand-100/90">{p.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* what's inside */}
        <section id="inside" className="mx-auto max-w-[1240px] scroll-mt-8 px-4 py-16 sm:px-8">
          <SectionTitle eyebrow="What's inside" title="Everything at MIL, in one workplace" body="Built for how MIL Digital works every day — from knowing who's who to planning your week." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {modules.map((f) => (
              <div key={f.title} className="rounded-3xl border border-white bg-white/80 p-6 shadow-[0_8px_30px_rgba(31,55,166,0.06)] backdrop-blur">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-[18px] font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center gap-4 rounded-3xl bg-white/70 p-8 text-center shadow-[0_8px_30px_rgba(31,55,166,0.06)] backdrop-blur sm:p-12">
            <h2 className="font-display text-[30px] font-extrabold tracking-tight text-ink sm:text-[38px]">Grow together, every day.</h2>
            <p className="max-w-lg text-muted">Sign in with your {COMPANY} account to catch up on what's new, find your teammates and get your work done.</p>
            <Link href={cta.href} className={buttonClass("primary", "lg", "mt-2 gap-3 pr-2")}>
              {cta.label}
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-brand-700">
                <ArrowUpRight className="h-4 w-4" />
              </span>
            </Link>
          </div>
        </section>
      </main>

      <footer className="relative z-10 mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-4 border-t border-line px-4 py-8 text-[13px] text-muted sm:px-8">
        <MilLogo className="!h-9" />
        <span>© {new Date().getFullYear()} {COMPANY}. Insightful · Companionship · Continuous Improvement</span>
      </footer>
    </div>
  );
}

function Chip({ className, icon, children }: { className?: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={`absolute z-10 inline-flex items-center gap-2 rounded-full border border-white bg-white/90 px-4 py-2.5 text-[14px] font-semibold text-ink shadow-chip backdrop-blur sm:text-[15px] ${className ?? ""}`}>
      {icon}
      {children}
    </div>
  );
}

function SectionTitle({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="max-w-2xl">
      <div className="text-[13px] font-semibold uppercase tracking-[0.12em] text-brand-600">{eyebrow}</div>
      <h2 className="mt-3 font-display text-[34px] font-extrabold leading-[1.05] tracking-[-0.035em] text-ink sm:text-[46px]">{title}</h2>
      {body && <p className="mt-4 text-[16px] leading-relaxed text-muted">{body}</p>}
    </div>
  );
}
