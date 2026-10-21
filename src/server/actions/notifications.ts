"use server";
import { revalidatePath } from "next/cache";
import { db } from "../db";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";

export async function markNotificationRead(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await db.notification.updateMany({ where: { id, userId: me.userId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
  });
}

export async function markAllNotificationsRead() {
  return runAction(async () => {
    const me = await requireUser();
    await db.notification.updateMany({ where: { userId: me.userId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/", "layout");
  }, "All notifications marked as read");
}
