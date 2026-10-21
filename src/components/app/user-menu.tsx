"use client";
import * as M from "@radix-ui/react-dropdown-menu";
import Link from "next/link";
import { ChevronDown, LogOut, KeyRound, Bell, UserRound } from "lucide-react";
import { logoutAction } from "@/server/actions/auth";
import { Avatar } from "@/components/ui/misc";

export function UserMenu({ name, title, roleLabel, employeeId }: { name: string; title: string; roleLabel: string; employeeId: string }) {
  return (
    <M.Root>
      <M.Trigger className="flex items-center gap-2 rounded-full border border-line bg-white py-1 pl-1 pr-3 text-left hover:border-brand-200" aria-label="Account menu">
        <Avatar name={name} />
        <span className="hidden max-w-[160px] sm:block">
          <span className="block truncate text-[13px] font-semibold leading-tight text-ink">{name}</span>
          <span className="block truncate text-[11.5px] leading-tight text-muted">{roleLabel}</span>
        </span>
        <ChevronDown className="h-4 w-4 text-subtle" />
      </M.Trigger>
      <M.Portal>
        <M.Content align="end" sideOffset={8} className="z-50 min-w-[220px] rounded-2xl border border-line bg-white p-1.5 shadow-pop">
          <div className="px-3 py-2">
            <div className="text-sm font-semibold text-ink">{name}</div>
            <div className="text-[12px] text-muted">{title}</div>
          </div>
          <M.Separator className="my-1 h-px bg-line-2" />
          <M.Item asChild>
            <Link href={`/directory/${employeeId}`} className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-brand-50">
              <UserRound className="h-4 w-4" /> My profile
            </Link>
          </M.Item>
          <M.Item asChild>
            <Link href="/notifications" className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-brand-50">
              <Bell className="h-4 w-4" /> Notifications
            </Link>
          </M.Item>
          <M.Item asChild>
            <Link href="/account" className="flex cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm text-ink-2 outline-none data-[highlighted]:bg-brand-50">
              <KeyRound className="h-4 w-4" /> Change password
            </Link>
          </M.Item>
          <M.Separator className="my-1 h-px bg-line-2" />
          <form action={logoutAction}>
            <button type="submit" className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-danger hover:bg-danger-soft">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </form>
        </M.Content>
      </M.Portal>
    </M.Root>
  );
}
