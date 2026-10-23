import Link from "next/link";
import { db } from "@/server/db";
import { sendDueReminders } from "@/server/services/events";
import { requirePageUser } from "@/server/auth/guard";
import { can, ROLE_LABELS } from "@/server/authz";
import { cookies } from "next/headers";
import { NAV_ITEMS } from "@/components/app/nav";
import { MobileNav, SidebarNav, SidebarToggle } from "@/components/app/sidebar";
import { UserMenu } from "@/components/app/user-menu";
import { NotificationBell } from "@/components/app/notification-bell";
import { MilMark, Wordmark } from "@/components/app/brand";
import { getSettings } from "@/server/services/settings";
import { formatDateTime, formatDateLong, todayJakarta } from "@/lib/dates";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requirePageUser();
  // Event reminders are also delivered lazily when the user opens the app (the scheduled job runs once a day).
  await sendDueReminders(new Date(), me.employeeId).catch(() => undefined);
  const [unread, latest, pendingSteps, settings, jar] = await Promise.all([
    db.notification.count({ where: { userId: me.userId, readAt: null } }),
    db.notification.findMany({ where: { userId: me.userId }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.approvalStep.count({ where: { assigneeId: me.employeeId, status: "PENDING", workflow: { status: "PENDING" } } }),
    getSettings(),
    cookies(),
  ]);
  const allowed = NAV_ITEMS.filter((n) => !n.any || n.any.some((p) => can(me, p))).map((n) => n.id);
  const nav = { allowed, badges: { approvals: pendingSteps }, knowledgeHubUrl: settings.knowledgeHubUrl };
  const collapsed = jar.get("mil_sidebar")?.value === "collapsed";
  return (
    <div id="app-frame" data-sidebar={collapsed ? "collapsed" : "expanded"} className="group/frame min-h-screen bg-canvas">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[264px] flex-col border-r border-line bg-[#f8faff] px-4 py-5 transition-[width] lg:flex lg:group-data-[sidebar=collapsed]/frame:w-[76px] lg:group-data-[sidebar=collapsed]/frame:px-3">
        <Link href="/overview" className="mb-7 px-2 lg:group-data-[sidebar=collapsed]/frame:px-0" aria-label="Home">
          <span className="lg:group-data-[sidebar=collapsed]/frame:hidden">
            <Wordmark id="side" />
          </span>
          <MilMark className="mx-auto hidden !w-9 lg:group-data-[sidebar=collapsed]/frame:block" />
        </Link>
        <div className="-mx-1 flex-1 overflow-y-auto px-1 pb-4">
          <SidebarNav {...nav} />
        </div>
        <div className="rounded-2xl border border-line bg-white p-3 text-[12px] text-muted lg:group-data-[sidebar=collapsed]/frame:hidden">
          <div className="font-medium text-ink-2">{formatDateLong(todayJakarta())}</div>
          <div>Asia/Jakarta (WIB)</div>
        </div>
      </aside>
      <div className="transition-[padding] lg:pl-[264px] lg:group-data-[sidebar=collapsed]/frame:pl-[76px]">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line/70 bg-canvas/85 px-4 backdrop-blur sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-2">
            <MobileNav {...nav} />
            <SidebarToggle />
            <Link href="/" className="lg:hidden" aria-label="Home">
              <Wordmark id="top" compact />
            </Link>
          </div>
          <div className="flex shrink-0 items-center gap-2.5">
            <NotificationBell
              unread={unread}
              items={latest.map((n) => ({ id: n.id, title: n.title, body: n.body, link: n.link, createdAt: formatDateTime(n.createdAt), read: !!n.readAt }))}
            />
            <UserMenu name={me.fullName} title={me.jobTitle} roleLabel={ROLE_LABELS[me.role]} employeeId={me.employeeId} />
          </div>
        </header>
        <main className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
