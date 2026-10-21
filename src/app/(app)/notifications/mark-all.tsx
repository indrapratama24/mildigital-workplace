"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { markAllNotificationsRead } from "@/server/actions/notifications";
import { Button } from "@/components/ui/button";

export function MarkAllRead() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button size="sm" variant="secondary" loading={pending} onClick={() => start(async () => { const r = await markAllNotificationsRead(); if (r.ok) toast.success(r.message); router.refresh(); })}>
      Mark all as read
    </Button>
  );
}
