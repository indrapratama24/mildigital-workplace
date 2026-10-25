// Company Hub: Company 101 content, regulations (versioned, publishable, acknowledgeable),
// targeted announcements and recognition. Employee data is always read from the directory.
import type { AnnouncementPriority, AudienceType, ContentStatus, Prisma, RecognitionKind } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { db, withTx, type DbOrTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { badState, forbidden, invalid, notFound } from "../errors";
import { addDays, fromISO, isValidISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { audit } from "./audit";
import { effectiveOn } from "./org";
import { notify } from "./notifications";
import { listDirectory } from "./people";
import { isEmptyContent, sanitizeContent } from "../content";

const requireEditor = (u: CurrentUser) => {
  if (!can(u, "content.manage")) throw forbidden();
};
const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
function checkUrl(v: string | null | undefined) {
  if (!v?.trim()) return;
  try {
    if (!["http:", "https:"].includes(new URL(v.trim()).protocol)) throw new Error();
  } catch {
    throw invalid("Links must be full http(s) URLs.");
  }
}

// ───────────────────────────── Company 101 ─────────────────────────────

/** Sections of About MIL (categoryId null) or of one custom category. */
export async function listSections(opts: { includeHidden?: boolean; categoryId?: string | null } = {}) {
  return db.companyContentSection.findMany({
    where: { categoryId: opts.categoryId ?? null, ...(opts.includeHidden ? {} : { isPublished: true }) },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
  });
}

export async function saveSection(actor: CurrentUser, input: { id?: string; categoryId?: string | null; title: string; body: string; isPublished: boolean; sortOrder: number }) {
  requireEditor(actor);
  if (input.title.trim().length < 2) throw invalid("Section title is required.");
  const body = sanitizeContent(input.body);
  return withTx(async (tx) => {
    const before = input.id ? await tx.companyContentSection.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !before) throw notFound("Section");
    if (!input.id && input.categoryId && !(await tx.companyHubCategory.findUnique({ where: { id: input.categoryId } }))) throw notFound("Category");
    const data = { title: input.title.trim(), body, isPublished: input.isPublished, sortOrder: input.sortOrder, updatedById: actor.userId };
    const saved = input.id
      ? await tx.companyContentSection.update({ where: { id: input.id }, data })
      : await tx.companyContentSection.create({ data: { ...data, categoryId: input.categoryId ?? null, key: `custom_${Date.now().toString(36)}${randomUUID().slice(0, 6)}` } });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "content.section.update" : "content.section.create", entityType: "CompanyContentSection", entityId: saved.id, before, after: saved });
    return saved;
  });
}

export async function deleteSection(actor: CurrentUser, id: string) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const before = await tx.companyContentSection.findUnique({ where: { id } });
    if (!before) throw notFound("Section");
    await tx.companyContentSection.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "content.section.delete", entityType: "CompanyContentSection", entityId: id, before });
  });
}

// ───────────────────────────── Hub categories ─────────────────────────────
// Custom tabs next to the built-in ones (About MIL, Announcements, Regulations, Recognition).

const RESERVED_SLUGS = new Set(["about", "about-mil", "announcements", "regulations", "recognition", "new", "settings"]);
export const slugify = (t: string) =>
  t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50);

export async function listHubCategories(opts: { includeHidden?: boolean } = {}) {
  return db.companyHubCategory.findMany({
    where: opts.includeHidden ? {} : { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { title: "asc" }],
    include: { _count: { select: { sections: true } } },
  });
}

export async function hubCategoryBySlug(slug: string) {
  return db.companyHubCategory.findFirst({ where: { slug, isPublished: true } });
}

export async function saveHubCategory(actor: CurrentUser, input: { id?: string; title: string; description?: string | null; isPublished: boolean; sortOrder: number }) {
  requireEditor(actor);
  const title = input.title.trim();
  if (title.length < 2 || title.length > 40) throw invalid("Category name must be 2–40 characters.");
  return withTx(async (tx) => {
    const before = input.id ? await tx.companyHubCategory.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !before) throw notFound("Category");
    const clash = await tx.companyHubCategory.findFirst({ where: { title: { equals: title, mode: "insensitive" }, NOT: input.id ? { id: input.id } : undefined } });
    if (clash || ["about mil", "announcements", "regulations", "recognition"].includes(title.toLowerCase())) throw invalid("A Company Hub tab with this name already exists.");
    const data = { title, description: clean(input.description), isPublished: input.isPublished, sortOrder: input.sortOrder };
    let saved;
    if (before) saved = await tx.companyHubCategory.update({ where: { id: before.id }, data });
    else {
      // The slug is the tab's address; it is fixed at creation so shared links keep working after a rename.
      const base = slugify(title) || "page";
      let slug = RESERVED_SLUGS.has(base) ? `${base}-page` : base;
      for (let n = 2; await tx.companyHubCategory.findUnique({ where: { slug } }); n++) slug = `${base}-${n}`;
      saved = await tx.companyHubCategory.create({ data: { ...data, slug } });
    }
    await audit(tx, { actorUserId: actor.userId, action: before ? "content.category.update" : "content.category.create", entityType: "CompanyHubCategory", entityId: saved.id, before, after: saved });
    return saved;
  });
}

/** Deletes the category and all of its sections. */
export async function deleteHubCategory(actor: CurrentUser, id: string) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const before = await tx.companyHubCategory.findUnique({ where: { id }, include: { sections: { select: { id: true, title: true } } } });
    if (!before) throw notFound("Category");
    await tx.companyHubCategory.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "content.category.delete", entityType: "CompanyHubCategory", entityId: id, before });
  });
}

// ───────────────────────────── Regulations ─────────────────────────────

export interface RegulationInput {
  title: string;
  category: string;
  summary?: string | null;
  body: string;
  effectiveDate: ISODate;
  documentUrl?: string | null;
  attachmentId?: string | null;
  ownerId?: string | null;
  requiresAcknowledgement: boolean;
  changeNote?: string | null;
}

function validateRegulation(i: RegulationInput) {
  if (i.title.trim().length < 3) throw invalid("Title is required.");
  if (i.category.trim().length < 2) throw invalid("Category is required.");
  if (isEmptyContent(i.body) && !clean(i.documentUrl) && !i.attachmentId) throw invalid("Add the regulation text, a document link or an attachment.");
  if (!isValidISO(i.effectiveDate)) throw invalid("Effective date is required.");
  checkUrl(i.documentUrl);
}

const versionData = (i: RegulationInput) => ({
  title: i.title.trim(),
  summary: clean(i.summary),
  body: sanitizeContent(i.body),
  effectiveDate: fromISO(i.effectiveDate),
  documentUrl: clean(i.documentUrl),
  attachmentId: i.attachmentId ?? null,
  changeNote: clean(i.changeNote),
});

export async function createRegulation(actor: CurrentUser, input: RegulationInput) {
  requireEditor(actor);
  validateRegulation(input);
  return withTx(async (tx) => {
    const reg = await tx.companyRegulation.create({
      data: { title: input.title.trim(), category: input.category.trim(), ownerId: input.ownerId ?? null, requiresAcknowledgement: input.requiresAcknowledgement, createdById: actor.userId },
    });
    await tx.regulationVersion.create({ data: { regulationId: reg.id, version: 1, ...versionData(input), createdById: actor.userId } });
    await audit(tx, { actorUserId: actor.userId, action: "regulation.create", entityType: "CompanyRegulation", entityId: reg.id, after: { ...reg, input } });
    return reg;
  });
}

/**
 * Saves edits. A draft version is edited in place; when the latest version is already published,
 * a new draft version is created (published text never changes, so acknowledgements stay meaningful).
 */
export async function saveRegulationDraft(actor: CurrentUser, id: string, input: RegulationInput) {
  requireEditor(actor);
  validateRegulation(input);
  return withTx(async (tx) => {
    const reg = await tx.companyRegulation.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!reg) throw notFound("Regulation");
    if (reg.status === "ARCHIVED") throw badState("Restore the regulation before editing it.");
    const latest = reg.versions[0];
    await tx.companyRegulation.update({ where: { id }, data: { category: input.category.trim(), ownerId: input.ownerId ?? null, requiresAcknowledgement: input.requiresAcknowledgement, ...(reg.status === "DRAFT" ? { title: input.title.trim() } : {}) } });
    const version = latest && !latest.publishedAt
      ? await tx.regulationVersion.update({ where: { id: latest.id }, data: versionData(input) })
      : await tx.regulationVersion.create({ data: { regulationId: id, version: (latest?.version ?? 0) + 1, ...versionData(input), createdById: actor.userId } });
    await audit(tx, { actorUserId: actor.userId, action: "regulation.draft.save", entityType: "CompanyRegulation", entityId: id, before: latest, after: version });
    return version;
  });
}

export async function publishRegulation(actor: CurrentUser, id: string) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const reg = await tx.companyRegulation.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    if (!reg) throw notFound("Regulation");
    const draft = reg.versions[0];
    if (!draft || draft.publishedAt) throw badState("There is no draft to publish.");
    await tx.regulationVersion.update({ where: { id: draft.id }, data: { publishedAt: new Date() } });
    await tx.companyRegulation.update({ where: { id }, data: { status: "PUBLISHED", publishedVersionId: draft.id, title: draft.title } });
    await audit(tx, { actorUserId: actor.userId, action: "regulation.publish", entityType: "CompanyRegulation", entityId: id, after: { version: draft.version } });
    if (reg.requiresAcknowledgement) {
      const people = await tx.employee.findMany({ where: { isActive: true }, select: { id: true } });
      for (const p of people)
        await notify(tx, {
          employeeId: p.id,
          type: "REGULATION_PUBLISHED",
          title: `Please acknowledge: ${draft.title}`,
          body: `Version ${draft.version}, effective ${toISO(draft.effectiveDate)}.`,
          link: `/company/regulations/${id}`,
          dedupeKey: `reg:${draft.id}:${p.id}`,
        });
    }
    return draft;
  });
}

export async function setRegulationArchived(actor: CurrentUser, id: string, archived: boolean) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const reg = await tx.companyRegulation.findUnique({ where: { id } });
    if (!reg) throw notFound("Regulation");
    const status: ContentStatus = archived ? "ARCHIVED" : reg.publishedVersionId ? "PUBLISHED" : "DRAFT";
    await tx.companyRegulation.update({ where: { id }, data: { status } });
    await audit(tx, { actorUserId: actor.userId, action: archived ? "regulation.archive" : "regulation.restore", entityType: "CompanyRegulation", entityId: id, before: { status: reg.status }, after: { status } });
  });
}

/** Removes an unpublished draft version (edits only — published versions are permanent). */
export async function discardRegulationDraft(actor: CurrentUser, id: string) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const reg = await tx.companyRegulation.findUnique({ where: { id }, include: { versions: { orderBy: { version: "desc" }, take: 1 } } });
    const draft = reg?.versions[0];
    if (!reg || !draft || draft.publishedAt) throw badState("There is no draft to discard.");
    if (!reg.publishedVersionId) throw badState("This regulation has never been published; archive it instead.");
    await tx.regulationVersion.delete({ where: { id: draft.id } });
    await audit(tx, { actorUserId: actor.userId, action: "regulation.draft.discard", entityType: "CompanyRegulation", entityId: id, before: draft });
  });
}

export async function listRegulations(viewer: CurrentUser, opts: { manage?: boolean; q?: string; category?: string } = {}) {
  const manage = opts.manage && can(viewer, "content.manage");
  const rows = await db.companyRegulation.findMany({
    where: {
      ...(manage ? {} : { status: "PUBLISHED" }),
      ...(opts.category ? { category: opts.category } : {}),
      ...(opts.q ? { title: { contains: opts.q, mode: "insensitive" } } : {}),
    },
    include: {
      owner: { select: { id: true, fullName: true } },
      publishedVersion: true,
      versions: { orderBy: { version: "desc" }, take: 1, select: { id: true, version: true, publishedAt: true, updatedAt: true } },
      acknowledgements: { where: { employeeId: viewer.employeeId }, select: { versionId: true } },
    },
    orderBy: [{ category: "asc" }, { title: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    status: r.status,
    owner: r.owner,
    requiresAcknowledgement: r.requiresAcknowledgement,
    version: r.publishedVersion?.version ?? null,
    summary: r.publishedVersion?.summary ?? null,
    effectiveDate: r.publishedVersion ? toISO(r.publishedVersion.effectiveDate) : null,
    updatedAt: r.publishedVersion?.publishedAt ?? r.updatedAt,
    hasDraft: !!r.versions[0] && !r.versions[0].publishedAt,
    acknowledged: !!r.publishedVersionId && r.acknowledgements.some((a) => a.versionId === r.publishedVersionId),
  }));
}

export async function getRegulation(viewer: CurrentUser, id: string) {
  const manage = can(viewer, "content.manage");
  const r = await db.companyRegulation.findUnique({
    where: { id },
    include: {
      owner: { select: { id: true, fullName: true } },
      publishedVersion: { include: { attachment: { select: { id: true, originalName: true } } } },
      versions: { orderBy: { version: "desc" }, include: { attachment: { select: { id: true, originalName: true } } } },
    },
  });
  if (!r || (!manage && r.status !== "PUBLISHED")) throw notFound("Regulation");
  const ack = r.publishedVersionId ? await db.regulationAcknowledgement.findUnique({ where: { versionId_employeeId: { versionId: r.publishedVersionId, employeeId: viewer.employeeId } } }) : null;
  const ackStats = manage && r.publishedVersionId && r.requiresAcknowledgement
    ? { acknowledged: await db.regulationAcknowledgement.count({ where: { versionId: r.publishedVersionId } }), total: await db.employee.count({ where: { isActive: true } }) }
    : null;
  return {
    ...r,
    versions: manage ? r.versions : r.versions.filter((v) => v.publishedAt),
    draft: manage && r.versions[0] && !r.versions[0].publishedAt ? r.versions[0] : null,
    acknowledgedAt: ack?.acknowledgedAt ?? null,
    ackStats,
    canManage: manage,
  };
}

export async function acknowledgeRegulation(actor: CurrentUser, id: string) {
  return withTx(async (tx) => {
    const r = await tx.companyRegulation.findUnique({ where: { id } });
    if (!r || r.status !== "PUBLISHED" || !r.publishedVersionId) throw notFound("Regulation");
    if (!r.requiresAcknowledgement) throw badState("This regulation doesn't need an acknowledgement.");
    await tx.regulationAcknowledgement.createMany({ data: [{ regulationId: id, versionId: r.publishedVersionId, employeeId: actor.employeeId }], skipDuplicates: true });
  });
}

/** Published regulations the employee still has to acknowledge (for the Home action center). */
export async function pendingAcknowledgements(employeeId: string) {
  const regs = await db.companyRegulation.findMany({
    where: { status: "PUBLISHED", requiresAcknowledgement: true, publishedVersionId: { not: null } },
    select: { id: true, title: true, publishedVersionId: true, acknowledgements: { where: { employeeId }, select: { versionId: true } } },
  });
  return regs.filter((r) => !r.acknowledgements.some((a) => a.versionId === r.publishedVersionId)).map((r) => ({ id: r.id, title: r.title }));
}

// ───────────────────────────── Announcements ─────────────────────────────

export interface AnnouncementInput {
  title: string;
  body: string;
  category: string;
  priority: AnnouncementPriority;
  publishAt: string; // ISO datetime
  expiresAt?: string | null;
  audienceType: AudienceType;
  teamIds?: string[];
  levelIds?: string[];
  employeeIds?: string[];
  linkUrl?: string | null;
  attachmentId?: string | null;
  status: "DRAFT" | "PUBLISHED";
}

function validateAnnouncement(i: AnnouncementInput) {
  if (i.title.trim().length < 3) throw invalid("Title is required.");
  if (isEmptyContent(i.body)) throw invalid("Write the announcement content.");
  if (i.category.trim().length < 2) throw invalid("Category is required.");
  const pub = new Date(i.publishAt);
  if (Number.isNaN(pub.getTime())) throw invalid("Publication date is invalid.");
  if (i.expiresAt) {
    const exp = new Date(i.expiresAt);
    if (Number.isNaN(exp.getTime()) || exp <= pub) throw invalid("Expiration must be after the publication date.");
  }
  const targets = { TEAMS: i.teamIds, LEVELS: i.levelIds, EMPLOYEES: i.employeeIds, ALL: ["*"] }[i.audienceType];
  if (!targets?.length) throw invalid("Choose at least one audience target.");
  checkUrl(i.linkUrl);
}

function audienceRows(i: AnnouncementInput) {
  if (i.audienceType === "TEAMS") return (i.teamIds ?? []).map((teamId) => ({ teamId }));
  if (i.audienceType === "LEVELS") return (i.levelIds ?? []).map((levelId) => ({ levelId }));
  if (i.audienceType === "EMPLOYEES") return (i.employeeIds ?? []).map((employeeId) => ({ employeeId }));
  return [];
}

export async function saveAnnouncement(actor: CurrentUser, id: string | null, input: AnnouncementInput) {
  requireEditor(actor);
  validateAnnouncement(input);
  return withTx(async (tx) => {
    const before = id ? await tx.announcement.findUnique({ where: { id }, include: { audience: true } }) : null;
    if (id && !before) throw notFound("Announcement");
    const data = {
      title: input.title.trim(),
      body: sanitizeContent(input.body),
      category: input.category.trim(),
      priority: input.priority,
      status: input.status,
      publishAt: new Date(input.publishAt),
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      audienceType: input.audienceType,
      linkUrl: clean(input.linkUrl),
      attachmentId: input.attachmentId ?? null,
    };
    const saved = id
      ? await tx.announcement.update({ where: { id }, data })
      : await tx.announcement.create({ data: { ...data, createdById: actor.employeeId } });
    await tx.announcementAudience.deleteMany({ where: { announcementId: saved.id } });
    const rows = audienceRows(input);
    if (rows.length) await tx.announcementAudience.createMany({ data: rows.map((r) => ({ ...r, announcementId: saved.id })) });
    await audit(tx, { actorUserId: actor.userId, action: id ? "announcement.update" : "announcement.create", entityType: "Announcement", entityId: saved.id, before, after: { ...saved, audience: rows } });
    return saved;
  });
}

export async function setAnnouncementStatus(actor: CurrentUser, id: string, status: ContentStatus) {
  requireEditor(actor);
  return withTx(async (tx) => {
    const a = await tx.announcement.findUnique({ where: { id } });
    if (!a) throw notFound("Announcement");
    await tx.announcement.update({ where: { id }, data: { status } });
    await audit(tx, { actorUserId: actor.userId, action: `announcement.${status.toLowerCase()}`, entityType: "Announcement", entityId: id, before: { status: a.status }, after: { status } });
  });
}

/** Audience filter for one employee: everyone, their current team(s), their current level, or them by name. */
async function audienceWhere(employeeId: string, tx: DbOrTx = db): Promise<Prisma.AnnouncementWhereInput> {
  const today = todayJakarta();
  const [teams, level] = await Promise.all([
    tx.employeeTeamMembership.findMany({ where: { employeeId, ...effectiveOn(today) }, select: { teamId: true } }),
    tx.employeeLevelAssignment.findFirst({ where: { employeeId, ...effectiveOn(today) }, select: { levelId: true } }),
  ]);
  return {
    OR: [
      { audienceType: "ALL" },
      { audienceType: "TEAMS", audience: { some: { teamId: { in: teams.map((t) => t.teamId) } } } },
      ...(level ? [{ audienceType: "LEVELS" as const, audience: { some: { levelId: level.levelId } } }] : []),
      { audienceType: "EMPLOYEES", audience: { some: { employeeId } } },
    ],
  };
}

/** Current announcements for an employee: published, started, not expired, and targeted at them. */
export async function announcementsFor(employeeId: string, opts: { take?: number; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  return db.announcement.findMany({
    where: {
      status: "PUBLISHED",
      publishAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [await audienceWhere(employeeId)],
    },
    include: { createdBy: { select: { fullName: true } }, attachment: { select: { id: true, originalName: true } } },
    orderBy: [{ priority: "desc" }, { publishAt: "desc" }],
    take: opts.take ?? 20,
  });
}

export async function getAnnouncement(viewer: CurrentUser, id: string) {
  const a = await db.announcement.findUnique({
    where: { id },
    include: { createdBy: { select: { fullName: true } }, attachment: { select: { id: true, originalName: true } }, audience: { include: { team: true, level: true, employee: { select: { fullName: true } } } } },
  });
  if (!a) throw notFound("Announcement");
  if (can(viewer, "content.manage")) return a;
  const visible = await announcementsFor(viewer.employeeId, { take: 200 });
  if (!visible.some((v) => v.id === id)) throw notFound("Announcement");
  return a;
}

export async function listAnnouncementsAdmin() {
  return db.announcement.findMany({
    include: {
      createdBy: { select: { fullName: true } },
      attachment: { select: { id: true, originalName: true } },
      audience: { include: { team: { select: { name: true } }, level: { select: { name: true } }, employee: { select: { fullName: true } } } },
    },
    orderBy: [{ publishAt: "desc" }],
  });
}

// ───────────────────────────── Recognition ─────────────────────────────

export async function saveRecognition(actor: CurrentUser, id: string | null, input: { employeeId: string; kind: RecognitionKind; title: string; message?: string | null; date: ISODate; status: "PUBLISHED" | "DRAFT" }) {
  requireEditor(actor);
  if (input.title.trim().length < 3) throw invalid("Title is required.");
  if (!isValidISO(input.date)) throw invalid("Date is required.");
  return withTx(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) throw invalid("Choose an employee from the directory.");
    const before = id ? await tx.employeeRecognition.findUnique({ where: { id } }) : null;
    const data = { employeeId: input.employeeId, kind: input.kind, title: input.title.trim(), message: clean(input.message), date: fromISO(input.date), status: input.status };
    const saved = id ? await tx.employeeRecognition.update({ where: { id }, data }) : await tx.employeeRecognition.create({ data: { ...data, createdById: actor.employeeId } });
    await audit(tx, { actorUserId: actor.userId, action: id ? "recognition.update" : "recognition.create", entityType: "EmployeeRecognition", entityId: saved.id, before, after: saved });
    if (!id && input.status === "PUBLISHED")
      await notify(tx, { employeeId: input.employeeId, type: "RECOGNITION", title: `🎉 ${input.title.trim()}`, body: clean(input.message) ?? "You were recognised on the Company Hub.", link: "/company/recognition", dedupeKey: `recog:${saved.id}` });
    return saved;
  });
}

export async function archiveRecognition(actor: CurrentUser, id: string) {
  requireEditor(actor);
  await withTx(async (tx) => {
    const r = await tx.employeeRecognition.findUnique({ where: { id } });
    if (!r) throw notFound("Recognition");
    await tx.employeeRecognition.update({ where: { id }, data: { status: "ARCHIVED" } });
    await audit(tx, { actorUserId: actor.userId, action: "recognition.archive", entityType: "EmployeeRecognition", entityId: id, before: r });
  });
}

/**
 * Recognition feed. Birthdays and anniversaries come from the directory (respecting the viewer's
 * field visibility); promotions are level changes to a higher-ranked level in the last 60 days.
 */
export async function recognitionFeed(viewer: CurrentUser, opts: { manualDays?: number } = {}) {
  const today = todayJakarta();
  const since = addDays(today, -(opts.manualDays ?? 60));
  const [{ highlights }, manual, levelChanges] = await Promise.all([
    listDirectory(viewer),
    db.employeeRecognition.findMany({
      where: { status: "PUBLISHED", date: { gte: fromISO(since) }, employee: { isActive: true } },
      include: { employee: { select: { id: true, fullName: true, jobTitle: true, photoId: true } } },
      orderBy: { date: "desc" },
    }),
    db.employeeLevelAssignment.findMany({
      where: { effectiveFrom: { gte: fromISO(since), lte: fromISO(today) }, employee: { isActive: true } },
      include: { level: true, employee: { select: { id: true, fullName: true, jobTitle: true, photoId: true, levelAssignments: { include: { level: true }, orderBy: { effectiveFrom: "desc" } } } } },
    }),
  ]);
  const promotions = levelChanges
    .map((a) => {
      const prev = a.employee.levelAssignments.find((x) => x.effectiveFrom < a.effectiveFrom);
      return prev && a.level.rank > prev.level.rank ? { employee: a.employee, date: toISO(a.effectiveFrom), from: prev.level.name, to: a.level.name } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.date.localeCompare(a.date));
  return {
    birthdays: highlights.birthdays.map((b) => ({ id: b.id, name: b.name, team: b.team, date: b.next, isToday: b.next === today })),
    anniversaries: highlights.anniversaries.map((a) => ({ id: a.id, name: a.name, team: a.team, years: a.years, date: a.joinDate! })),
    newJoiners: highlights.newJoiners.map((n) => ({ id: n.id, name: n.name, title: n.title, date: n.joinDate! })),
    promotions,
    manual: manual.map((m) => ({ id: m.id, kind: m.kind, title: m.title, message: m.message, date: toISO(m.date), employee: m.employee })),
  };
}

export async function listRecognitionAdmin() {
  return db.employeeRecognition.findMany({ include: { employee: { select: { id: true, fullName: true } }, createdBy: { select: { fullName: true } } }, orderBy: { date: "desc" }, take: 200 });
}
