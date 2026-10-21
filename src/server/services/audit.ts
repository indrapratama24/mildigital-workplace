import type { Prisma } from "@prisma/client";
import type { DbOrTx } from "../db";

export interface AuditEntry {
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
}

const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue));

export async function audit(tx: DbOrTx, e: AuditEntry) {
  await tx.auditLog.create({
    data: {
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      entityType: e.entityType,
      entityId: e.entityId,
      before: json(e.before),
      after: json(e.after),
      metadata: json(e.metadata),
    },
  });
}
