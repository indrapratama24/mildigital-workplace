// Landing page (/), built from the OpenDesign homepage export (styles in ./landing.css, behaviour in
// LandingEffects). The hero card shows the signed-in person's real week; visitors see an illustrative one.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Briefcase,
  Building2,
  Calendar,
  CalendarClock,
  Contact,
  HeartHandshake,
  Inbox,
  Info,
  Lightbulb,
  Menu,
  MessagesSquare,
  Target,
  TrendingUp,
  X,
} from "lucide-react";
import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth/session";
import { getPlannerData } from "@/server/services/schedules";
import { eventsForEmployee } from "@/server/services/events";
import { announcementsFor } from "@/server/services/workplace";
import { inboxFor } from "@/server/services/approvals";
import { addDays, formatDate, todayJakarta, toISO, utcToJakarta } from "@/lib/dates";
import { LandingEffects } from "@/components/landing/landing-effects";
import "./landing.css";

export const dynamic = "force-dynamic";

const I = ({ icon: Icon, className = "od-icon" }: { icon: LucideIcon; className?: string }) => <Icon className={className} aria-hidden strokeWidth={2} />;

const MODULES: { icon: LucideIcon; title: string; body: string; live: boolean }[] = [
  { icon: Building2, title: "Company Hub", body: "Who we are and how we work: Company 101, regulations, announcements and recognition for great work.", live: true },
  { icon: Contact, title: "Team Directory", body: "Find the right person fast — teams, leaders, contacts and who’s out today, with privacy built in.", live: true },
  { icon: Briefcase, title: "Client & Portfolio", body: "Every brand we work with, its package, assigned team and collaboration history in one place.", live: true },
  { icon: CalendarClock, title: "My Work Calendar", body: "Plan where you work each month, check in, and keep your schedule and your leader in sync.", live: true },
  { icon: Calendar, title: "Internal Calendar", body: "Learning & development sessions, team meetings and company events — with reminders.", live: true },
  { icon: Inbox, title: "Requests & Approvals", body: "Leave and permissions with handovers to teammates and clear approvals, all tracked.", live: true },
  { icon: Target, title: "Performance & Growth", body: "Company direction, OKRs, KPIs, and individual development in one shared view.", live: false },
  { icon: MessagesSquare, title: "Collaboration Hub", body: "Meeting notes, decisions, action items, and cross-team collaboration in one place.", live: false },
];

const OBJECTIVES: [string, string][] = [
  ["Centralize information", "A single source of truth for company information, policies, people, clients, and organizational knowledge."],
  ["Streamline operations", "Simpler everyday workflows: work planning, attendance, leave requests, approvals, and admin."],
  ["Strengthen alignment & collaboration", "Connect people to company priorities, internal activities, shared responsibilities, cross-team collaboration, and team objectives."],
  ["Enable continuous development", "Learning resources, career development, company knowledge, and performance management."],
  ["Improve visibility & accountability", "Make responsibilities, progress, decisions, and operational performance more visible and measurable."],
];

const PRINCIPLES: [LucideIcon, string, string][] = [
  [Lightbulb, "Insightful", "We look past the obvious. Curiosity and data turn every brief, campaign, and conversation into insight our clients and teammates can act on."],
  [HeartHandshake, "Companionship", "We grow together — with our clients as partners, and with each other as one team that shares knowledge, covers for one another, and celebrates wins."],
  [TrendingUp, "Continuous Improvement", "Every day is a chance to do a little better. We learn, reflect, share what works, and keep raising the bar for our work and ourselves."],
];

const VALUES: [string, string, string][] = [
  ["A", "Attention", "Be attentive to details, people, and opportunities that matter."],
  ["C", "Care", "Genuinely care about our clients, teammates, and the impact of our work."],
  ["T", "Tailored Strategy & Execution", "Think critically and deliver solutions that fit real business needs."],
  ["F", "Friendly", "Build positive, approachable, and supportive relationships."],
  ["A", "Agile", "Stay adaptable, proactive, and responsive to change."],
  ["S", "Structured & Accountable", "Work with clarity, discipline, and ownership."],
  ["T", "Trustworthy", "Earn trust through integrity, consistency, and reliability."],
];

const NAV: [string, string][] = [
  ["platform", "The platform"],
  ["who", "Who we are"],
  ["how", "How we work"],
  ["vision", "Vision"],
];

const LOCATION: Record<string, string> = { IN_OFFICE: "In office", ONLINE: "Online", HYBRID: "Hybrid", EXTERNAL: "External" };
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

type WeekDay = { dow: string; label: string; tone: "wfo" | "wfh" | "leave" | "off" };
interface Preview {
  live: boolean;
  hello: string | null;
  agenda: { time: string; title: string; meta: string }[];
  note: { label: string; title: string; sub: string } | null;
  week: WeekDay[];
  waiting: number;
}

const ILLUSTRATIVE: Preview = {
  live: false,
  hello: null,
  agenda: [
    { time: "09:30", title: "Team stand-up", meta: "Team · 30 min" },
    { time: "13:00", title: "Client review", meta: "Client & Portfolio" },
  ],
  note: { label: "Announcement", title: "Town hall — Friday, 16:00", sub: "Company update and live Q&A." },
  week: [
    { dow: "Mon", label: "WFO", tone: "wfo" },
    { dow: "Tue", label: "WFH", tone: "wfh" },
    { dow: "Wed", label: "WFO", tone: "wfo" },
    { dow: "Thu", label: "WFO", tone: "wfo" },
    { dow: "Fri", label: "WFH", tone: "wfh" },
  ],
  waiting: 2,
};

/** The signed-in person's real week: today's events, the latest announcement, their Mon–Fri plan and approvals waiting. */
async function livePreview(me: CurrentUser): Promise<Preview> {
  const today = todayJakarta();
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
  const monday = addDays(today, dow === 0 ? 1 : dow === 6 ? 2 : 1 - dow); // on weekends, show the coming week
  const dates = [0, 1, 2, 3, 4].map((i) => addDays(monday, i));
  const months = [...new Set(dates.map((d) => d.slice(0, 7)))];
  const [plans, events, news, inbox] = await Promise.all([
    Promise.all(months.map((m) => getPlannerData(me, me.employeeId, Number(m.slice(0, 4)), Number(m.slice(5, 7))).catch(() => null))),
    eventsForEmployee(me.employeeId, today, today),
    announcementsFor(me.employeeId, { take: 1 }),
    inboxFor(me.employeeId, ["LEADER", "HR", "FINAL", "DELEGATE"]),
  ]);
  const days = new Map(plans.flatMap((p) => p?.days ?? []).map((d) => [d.date, d]));
  const week = dates.map((date): WeekDay => {
    const d = days.get(date);
    const name = DOW[new Date(`${date}T00:00:00Z`).getUTCDay()];
    if (!d) return { dow: name, label: "—", tone: "off" };
    if (d.leave) return { dow: name, label: "Leave", tone: "leave" };
    if (d.kind === "HOLIDAY") return { dow: name, label: "Holiday", tone: "off" };
    const mode = d.approved ?? d.planned;
    if (mode === "WFO") return { dow: name, label: "WFO", tone: "wfo" };
    if (mode === "WFH") return { dow: name, label: "WFH", tone: "wfh" };
    return { dow: name, label: d.offsiteLabel ? "Offsite" : "—", tone: "off" };
  });
  const a = news[0];
  return {
    live: true,
    hello: me.fullName.split(/\s+/)[0] ?? null,
    agenda: events.slice(0, 2).map((e) => ({
      time: utcToJakarta(e.startAt).time,
      title: e.title,
      meta: [e.category.name, LOCATION[e.locationType]].filter(Boolean).join(" · "),
    })),
    note: a ? { label: "Announcement", title: a.title, sub: `${a.category} · ${formatDate(toISO(a.publishAt))}` } : null,
    week,
    waiting: inbox.length,
  };
}

function Logo() {
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-workplace" src="/brand/workplace-logo.png" width={1181} height={159} alt="" draggable={false} />
      <span className="logo-divider" aria-hidden />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="logo-mark" src="/brand/mil-mark.png" width={277} height={172} alt="" draggable={false} />
    </>
  );
}

const BtnIcon = () => (
  <span className="btn-icon" aria-hidden>
    <I icon={ArrowUpRight} />
  </span>
);

export default async function HomePage() {
  const user = await getCurrentUser();
  const [activeCount, teamCount, people, preview] = await Promise.all([
    db.employee.count({ where: { isActive: true } }),
    db.team.count({ where: { isActive: true } }),
    db.employee.findMany({ where: { isActive: true }, select: { fullName: true }, take: 4, orderBy: { startDate: "asc" } }),
    user ? livePreview(user).catch(() => ILLUSTRATIVE) : Promise.resolve(ILLUSTRATIVE),
  ]);
  const cta = user ? { href: "/overview", short: "Open WORKPLACE", long: "Open WORKPLACE" } : { href: "/login", short: "Sign in", long: "Sign in to WORKPLACE" };
  const liveCount = MODULES.filter((m) => m.live).length;

  return (
    <div className="lp">
      <LandingEffects />
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header" id="site-header">
        <div className="wrap header-inner">
          <a className="logo-lockup" href="#top" aria-label="WORKPLACE by MIL Digital — home">
            <Logo />
          </a>
          <nav className="primary-nav" aria-label="Primary">
            {NAV.map(([id, label]) => (
              <a key={id} href={`#${id}`} data-spy={id}>
                {label}
              </a>
            ))}
          </nav>
          <div className="header-actions">
            <Link className="btn btn-sm header-cta" href={cta.href}>
              {cta.short}
              <BtnIcon />
            </Link>
            <button className="menu-toggle" type="button" aria-expanded="false" aria-controls="mobileNav" aria-label="Open menu">
              <I icon={Menu} className="od-icon icon-menu" />
              <I icon={X} className="od-icon icon-close" />
            </button>
          </div>
        </div>
      </header>

      <div className="mobile-nav" id="mobileNav" hidden>
        <nav aria-label="Mobile">
          {NAV.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label} <I icon={ArrowRight} />
            </a>
          ))}
          <Link className="btn" href={cta.href}>
            {cta.long}
            <BtnIcon />
          </Link>
        </nav>
      </div>

      <main id="main" tabIndex={-1}>
        <section className="hero" id="top" aria-labelledby="hero-title">
          <div className="hero-bg" aria-hidden />
          <div className="hero-glow" aria-hidden />
          <div className="wrap hero-inner">
            <div className="hero-copy">
              <span className="badge">
                <span className="badge-dot" aria-hidden />
                MIL Digital · Workplace
              </span>
              <h1 id="hero-title">
                Work, learn
                <br />
                <span>and grow together.</span>
              </h1>
              <p className="hero-lead">One place to stay informed, manage work, keep learning, and grow together — the company, the people, the clients, and everything in between.</p>
              <div className="hero-actions">
                <Link className="btn btn-lg" href={cta.href}>
                  Open WORKPLACE
                  <BtnIcon />
                </Link>
                <a className="text-link" href="#platform">
                  Explore the platform <I icon={ArrowDown} />
                </a>
              </div>
              <div className="hero-proof">
                <div className="proof-avatars" aria-hidden>
                  {people.map((p) => (
                    <span key={p.fullName}>{initials(p.fullName)}</span>
                  ))}
                </div>
                <div className="od-stat">
                  <span className="proof-strong od-nowrap">{activeCount} teammates</span>
                  <span className="proof-sub">{teamCount} teams, one MIL Digital</span>
                </div>
              </div>
            </div>

            <aside className="hero-preview" aria-label={preview.live ? "Your week in WORKPLACE" : "Illustrative preview of a week inside the workplace"}>
              <div className="preview-shell">
                <div className="preview-card">
                  <div className="preview-bar">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="preview-logo" src="/brand/workplace-logo.png" width={1181} height={159} alt="WORKPLACE" />
                    <span className="preview-badge">
                      {liveCount} live · {MODULES.length - liveCount} next
                    </span>
                  </div>
                  <div className="preview-body">
                    <div className="preview-head">
                      <div className="od-stack">
                        <span className="preview-kicker">This week at MIL</span>
                        <p className="preview-title">
                          {preview.hello ? (
                            <>
                              <span className="preview-hello">Hi {preview.hello},</span> your week at a glance.
                            </>
                          ) : (
                            "Your week, at a glance."
                          )}
                        </p>
                      </div>
                    </div>
                    <span className="preview-label">Today</span>
                    {preview.agenda.length === 0 && <p className="preview-empty">Nothing on your Internal Calendar today.</p>}
                    {preview.agenda.map((a, i) => (
                      <div key={i} className="agenda-row">
                        <span className="agenda-time od-nowrap">{a.time}</span>
                        <div className="od-stack">
                          <span className="agenda-title od-truncate">{a.title}</span>
                          <span className="agenda-meta">{a.meta}</span>
                        </div>
                      </div>
                    ))}
                    {preview.note && (
                      <div className="preview-note">
                        <span className="preview-note-label">{preview.note.label}</span>
                        <strong className="od-clamp-2">{preview.note.title}</strong>
                        <span>{preview.note.sub}</span>
                      </div>
                    )}
                    <span className="preview-label">Your week</span>
                    <div className="preview-week">
                      {preview.week.map((d) => (
                        <div key={d.dow} className="od-cell">
                          <span className="dow">{d.dow}</span>
                          <span className={`week-status st-${d.tone}`}>{d.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {preview.live ? (
                    <Link href="/approvals" className="preview-foot" style={{ textDecoration: "none" }}>
                      <span>Requests &amp; approvals</span>
                      <strong>{preview.waiting ? `${preview.waiting} waiting` : "All clear"}</strong>
                    </Link>
                  ) : (
                    <div className="preview-foot">
                      <span>Requests &amp; approvals</span>
                      <strong>{preview.waiting} waiting</strong>
                    </div>
                  )}
                </div>
              </div>
              <p className="preview-caption">{preview.live ? "Live from your WORKPLACE" : "Illustrative preview · Sign in to see your own week"}</p>
            </aside>
          </div>
        </section>

        <section className="section platform" id="platform" aria-labelledby="platform-title">
          <div className="wrap">
            <div className="section-head split reveal">
              <div>
                <span className="eyebrow">The platform</span>
                <h2 id="platform-title">Less searching. More doing.</h2>
              </div>
              <p className="section-lead">
                More than an HRIS or employee portal, MIL Digital Workplace is the operating system for how we work — connecting people, knowledge, company information, and daily operations in one integrated ecosystem.
              </p>
            </div>

            <div className="objectives-block reveal">
              <div className="mini-head">
                <span>What it’s for</span>
                <span>Five jobs, one system</span>
              </div>
              <div className="objectives">
                {OBJECTIVES.map(([t, b], i) => (
                  <article key={t} className="objective">
                    <span className="objective-num">{String(i + 1).padStart(2, "0")}</span>
                    <h3>{t}</h3>
                    <p>{b}</p>
                  </article>
                ))}
              </div>
            </div>

            <div className="inside" id="inside">
              <div className="inside-head reveal">
                <div className="inside-title">
                  <span className="eyebrow">What’s inside</span>
                  <h3 id="inside-title">Everything at MIL, in one workplace</h3>
                  <p>Built for how MIL Digital works every day — from knowing who’s who to planning your week.</p>
                </div>
              </div>
              <div className="domains" id="domainGrid">
                {MODULES.map((m) => (
                  <article key={m.title} className="domain">
                    <div className="domain-top">
                      <span className="domain-icon" aria-hidden>
                        <I icon={m.icon} className="od-icon icon-domain" />
                      </span>
                      <span className={`domain-status ${m.live ? "status-live" : "status-next"}`}>{m.live ? "Live" : "Next phase"}</span>
                    </div>
                    <h4>{m.title}</h4>
                    <p>{m.body}</p>
                  </article>
                ))}
              </div>
              <p className="domains-note">
                <I icon={Info} />
                Performance &amp; Growth and Collaboration Hub are planned for the next phase. Everything else is live today.
              </p>
            </div>
          </div>
        </section>

        <section className="section who" id="who" aria-labelledby="who-title">
          <div className="wrap who-grid">
            <div className="who-copy reveal">
              <span className="eyebrow">Who we are</span>
              <h2 id="who-title">We are MIL Digital.</h2>
              <p className="who-lead">Beyond an agency. A partner in growth.</p>
              <div className="who-body">
                <p>MIL Digital is a digital marketing consultancy built on the belief that meaningful business growth begins with understanding the bigger picture.</p>
                <p>
                  We go beyond executing campaigns, managing advertisements, or delivering marketing services. We seek to understand the businesses behind every brand, challenge assumptions, uncover opportunities, and help our clients make better decisions.
                </p>
                <p>
                  We work alongside our clients — not simply as service providers, but as trusted partners who share knowledge, exchange perspectives, and navigate challenges together. To keep bringing greater value, we continuously learn, challenge ourselves, and improve the way we think,
                  collaborate, and deliver.
                </p>
              </div>
              <p className="who-pull">Because growing the brands we serve starts with growing ourselves.</p>
            </div>
            <figure className="who-figure reveal">
              <div className="figure-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="od-media team-photo" src="/og/team.jpg" width={1200} height={630} alt="The MIL Digital team gathered together outdoors." loading="lazy" decoding="async" />
                <figcaption className="figure-cap">
                  <span className="figure-id">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src="/brand/mil-mark.png" width={277} height={172} alt="" aria-hidden />
                    The team behind the work.
                  </span>
                  <span className="figure-meta">
                    {activeCount} people · {teamCount} teams
                  </span>
                </figcaption>
              </div>
            </figure>
          </div>
        </section>

        <section className="section how" id="how" aria-labelledby="how-title">
          <div className="wrap">
            <div className="section-head split reveal">
              <div>
                <span className="eyebrow">How we work</span>
                <h2 id="how-title">Three principles. Seven values.</h2>
              </div>
              <p className="section-lead">Our principles guide how we serve clients. ACT FAST shapes how we show up for each other — and for the work.</p>
            </div>
            <div className="principles reveal">
              {PRINCIPLES.map(([Icon, t, b], i) => (
                <article key={t} className="principle">
                  <div className="principle-top">
                    <span className="principle-num">{String(i + 1).padStart(2, "0")}</span>
                    <I icon={Icon} />
                  </div>
                  <h3>{t}</h3>
                  <p>{b}</p>
                </article>
              ))}
            </div>

            <div className="values reveal" aria-labelledby="values-title">
              <div className="values-head">
                <div className="values-title">
                  <span className="eyebrow">The values we live</span>
                  <h3 id="values-title">ACT FAST.</h3>
                </div>
                <p>Seven letters. One standard for how we think, act, and take ownership — with our clients and with each other.</p>
              </div>
              <div className="value-tabs" role="tablist" aria-label="ACT FAST values">
                {VALUES.map(([l, w], i) => (
                  <button key={i} className="value-tab" type="button" role="tab" id={`value-tab-${i + 1}`} aria-selected={i === 0} aria-controls={`value-panel-${i + 1}`} tabIndex={i === 0 ? 0 : -1}>
                    <span className="letter" aria-hidden>
                      {l}
                    </span>
                    <span className="word">{w}</span>
                  </button>
                ))}
              </div>
              <div className="value-stage">
                <div className="value-stage-head">
                  <span className="value-stage-label">How we show up.</span>
                  <div className="value-arrows">
                    <button className="value-arrow" type="button" id="value-prev" aria-label="Previous value">
                      <I icon={ArrowLeft} />
                    </button>
                    <button className="value-arrow" type="button" id="value-next" aria-label="Next value">
                      <I icon={ArrowRight} />
                    </button>
                  </div>
                </div>
                <div className="value-panels">
                  {VALUES.map(([l, w, d], i) => (
                    <div key={i} className="value-panel" id={`value-panel-${i + 1}`} role="tabpanel" aria-labelledby={`value-tab-${i + 1}`} tabIndex={0} hidden={i !== 0}>
                      <div className="value-panel-grid">
                        <div className="value-glyph" aria-hidden>
                          {l}
                        </div>
                        <div className="value-body">
                          <span className="value-count">
                            {String(i + 1).padStart(2, "0")} / {String(VALUES.length).padStart(2, "0")}
                          </span>
                          <h4 className="value-word">{w}</h4>
                          <p className="value-desc">{d}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <p className="values-note">
                <strong>ACT FAST isn’t just about moving fast.</strong> It’s about thinking clearly, acting purposefully, and taking responsibility for the outcomes we create.
              </p>
              <p className="sr-only" id="valueLive" aria-live="polite" />
            </div>
          </div>
        </section>

        <section className="vision" id="vision" aria-labelledby="vision-title">
          <div className="wrap vision-inner">
            <div className="vision-grid">
              <div className="vision-left reveal">
                <span className="eyebrow">The long view</span>
                <h2 id="vision-title">Building something greater, together.</h2>
                <blockquote className="vision-quote">We grow ourselves to grow others.</blockquote>
              </div>
              <div className="vision-copy reveal">
                <p>Our ambition goes beyond helping brands grow. We are building a stronger, more capable organization — one where people take ownership, support one another, think critically, and continuously develop their capabilities.</p>
                <p>As MIL Digital scales, the workplace should reduce information fragmentation, improve operational consistency, preserve institutional knowledge, and empower every teammate to work with greater clarity and autonomy.</p>
                <p className="vision-strong">Success isn’t how many features we ship. It’s how effectively this place helps MIL Digital become stronger, more capable, and better connected.</p>
              </div>
            </div>
            <div className="vision-foot reveal">
              <p>Every insight we discover, every challenge we overcome, and every improvement we make contributes to something bigger than our individual roles.</p>
              <Link className="btn btn-lg btn-invert" href={cta.href}>
                {cta.long}
                <BtnIcon />
              </Link>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="vision-mark" src="/brand/mil-mark.png" width={277} height={172} alt="" aria-hidden />
        </section>
      </main>

      <footer className="site-footer">
        <div className="wrap">
          <div className="footer-top">
            <div className="footer-brand">
              <a className="logo-lockup" href="#top" aria-label="WORKPLACE by MIL Digital — back to top">
                <Logo />
              </a>
              <p>One place to stay informed, manage work, keep learning, and grow together. An internal platform for MIL Digital teammates.</p>
            </div>
            <nav className="footer-col" aria-label="Explore">
              <span className="footer-title">Explore</span>
              <div className="footer-links">
                {NAV.map(([id, label]) => (
                  <a key={id} href={`#${id}`}>
                    {label}
                  </a>
                ))}
              </div>
            </nav>
            <div className="footer-col">
              <span className="footer-title">Workplace</span>
              <div className="footer-links">
                <Link href={cta.href}>{cta.short}</Link>
                <a href="https://mildigital.id" target="_blank" rel="noopener noreferrer" aria-label="mildigital.id (opens in a new tab)">
                  mildigital.id <I icon={ArrowUpRight} />
                </a>
              </div>
            </div>
          </div>
          <div className="footer-bottom">
            <span>
              © {new Date().getFullYear()} MIL Digital
              <span className="sep" aria-hidden>
                ·
              </span>
              Insightful · Companionship · Continuous Improvement
            </span>
            <span>Built for how MIL Digital works every day.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
