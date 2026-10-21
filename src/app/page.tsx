import Link from "next/link";
import { ArrowUpRight, CalendarCheck2, CalendarDays, FileClock, Handshake, Home, Building2, ShieldCheck, Sparkles, Users2, BellRing, ScrollText, Check } from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser } from "@/server/auth/session";
import { MilLogo, MilMark, Wordmark } from "@/components/app/brand";
import { Avatar } from "@/components/ui/misc";
import { buttonClass } from "@/components/ui/button";
import { currentMonthJakarta, formatMonth, monthEnd, monthStart, todayJakarta, WEEKDAY_SHORT } from "@/lib/dates";
import { computeRequirement } from "@/lib/engine/working-days";
import { getHolidays } from "@/server/services/calendar";
import { getSettings } from "@/server/services/settings";
import { effectiveOn } from "@/server/services/org";
import { APP_NAME, COMPANY } from "@/lib/brand";

export const dynamic = "force-dynamic";

async function loadLanding() {
  const today = todayJakarta();
  const { year, month } = currentMonthJakarta();
  const [user, activeCount, teamCount, people, levels, settings, holidays] = await Promise.all([
    getCurrentUser(),
    db.employee.count({ where: { isActive: true } }),
    db.team.count({ where: { isActive: true } }),
    db.employee.findMany({ where: { isActive: true }, select: { fullName: true }, take: 4, orderBy: { startDate: "asc" } }),
    db.employeeLevel.findMany({ orderBy: { rank: "asc" }, include: { policy: { include: { versions: { where: effectiveOn(today), orderBy: { version: "desc" }, take: 1 } } } } }),
    getSettings(),
    getHolidays(db, monthStart(year, month), monthEnd(year, month)),
  ]);
  const policies = levels.map((l) => {
    const v = l.policy.versions[0];
    if (!v) return { level: l.name, pct: null as number | null, mandatory: [] as number[], min: null as number | null, eligible: null as number | null };
    const req = computeRequirement({
      year,
      month,
      workingWeekdays: settings.workingWeekdays,
      holidays,
      cutiBersamaIsHoliday: settings.cutiBersamaIsHoliday,
      policy: { wfoPercent: v.wfoPercent, mandatoryWeekdays: v.mandatoryWeekdays, roundingMode: v.roundingMode, excludeLeaveFromDenominator: v.excludeLeaveFromDenominator, offsiteCountsAsWfo: v.offsiteCountsAsWfo },
    });
    return { level: l.name, pct: v.wfoPercent, mandatory: v.mandatoryWeekdays, min: req.effectiveMinimumWfo, eligible: req.eligibleWorkingDays };
  });
  return { user, activeCount, teamCount, people, policies, monthLabel: formatMonth(year, month) };
}

const features = [
  { icon: Building2, title: "Company Hub", body: "Company 101, regulations with acknowledgements, announcements for your team and recognition for great work." },
  { icon: Users2, title: "People & clients", body: "Team directory with privacy controls, and the full client portfolio with packages, assigned consultants and status history." },
  { icon: ScrollText, title: "Policy engine", body: "WFO ratios per level, mandatory collective days, versioned with effective dates so history never shifts." },
  { icon: CalendarDays, title: "Monthly work planner", body: "Click-to-plan calendar with locked mandatory days, holidays, auto-generate and auto-balance." },
  { icon: CalendarCheck2, title: "Leader approvals", body: "Submit once, approve once. Mid-month changes become date-level revisions — never silent overwrites." },
  { icon: Handshake, title: "Leave & delegation", body: "Peer accepts the handover first, then your leader approves. Coverage, tasks and deadlines in one place." },
  { icon: ShieldCheck, title: "Compliance you can trust", body: "Planned, approved and verified attendance are tracked separately — with On Track, At Risk and Shortfall signals." },
  { icon: BellRing, title: "Notifications & audit", body: "In-app alerts for every step and an append-only trail for policies, approvals and corrections." },
];

export default async function HomePage() {
  const { user, activeCount, teamCount, people, policies, monthLabel } = await loadLanding();
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
            ["Features", "#features", false],
            ["How it works", "#how", false],
            ["Policies", "#policies", false],
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
              One place to stay informed and manage work at {COMPANY}: company news and regulations, the people and clients we work with, hybrid work plans, leave and approvals, and internal events.
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
                  <div className="text-[14px] text-muted">{teamCount} teams planning on {APP_NAME} today</div>
                </div>
              </div>
            </div>
          </div>

          {/* visual */}
          <div className="relative mx-auto aspect-square w-full max-w-[560px]">
            <div className="absolute inset-[6%] rounded-full border border-brand-200/70" aria-hidden />
            <div className="absolute inset-[20%] rounded-full bg-[radial-gradient(circle,rgba(79,130,247,0.22),transparent_70%)]" aria-hidden />
            <MilMark className="absolute left-1/2 top-1/2 !w-[60%] -translate-x-1/2 -translate-y-1/2 drop-shadow-[0_30px_50px_rgba(27,60,127,0.22)]" />
            <Chip className="left-[2%] top-[16%] animate-float" icon={<Building2 className="h-4 w-4 text-brand-700" />}>WFO 75% · Junior & Senior</Chip>
            <Chip className="right-[0%] top-[8%] animate-float-delayed" icon={<Home className="h-4 w-4 text-brand-500" />}>Principal & Leaders 50%</Chip>
            <Chip className="bottom-[10%] left-[8%] animate-float-delayed" icon={<Handshake className="h-4 w-4 text-leave" />}>Leave & delegation</Chip>
            <Chip className="bottom-[20%] right-[0%] animate-float" icon={<CalendarCheck2 className="h-4 w-4 text-success" />}>Leader approved</Chip>
          </div>
        </section>

        {/* features */}
        <section id="features" className="mx-auto max-w-[1240px] scroll-mt-8 px-4 py-16 sm:px-8">
          <SectionTitle eyebrow="Features" title="Everything at MIL, in one workplace" body="Built for how MIL Digital actually works: collective office days, flexible weeks, client offsites, fair leave handovers and a growing client portfolio." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-3xl border border-white bg-white/80 p-6 shadow-[0_8px_30px_rgba(31,55,166,0.06)] backdrop-blur">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-700">
                  <f.icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-[18px] font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-muted">{f.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* how it works */}
        <section id="how" className="mx-auto max-w-[1240px] scroll-mt-8 px-4 py-16 sm:px-8">
          <SectionTitle eyebrow="How it works" title="Plan. Approve. Verify." />
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {[
              { n: "01", icon: CalendarDays, title: "Plan your month", body: "Mandatory days are locked in. Auto-generate a balanced plan or click days to switch WFO / WFH while the target meter updates live." },
              { n: "02", icon: Users2, title: "Leader approves", body: "Your leader reviews the plan and requests. Delegated leave goes to your peer first, then to your leader — never the other way round." },
              { n: "03", icon: FileClock, title: "Check in & stay on track", body: "Clock in on office days. Compliance shows planned vs verified attendance, with replacement days suggested before you fall short." },
            ].map((s) => (
              <div key={s.n} className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand-700 to-brand-900 p-7 text-white shadow-[0_16px_40px_rgba(19,34,106,0.25)]">
                <div className="absolute -right-6 -top-10 font-display text-[120px] font-extrabold text-white/[0.06]" aria-hidden>
                  {s.n}
                </div>
                <s.icon className="h-6 w-6 text-brand-200" />
                <h3 className="mt-5 text-[20px] font-bold">{s.title}</h3>
                <p className="mt-2 text-[15px] leading-relaxed text-brand-100/90">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* policies (live) */}
        <section id="policies" className="mx-auto max-w-[1240px] scroll-mt-8 px-4 py-16 sm:px-8">
          <SectionTitle eyebrow="Policies" title={`What ${monthLabel} looks like`} body="Live from the current policy versions and the holiday calendar. Your exact target also accounts for approved leave and offsite duty." />
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {policies.map((p) => (
              <div key={p.level} className="rounded-3xl border border-white bg-white p-6 shadow-[0_8px_30px_rgba(31,55,166,0.06)]">
                <div className="text-[13px] font-medium text-muted">{p.level}</div>
                <div className="mt-3 font-display text-[44px] font-extrabold leading-none tracking-tight text-brand-700">{p.pct ?? "—"}%</div>
                <div className="mt-1 text-[13px] text-muted">minimum WFO</div>
                <div className="mt-5 space-y-2 border-t border-line-2 pt-4 text-[14px]">
                  <div className="flex items-center gap-2 text-ink-2">
                    <Check className="h-4 w-4 text-success" />
                    {p.min ?? "—"} of {p.eligible ?? "—"} working days this month
                  </div>
                  <div className="flex items-center gap-2 text-ink-2">
                    <Check className="h-4 w-4 text-success" />
                    {p.mandatory.length ? `Collective: ${p.mandatory.map((d) => WEEKDAY_SHORT[d]).join(", ")}` : "No mandatory days"}
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-12 flex flex-col items-center gap-4 rounded-3xl bg-white/70 p-8 text-center shadow-[0_8px_30px_rgba(31,55,166,0.06)] backdrop-blur sm:p-12">
            <h2 className="font-display text-[30px] font-extrabold tracking-tight text-ink sm:text-[38px]">Ready to plan next month?</h2>
            <p className="max-w-lg text-muted">Sign in with your {COMPANY} account to see your target, plan your days and submit for approval.</p>
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
        <span>© {new Date().getFullYear()} {COMPANY}. Internal workspace · Asia/Jakarta</span>
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
