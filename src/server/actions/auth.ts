"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { verifyPassword, hashPassword, passwordPolicyError } from "../auth/password";
import { checkLoginThrottle, clearLoginThrottle, createSession, destroySession } from "../auth/session";
import { requireUser } from "../auth/guard";
import { audit } from "../services/audit";
import { runAction } from "../errors";
import { invalid } from "../errors";

let dummy: Promise<string> | null = null;
const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-0"));

const schema = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200), next: z.string().optional() });

export async function loginAction(_: unknown, form: FormData): Promise<{ error?: string }> {
  const parsed = schema.safeParse({ email: form.get("email"), password: form.get("password"), next: form.get("next") ?? undefined });
  if (!parsed.success) return { error: "Enter a valid email and password." };
  const { email, password } = parsed.data;
  if (!checkLoginThrottle(email)) return { error: "Too many attempts. Try again in 15 minutes." };
  const user = await db.user.findUnique({ where: { email }, include: { employee: true } });
  // constant-ish time: always run a bcrypt compare
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash()));
  if (!user || !ok || !user.isActive || !user.employee?.isActive) return { error: "Incorrect email or password." };
  clearLoginThrottle(email);
  await createSession(user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit(db, { actorUserId: user.id, action: "auth.login", entityType: "User", entityId: user.id });
  const next = parsed.data.next && parsed.data.next.startsWith("/") && !parsed.data.next.startsWith("//") ? parsed.data.next : "/overview";
  redirect(next);
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function changePasswordAction(input: { current: string; next: string }) {
  return runAction(async () => {
    const me = await requireUser();
    const user = await db.user.findUniqueOrThrow({ where: { id: me.userId } });
    if (!(await verifyPassword(input.current, user.passwordHash))) throw invalid("Current password is incorrect.");
    const err = passwordPolicyError(input.next);
    if (err) throw invalid(err);
    await db.user.update({ where: { id: me.userId }, data: { passwordHash: await hashPassword(input.next) } });
    await db.session.deleteMany({ where: { userId: me.userId } });
    await audit(db, { actorUserId: me.userId, action: "auth.password_change", entityType: "User", entityId: me.userId });
  }, "Password changed. Please sign in again.");
}
