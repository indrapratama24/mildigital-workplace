import "server-only";
import { redirect } from "next/navigation";
import { getCurrentUser, type CurrentUser } from "./session";
import { can, type Permission } from "../authz";
import { DomainError, forbidden } from "../errors";

/** For pages: redirect to login when signed out. */
export async function requirePageUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (u.mustChangePassword) redirect("/change-password");
  return u;
}

export async function requirePagePermission(p: Permission): Promise<CurrentUser> {
  const u = await requirePageUser();
  if (!can(u, p)) redirect("/overview?denied=1");
  return u;
}

/** For server actions / route handlers: throw typed errors. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) throw new DomainError("UNAUTHENTICATED", "Your session has expired. Please sign in again.");
  if (u.mustChangePassword) throw new DomainError("FORBIDDEN", "Set a new password first.");
  return u;
}

export async function requirePermission(p: Permission): Promise<CurrentUser> {
  const u = await requireUser();
  if (!can(u, p)) throw forbidden();
  return u;
}
