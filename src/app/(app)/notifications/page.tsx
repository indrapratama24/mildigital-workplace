import Link from "next/link";
import { Bell } from "lucide-react";
import { db } from "@/server/db";
import { requirePageUser } from "@/server/auth/guard";
import { formatDateTime } from "@/lib/dates";
import { Card } from "@/components/ui/card";
import { EmptyState, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { MarkAllRead } from "./mark-all";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const me = await requirePageUser();
  const { filter } = await searchParams;
  const items = await db.notification.findMany({ where: { userId: me.userId, readAt: filter === "unread" ? null : undefined }, orderBy: { createdAt: "desc" }, take: 200 });
  const unread = items.filter((i) => !i.readAt).length;
  return (
    <>
      <PageHeader
        eyebrow="Notifications"
        title="Notification history"
        description="Every approval step, delegation, shortfall and deadline alert. Email delivery is optional (see docs)."
        actions={
          <>
            <Link href={filter === "unread" ? "/notifications" : "/notifications?filter=unread"} className="text-[13px] font-medium text-brand-700 hover:underline">{filter === "unread" ? "Show all" : "Unread only"}</Link>
            {unread > 0 && <MarkAllRead />}
          </>
        }
      />
      {items.length === 0 ? (
        <EmptyState icon={Bell} title="No notifications" />
      ) : (
        <Card className="divide-y divide-line-2">
          {items.map((n) => (
            <Link key={n.id} href={n.link ?? "#"} className={cn("flex gap-3 px-5 py-3.5 hover:bg-canvas/60", !n.readAt && "bg-brand-50/40")}>
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.readAt ? "bg-line" : "bg-brand-500")} />
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[14px]", n.readAt ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                {n.body && <span className="block text-[13px] text-muted">{n.body}</span>}
              </span>
              <span className="shrink-0 text-[12px] text-subtle">{formatDateTime(n.createdAt)}</span>
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}
