import Link from "next/link";
import { Paperclip } from "lucide-react";
import type { AnnouncementPriority } from "@prisma/client";
import { formatDateTime } from "@/lib/dates";
import { docToText } from "@/lib/content/format";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type A = { id: string; title: string; body: string; category: string; priority: AnnouncementPriority; publishAt: Date; createdBy: { fullName: string }; attachment?: { id: string } | null };

export function AnnouncementCard({ a, compact }: { a: A; compact?: boolean }) {
  const plain = docToText(a.body, 300);
  return (
    <Link
      href={`/company/announcements/${a.id}`}
      className={cn(
        "block rounded-2xl border bg-white p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/30",
        a.priority === "CRITICAL" ? "border-danger/40" : a.priority === "IMPORTANT" ? "border-warning/40" : "border-line-2",
      )}
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <Badge tone="brand">{a.category}</Badge>
        {a.priority !== "NORMAL" && <Badge tone={a.priority === "CRITICAL" ? "danger" : "warning"}>{a.priority.toLowerCase()}</Badge>}
        {a.attachment && <Paperclip className="h-3.5 w-3.5 text-subtle" aria-label="Has attachment" />}
      </div>
      <div className="font-semibold text-ink">{a.title}</div>
      <p className={cn("mt-1 text-[13px] text-muted", compact ? "line-clamp-2" : "line-clamp-3")}>{plain}</p>
      <div className="mt-2 text-[11.5px] text-subtle">{formatDateTime(a.publishAt)} · {a.createdBy.fullName}</div>
    </Link>
  );
}
