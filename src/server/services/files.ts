import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import type { CurrentUser } from "../auth/session";
import { can, hasCompanyScope } from "../authz";
import { forbidden, invalid, notFound } from "../errors";
import { getStorage } from "../adapters/storage";
import { isLeaderOf } from "./org";

const ALLOWED: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString() === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/webp": (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP",
};

/** Validates type by magic bytes (not the client-provided MIME), size, and stores privately. */
export async function saveUpload(actor: CurrentUser, file: File, opts: { sensitive: boolean }) {
  const maxMb = Number(process.env.UPLOAD_MAX_MB ?? 5);
  if (!file || file.size === 0) throw invalid("Choose a file to upload.");
  if (file.size > maxMb * 1024 * 1024) throw invalid(`Files must be ${maxMb} MB or smaller.`);
  const buf = Buffer.from(await file.arrayBuffer());
  const mime = Object.keys(ALLOWED).find((m) => ALLOWED[m](buf));
  if (!mime) throw invalid("Only PDF, PNG, JPEG or WEBP files are accepted.");
  const key = randomBytes(24).toString("hex");
  await getStorage().put(key, buf);
  const name = file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "document";
  return db.storedFile.create({
    data: { ownerId: actor.userId, originalName: name, mimeType: mime, size: buf.length, storageKey: key, sha256: createHash("sha256").update(buf).digest("hex"), isSensitive: opts.sensitive },
  });
}

/**
 * Access rules: owner; approvers assigned to the request (leader/HR steps); HR (company scope).
 * Sensitive (e.g. medical) documents are NOT visible to leaders outside the approval chain, and
 * the peer delegate only ever sees the handover attachment.
 */
export async function authorizeFileAccess(viewer: CurrentUser, fileId: string) {
  const file = await db.storedFile.findUnique({
    where: { id: fileId },
    include: { request: true, delegation: true, employeePhoto: { select: { id: true } }, announcements: { select: { id: true }, take: 1 }, regulationVersions: { select: { publishedAt: true } } },
  });
  // file.delegation: a handover attachment belongs to exactly one delegate's assignment
  if (!file) throw notFound("File");
  if (file.ownerId === viewer.userId) return file;
  // Workplace content: profile photos, announcement and published regulation attachments are company-internal.
  if (file.employeePhoto || file.announcements.length || file.regulationVersions.some((v) => v.publishedAt)) return file;
  if (file.regulationVersions.length && can(viewer, "content.manage")) return file;
  if (file.request) {
    const r = file.request;
    if (can(viewer, "company.view")) return file;
    const approver = await db.approvalStep.count({
      where: { kind: { in: ["LEADER", "HR"] }, OR: [{ assigneeId: viewer.employeeId }, { originalAssigneeId: viewer.employeeId }], workflow: { subjectType: "REQUEST", subjectId: r.id } },
    });
    if (approver) return file;
    if (!file.isSensitive && can(viewer, "team.view") && (await isLeaderOf(db, viewer.employeeId, r.employeeId))) return file;
  }
  if (file.delegation) {
    const d = file.delegation;
    if (d.delegateId === viewer.employeeId || hasCompanyScope(viewer)) return file;
  }
  throw forbidden("You do not have access to this file.");
}

export async function readFile(storageKey: string) {
  return getStorage().get(storageKey);
}
