"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "../db";
import { verifyPassword, hashPassword, passwordPolicyError } from "../auth/password";
import { checkLoginThrottle, clearLoginThrottle, createSession, destroySession, getCurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden, notFound } from "../errors";
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
  if (user.mustChangePassword) redirect("/change-password");
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

/** After an admin reset: the signed-in user sets their own new password (twice). Other sessions are signed out. */
export async function setNewPasswordAction(input: { password: string; confirm: string }) {
  return runAction(async () => {
    const me = await getCurrentUser();
    if (!me) throw invalid("Your session has expired. Please sign in again.");
    const p = z.object({ password: z.string().max(200), confirm: z.string().max(200) }).parse(input);
    if (p.password !== p.confirm) throw invalid("The passwords don't match.");
    const err = passwordPolicyError(p.password);
    if (err) throw invalid(err);
    const user = await db.user.findUniqueOrThrow({ where: { id: me.userId } });
    if (await verifyPassword(p.password, user.passwordHash)) throw invalid("Choose a password different from the temporary one.");
    await db.user.update({ where: { id: me.userId }, data: { passwordHash: await hashPassword(p.password), mustChangePassword: false } });
    await db.session.deleteMany({ where: { userId: me.userId } });
    await createSession(me.userId);
    await audit(db, { actorUserId: me.userId, action: "auth.password_set_after_reset", entityType: "User", entityId: me.userId });
  }, "New password saved");
}

/** Super Admin: give someone a temporary password. They must change it at their next sign-in; all their sessions end now. */
export async function resetPasswordAction(input: { employeeId: string; temporaryPassword: string }) {
  return runAction(async () => {
    const me = await requireUser();
    if (!can(me, "user.manage")) throw forbidden("Only Super Admins can reset passwords.");
    const p = z.object({ employeeId: z.string(), temporaryPassword: z.string().max(200) }).parse(input);
    const emp = await db.employee.findUnique({ where: { id: p.employeeId }, include: { user: true } });
    if (!emp?.user) throw notFound("Account");
    if (emp.user.id === me.userId) throw invalid("Use Account → Change password for your own password.");
    const err = passwordPolicyError(p.temporaryPassword);
    if (err) throw invalid(err);
    await db.$transaction([
      db.user.update({ where: { id: emp.user.id }, data: { passwordHash: await hashPassword(p.temporaryPassword), mustChangePassword: true } }),
      db.session.deleteMany({ where: { userId: emp.user.id } }),
    ]);
    // never log the password itself
    await audit(db, { actorUserId: me.userId, action: "auth.password_reset", entityType: "User", entityId: emp.user.id, metadata: { employeeId: emp.id } });
  }, "Temporary password set");
}
