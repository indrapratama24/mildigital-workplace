import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { Role } from "@prisma/client";
import { db } from "../db";

export const SESSION_COOKIE = "mil_session";
const ttlHours = () => Number(process.env.SESSION_TTL_HOURS ?? 12);

function hashToken(token: string) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 16) throw new Error("SESSION_SECRET must be set (16+ chars)");
  return createHash("sha256").update(`${token}.${secret}`).digest("hex");
}

export interface CurrentUser {
  userId: string;
  email: string;
  role: Role;
  employeeId: string;
  fullName: string;
  jobTitle: string;
  /** Extra permissions granted individually (PermissionGrant). */
  grants?: string[];
  /** After an admin password reset: must set a new password before using the app. */
  mustChangePassword?: boolean;
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours() * 3600_000);
  const ua = (await headers()).get("user-agent")?.slice(0, 250) ?? null;
  await db.session.create({ data: { tokenHash: hashToken(token), userId, expiresAt, userAgent: ua } });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}

/** Resolves the signed-in user once per request. Inactive users / expired sessions are rejected. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { employee: true, grants: { select: { permission: true } } } } },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive || !session.user.employee?.isActive) return null;
  const e = session.user.employee;
  return { userId: session.user.id, email: session.user.email, role: session.user.role, employeeId: e.id, fullName: e.fullName, jobTitle: e.jobTitle, grants: session.user.grants.map((g) => g.permission), mustChangePassword: session.user.mustChangePassword };
});

// Simple in-memory login throttle (per email + per process). Replace with Redis for multi-instance deployments.
const attempts = new Map<string, { count: number; first: number }>();
export function checkLoginThrottle(key: string): boolean {
  const now = Date.now();
  const a = attempts.get(key);
  if (!a || now - a.first > 15 * 60_000) {
    attempts.set(key, { count: 1, first: now });
    return true;
  }
  a.count++;
  return a.count <= 8;
}
export function clearLoginThrottle(key: string) {
  attempts.delete(key);
}
