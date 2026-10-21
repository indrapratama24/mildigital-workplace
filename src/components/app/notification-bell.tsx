"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell } from "lucide-react";
import { markAllNotificationsRead, markNotificationRead } from "@/server/actions/notifications";
import { cn } from "@/lib/cn";

export interface BellItem {
  id: string;
  title: string;
  body: string;
  link: string | null;
  createdAt: string;
  read: boolean;
}

export function NotificationBell({ unread, items }: { unread: number; items: BellItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const open = (n: BellItem) =>
    start(async () => {
      if (!n.read) await markNotificationRead(n.id);
      if (n.link) router.push(n.link);
    });
  return (
    <M.Root>
      <M.Trigger className="relative rounded-full border border-line bg-white p-2.5 text-ink-2 hover:border-brand-200 hover:text-brand-700" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-pending px-1 text-center text-[10.5px] font-bold leading-5 text-white">{unread > 99 ? "99+" : unread}</span>}
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={8} className="z-50 w-[min(380px,calc(100vw-24px))] rounded-2xl border border-line bg-white shadow-pop">
          <div className="flex items-center justify-between border-b border-line-2 px-4 py-3">
            <span className="text-sm font-semibold text-ink">Notifications</span>
            {unread > 0 && (
              <button className="text-[12.5px] font-medium text-brand-600 hover:underline disabled:opacity-50" disabled={pending} onClick={() => start(async () => void (await markAllNotificationsRead()))}>
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[400px] overflow-y-auto p-1.5">
            {items.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>}
            {items.map((n) => (
              <M.Item key={n.id} onSelect={() => open(n)} className="flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 outline-none data-[highlighted]:bg-brand-50">
                <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-transparent" : "bg-brand-500")} aria-hidden />
                <span className="min-w-0">
                  <span className={cn("block text-[13px] leading-snug", n.read ? "text-ink-2" : "font-semibold text-ink")}>{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-[12px] text-muted">{n.body}</span>}
                  <span className="mt-0.5 block text-[11px] text-subtle">{n.createdAt}</span>
                </span>
              </M.Item>
            ))}
          </div>
          <div className="border-t border-line-2 p-1.5">
            <M.Item asChild>
              <Link href="/notifications" className="block rounded-xl px-3 py-2 text-center text-[13px] font-medium text-brand-700 outline-none data-[highlighted]:bg-brand-50">
                View all notifications
              </Link>
            </M.Item>
          </div>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
