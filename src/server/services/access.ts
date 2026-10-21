// Individual permission grants on top of a user's role (Settings → Roles & access).
import { db, withTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can, GRANTABLE, ROLE_PERMISSIONS, type Permission } from "../authz";
import { forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";

export async function listAccess() {
  const users = await db.user.findMany({
    where: { isActive: true, employee: { isActive: true } },
    include: { employee: { select: { id: true, fullName: true, jobTitle: true } }, grants: true },
    orderBy: { employee: { fullName: "asc" } },
  });
  return users.map((u) => ({
    userId: u.id,
    employeeId: u.employee?.id ?? null,
    name: u.employee?.fullName ?? u.email,
    title: u.employee?.jobTitle ?? "",
    role: u.role,
    grants: u.grants.map((g) => g.permission as Permission),
    /** Grantable permissions the role already includes (shown as inherited). */
    inherited: GRANTABLE.filter((p) => ROLE_PERMISSIONS[u.role].has(p)),
  }));
}

export async function setGrants(actor: CurrentUser, userId: string, permissions: string[]) {
  if (!can(actor, "user.manage")) throw forbidden();
  const bad = permissions.filter((p) => !GRANTABLE.includes(p as Permission));
  if (bad.length) throw invalid(`Not grantable: ${bad.join(", ")}`);
  return withTx(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId }, include: { grants: true } });
    if (!user) throw notFound("User");
    const before = user.grants.map((g) => g.permission).sort();
    const wanted = [...new Set(permissions)].filter((p) => !ROLE_PERMISSIONS[user.role].has(p as Permission)).sort();
    await tx.permissionGrant.deleteMany({ where: { userId, permission: { notIn: wanted } } });
    for (const p of wanted) await tx.permissionGrant.upsert({ where: { userId_permission: { userId, permission: p } }, create: { userId, permission: p, grantedById: actor.userId }, update: {} });
    await audit(tx, { actorUserId: actor.userId, action: "access.grants.update", entityType: "User", entityId: userId, before, after: wanted });
    return wanted;
  });
}
