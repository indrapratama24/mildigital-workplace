// Client & Portfolio. The brand (ClientBrand) is the directory record; its `clientCode` is the
// user-facing Client ID. Status, engagement, package and team are effective-dated so monthly
// counts stay correct after later changes.
import type { ClientRole, ClientStatus, Prisma } from "@prisma/client";
import { db, withTx, type DbOrTx, type Tx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { addDays, fromISO, isValidISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import {
  CLIENT_CODE_PATTERN,
  clientCode,
  collaborationPeriod,
  teamRows,
  validateTeam,
  type ClientStatusT,
  type StatusPeriod,
  type TeamInput,
} from "@/lib/engine/clients";
import { audit } from "./audit";
import { getSettings } from "./settings";

// ───────────────────────────── Access ─────────────────────────────

export const canManageClients = (u: CurrentUser) => can(u, "client.manage");

/** PIC contact and internal notes: client.sensitive, or currently assigned to the client. */
export async function canSeeClientSensitive(u: CurrentUser, brandId: string, tx: DbOrTx = db) {
  if (can(u, "client.sensitive")) return true;
  return (await tx.clientTeamAssignment.count({ where: { brandId, employeeId: u.employeeId, effectiveTo: null } })) > 0;
}

// ───────────────────────────── Packages ─────────────────────────────

export async function listPackages(opts: { includeInactive?: boolean } = {}) {
  return db.clientPackage.findMany({ where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] });
}

export async function upsertPackage(actor: CurrentUser, input: { id?: string; name: string; description: string | null; isActive: boolean; sortOrder: number }) {
  if (!can(actor, "clientPackage.manage")) throw forbidden();
  const name = input.name.trim();
  if (name.length < 2) throw invalid("Package name is required.");
  return withTx(async (tx) => {
    const dup = await tx.clientPackage.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: input.id ? { id: input.id } : undefined } });
    if (dup) throw conflict(`A package named “${dup.name}” already exists.`);
    const before = input.id ? await tx.clientPackage.findUnique({ where: { id: input.id } }) : null;
    if (input.id && !before) throw notFound("Package");
    const data = { name, description: input.description?.trim() || null, isActive: input.isActive, sortOrder: input.sortOrder };
    const saved = input.id ? await tx.clientPackage.update({ where: { id: input.id }, data }) : await tx.clientPackage.create({ data });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "client.package.update" : "client.package.create", entityType: "ClientPackage", entityId: saved.id, before, after: saved });
    return saved;
  });
}

/** Unused packages are deleted; packages referenced by any engagement are archived (inactive) instead. */
export async function removePackage(actor: CurrentUser, id: string) {
  if (!can(actor, "clientPackage.manage")) throw forbidden();
  return withTx(async (tx) => {
    const pkg = await tx.clientPackage.findUnique({ where: { id } });
    if (!pkg) throw notFound("Package");
    const used = await tx.clientEngagementPackage.count({ where: { packageId: id } });
    if (used) await tx.clientPackage.update({ where: { id }, data: { isActive: false } });
    else await tx.clientPackage.delete({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: used ? "client.package.archive" : "client.package.delete", entityType: "ClientPackage", entityId: id, before: pkg });
    return { mode: used ? ("archived" as const) : ("deleted" as const) };
  });
}

// ───────────────────────────── Input ─────────────────────────────

export interface ClientInfoInput {
  name: string;
  organizationName?: string | null;
  /** Brand classification: category id, then industry / sub-industry by name (created when new). */
  categoryId?: string | null;
  industryName?: string | null;
  subIndustryName?: string | null;
  /** Ad account types handled, by name (unknown names are added to the list). */
  adAccounts?: string[];
  description?: string | null;
  websiteUrl?: string | null;
  instagramUrl?: string | null;
  tiktokUrl?: string | null;
  picName?: string | null;
  picPhone?: string | null;
  picEmail?: string | null;
  internalNotes?: string | null;
}

export interface CreateClientInput extends ClientInfoInput {
  clientCode?: string | null;
  status: ClientStatusT;
  dateStart: ISODate;
  dateOff?: ISODate | null;
  /** When created as Freeze: the day the freeze started (defaults to today). */
  statusEffectiveDate?: ISODate | null;
  packageId: string;
  team: TeamInput;
  waivePrimary?: boolean;
  waiverReason?: string | null;
}

export interface UpdateClientInput extends ClientInfoInput {
  clientCode: string;
  dateStart: ISODate;
  packageId: string;
  team: TeamInput;
  waivePrimary?: boolean;
  waiverReason?: string | null;
  status?: { status: ClientStatusT; effectiveDate?: ISODate | null; dateOff?: ISODate | null; reason?: string | null } | null;
  /** Date the team change (new PIC / addition / removal) takes effect. Defaults to today; can't be in the future. */
  teamEffectiveDate?: ISODate | null;
}

const clean = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);

function checkUrl(label: string, v: string | null | undefined) {
  if (!v?.trim()) return;
  try {
    const u = new URL(v.trim());
    if (!["http:", "https:"].includes(u.protocol)) throw new Error();
  } catch {
    throw invalid(`${label} must be a full http(s) URL.`);
  }
}

function validateInfo(i: ClientInfoInput) {
  if (i.name.trim().length < 2) throw invalid("Brand name is required.");
  if (i.name.trim().length > 120) throw invalid("Brand name is too long.");
  checkUrl("Website URL", i.websiteUrl);
  checkUrl("Instagram URL", i.instagramUrl);
  checkUrl("TikTok URL", i.tiktokUrl);
  if (i.picPhone?.trim() && !/^\+?[0-9][0-9\s()-]{6,20}$/.test(i.picPhone.trim())) throw invalid("PIC phone looks invalid (digits, spaces, + and - only).");
  if (i.picEmail?.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(i.picEmail.trim())) throw invalid("PIC email is invalid.");
  if (i.subIndustryName?.trim() && !i.industryName?.trim()) throw invalid("Choose an industry before a sub-industry.");
  if ((i.adAccounts?.length ?? 0) > 20) throw invalid("Too many ad accounts.");
}

function infoData(i: ClientInfoInput, canSensitive: boolean) {
  return {
    name: i.name.trim(),
    description: clean(i.description),
    websiteUrl: clean(i.websiteUrl),
    instagramUrl: clean(i.instagramUrl),
    tiktokUrl: clean(i.tiktokUrl),
    ...(canSensitive ? { picName: clean(i.picName), picPhone: clean(i.picPhone), picEmail: clean(i.picEmail)?.toLowerCase() ?? null, internalNotes: clean(i.internalNotes) } : {}),
  };
}

async function organizationId(tx: Tx, name: string | null | undefined) {
  const n = clean(name);
  if (!n) return null;
  const org = await tx.clientOrganization.upsert({ where: { name: n }, create: { name: n }, update: {} });
  return org.id;
}

/** Finds or creates the industry (within the category) and sub-industry so they can be reused by other brands. */
async function resolveTaxonomy(tx: Tx, i: ClientInfoInput) {
  const categoryId = i.categoryId || null;
  if (categoryId && !(await tx.clientCategory.findUnique({ where: { id: categoryId } }))) throw invalid("Unknown category.");
  const industryName = clean(i.industryName)?.slice(0, 80);
  if (!industryName) return { categoryId, industryId: null, subIndustryId: null };
  const industry =
    (await tx.clientIndustry.findFirst({ where: { categoryId, name: { equals: industryName, mode: "insensitive" } } })) ??
    (await tx.clientIndustry.create({ data: { name: industryName, categoryId } }));
  const subName = clean(i.subIndustryName)?.slice(0, 80);
  if (!subName) return { categoryId, industryId: industry.id, subIndustryId: null };
  const sub =
    (await tx.clientSubIndustry.findFirst({ where: { industryId: industry.id, name: { equals: subName, mode: "insensitive" } } })) ??
    (await tx.clientSubIndustry.create({ data: { name: subName, industryId: industry.id } }));
  return { categoryId, industryId: industry.id, subIndustryId: sub.id };
}

/** Replaces the brand's ad account types; new names are added to the shared list. */
async function syncAdAccounts(tx: Tx, brandId: string, names: string[] | undefined) {
  if (names === undefined) return;
  const wanted = [...new Map(names.map((n) => n.trim().slice(0, 60)).filter(Boolean).map((n) => [n.toLowerCase(), n])).values()];
  const ids: string[] = [];
  for (const n of wanted) {
    const t = (await tx.clientAdAccountType.findFirst({ where: { name: { equals: n, mode: "insensitive" } } })) ?? (await tx.clientAdAccountType.create({ data: { name: n, sortOrder: 100 } }));
    ids.push(t.id);
  }
  await tx.clientBrandAdAccount.deleteMany({ where: { brandId, typeId: { notIn: ids } } });
  await tx.clientBrandAdAccount.createMany({ data: ids.map((typeId) => ({ brandId, typeId })), skipDuplicates: true });
}

async function assertCodeFree(tx: Tx, code: string, exceptBrandId?: string) {
  if (!CLIENT_CODE_PATTERN.test(code)) throw invalid("Client ID may use capital letters, digits and dashes (3–30 characters), e.g. MIL-CL-0001.");
  const taken = await tx.clientBrand.findFirst({ where: { clientCode: code, NOT: exceptBrandId ? { id: exceptBrandId } : undefined } });
  const retired = await tx.clientCodeAlias.findUnique({ where: { code } });
  if (taken || (retired && retired.brandId !== exceptBrandId)) throw conflict(`Client ID ${code} is already in use or was used before. IDs are never reused.`);
}

async function nextFreeCode(tx: Tx) {
  for (let i = 0; i < 1000; i++) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('client_code_seq') AS n`;
    const code = clientCode(Number(n));
    const used = (await tx.clientBrand.count({ where: { clientCode: code } })) + (await tx.clientCodeAlias.count({ where: { code } }));
    if (!used) return code;
  }
  throw conflict("Could not allocate a Client ID.");
}

async function assertEmployees(tx: Tx, ids: string[]) {
  if (!ids.length) return;
  const found = await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true, fullName: true } });
  if (found.length !== new Set(ids).size) throw invalid("One of the selected employees does not exist.");
  const inactive = found.filter((e) => !e.isActive);
  if (inactive.length) throw invalid(`${inactive.map((e) => e.fullName).join(", ")} is no longer active and can't be newly assigned.`);
}

async function assertPackage(tx: Tx, packageId: string, allowInactiveId?: string | null) {
  const pkg = await tx.clientPackage.findUnique({ where: { id: packageId } });
  if (!pkg) throw invalid("Choose a package.");
  if (!pkg.isActive && pkg.id !== allowInactiveId) throw invalid(`Package “${pkg.name}” is archived. Choose an active package.`);
  return pkg;
}

/** Row lock on the brand so concurrent edits (e.g. two people adding Ads Strategists) serialise. */
const lockBrand = (tx: Tx, id: string) => tx.$queryRaw`SELECT id FROM "ClientBrand" WHERE id = ${id} FOR UPDATE`;

/**
 * Applies the desired team from `from` (the change date): unchanged rows stay, removed/changed rows end the
 * day before, new rows start that day.
 */
async function syncTeam(tx: Tx, actor: CurrentUser, brandId: string, team: TeamInput, from: ISODate) {
  const wanted = teamRows(team);
  const current = await tx.clientTeamAssignment.findMany({ where: { brandId, effectiveTo: null } });
  const keep = new Set<string>();
  const changes: { employeeId: string; from: ClientRole | null; to: ClientRole | null }[] = [];
  for (const row of current) {
    const w = wanted.find((x) => x.employeeId === row.employeeId);
    if (w && w.role === row.role) {
      keep.add(row.employeeId);
      continue;
    }
    const started = toISO(row.effectiveFrom);
    await tx.clientTeamAssignment.update({ where: { id: row.id }, data: { effectiveTo: fromISO(started >= from ? started : addDays(from, -1)), endedById: actor.employeeId } });
    if (!w) changes.push({ employeeId: row.employeeId, from: row.role, to: null });
  }
  const newIds = wanted.filter((w) => !keep.has(w.employeeId)).map((w) => w.employeeId);
  await assertEmployees(tx, newIds);
  for (const w of wanted) {
    if (keep.has(w.employeeId)) continue;
    const prev = current.find((c) => c.employeeId === w.employeeId);
    await tx.clientTeamAssignment.create({ data: { brandId, employeeId: w.employeeId, role: w.role, effectiveFrom: fromISO(from), assignedById: actor.employeeId } });
    changes.push({ employeeId: w.employeeId, from: prev?.role ?? null, to: w.role });
  }
  return changes;
}

// ───────────────────────────── Create / update ─────────────────────────────

export async function createClient(actor: CurrentUser, input: CreateClientInput) {
  if (!canManageClients(actor)) throw forbidden();
  validateInfo(input);
  const today = todayJakarta();
  if (!isValidISO(input.dateStart)) throw invalid("Date START is required.");
  if (input.dateStart > addDays(today, 366)) throw invalid("Date START is too far in the future.");
  const dateOff = clean(input.dateOff);
  if (input.status === "INACTIVE") {
    if (!dateOff || !isValidISO(dateOff)) throw invalid("Date OFF is required for an inactive client.");
    if (dateOff > today) throw invalid("Date OFF can't be in the future.");
  }
  if (dateOff && dateOff < input.dateStart) throw invalid("Date OFF can't be earlier than Date START.");
  const settings = await getSettings();
  const waived = !!input.waivePrimary;
  if (waived && !clean(input.waiverReason)) throw invalid("Give a reason for the Consultant 1 exception.");
  const errs = validateTeam(input.team, { status: input.status, requirePrimary: settings.clientRequirePrimaryConsultant, waived });
  if (errs.length) throw invalid(errs.join(" "));

  return withTx(async (tx) => {
    await assertPackage(tx, input.packageId);
    const code = clean(input.clientCode)?.toUpperCase() ?? (await nextFreeCode(tx));
    if (input.clientCode) await assertCodeFree(tx, code);
    const brand = await tx.clientBrand.create({
      data: {
        clientCode: code,
        organizationId: await organizationId(tx, input.organizationName),
        ...infoData(input, true),
        ...(await resolveTaxonomy(tx, input)),
        status: input.status,
        dateStart: fromISO(input.dateStart),
        dateOff: input.status === "INACTIVE" && dateOff ? fromISO(dateOff) : null,
        primaryConsultantWaived: waived,
        waiverReason: waived ? clean(input.waiverReason) : null,
        createdById: actor.employeeId,
      },
    });
    // History: ACTIVE from Date START, then the non-active status where applicable.
    const periods: { status: ClientStatus; from: ISODate; to: ISODate | null; fromStatus: ClientStatus | null }[] = [];
    if (input.status === "ACTIVE") periods.push({ status: "ACTIVE", from: input.dateStart, to: null, fromStatus: null });
    else if (input.status === "INACTIVE") {
      periods.push({ status: "ACTIVE", from: input.dateStart, to: dateOff!, fromStatus: null });
      periods.push({ status: "INACTIVE", from: addDays(dateOff!, 1), to: null, fromStatus: "ACTIVE" });
    } else {
      const eff = clean(input.statusEffectiveDate) ?? today;
      if (eff < input.dateStart || eff > today) throw invalid("The freeze date must be between Date START and today.");
      if (eff > input.dateStart) periods.push({ status: "ACTIVE", from: input.dateStart, to: addDays(eff, -1), fromStatus: null });
      periods.push({ status: "FREEZE", from: eff, to: null, fromStatus: eff > input.dateStart ? "ACTIVE" : null });
    }
    for (const p of periods)
      await tx.clientStatusHistory.create({
        data: { brandId: brand.id, status: p.status, fromStatus: p.fromStatus, effectiveFrom: fromISO(p.from), effectiveTo: p.to ? fromISO(p.to) : null, changedById: actor.employeeId, reason: "Client created" },
      });
    const engagement = await tx.clientEngagement.create({
      data: { brandId: brand.id, startDate: fromISO(input.dateStart), endDate: input.status === "INACTIVE" ? fromISO(dateOff!) : null },
    });
    await tx.clientEngagementPackage.create({
      data: { engagementId: engagement.id, packageId: input.packageId, effectiveFrom: fromISO(input.dateStart), effectiveTo: input.status === "INACTIVE" ? fromISO(dateOff!) : null, changedById: actor.employeeId },
    });
    await syncAdAccounts(tx, brand.id, input.adAccounts ?? []);
    const assignFrom = input.dateStart > today ? input.dateStart : today;
    await assertEmployees(tx, teamRows(input.team).map((r) => r.employeeId));
    for (const r of teamRows(input.team))
      await tx.clientTeamAssignment.create({ data: { brandId: brand.id, employeeId: r.employeeId, role: r.role, effectiveFrom: fromISO(assignFrom), assignedById: actor.employeeId } });
    await audit(tx, { actorUserId: actor.userId, action: "client.create", entityType: "ClientBrand", entityId: brand.id, after: { ...brand, packageId: input.packageId, team: input.team } });
    return brand;
  });
}

export async function updateClient(actor: CurrentUser, id: string, input: UpdateClientInput) {
  if (!canManageClients(actor)) throw forbidden();
  validateInfo(input);
  const today = todayJakarta();
  const settings = await getSettings();
  const waived = !!input.waivePrimary;
  if (waived && !clean(input.waiverReason)) throw invalid("Give a reason for the Consultant 1 exception.");

  return withTx(async (tx) => {
    await lockBrand(tx, id);
    const before = await tx.clientBrand.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw notFound("Client");
    const nextStatus = input.status?.status ?? before.status;
    const errs = validateTeam(input.team, { status: nextStatus, requirePrimary: settings.clientRequirePrimaryConsultant, waived });
    if (errs.length) throw invalid(errs.join(" "));
    const canSensitive = await canSeeClientSensitive(actor, id, tx);

    // Client ID: changes need elevated rights; the old ID is retired, never reused.
    const code = input.clientCode.trim().toUpperCase();
    if (code !== before.clientCode) {
      if (!can(actor, "settings.manage")) throw forbidden("Changing a Client ID requires administrator rights.");
      await assertCodeFree(tx, code, id);
      await tx.clientCodeAlias.upsert({ where: { code: before.clientCode }, create: { code: before.clientCode, brandId: id }, update: {} });
    }

    // Date START: moves the first status period / engagement / package row with it.
    if (input.dateStart !== toISO(before.dateStart)) {
      if (!isValidISO(input.dateStart)) throw invalid("Date START is invalid.");
      await moveDateStart(tx, id, toISO(before.dateStart), input.dateStart);
    }

    const brand = await tx.clientBrand.update({
      where: { id },
      data: {
        clientCode: code,
        organizationId: await organizationId(tx, input.organizationName),
        ...infoData(input, canSensitive),
        ...(await resolveTaxonomy(tx, input)),
        dateStart: fromISO(input.dateStart),
        primaryConsultantWaived: waived,
        waiverReason: waived ? clean(input.waiverReason) : null,
      },
    });

    if (input.status && input.status.status !== before.status) await applyStatusChange(tx, actor, brand.id, input.status, input.packageId);
    await changePackage(tx, actor, id, input.packageId, today);
    await syncAdAccounts(tx, id, input.adAccounts);
    const teamFrom = input.teamEffectiveDate || today;
    if (!isValidISO(teamFrom) || teamFrom > today) throw invalid("The team change date can't be in the future.");
    if (teamFrom < input.dateStart) throw invalid("The team change date can't be before Date START.");
    const teamChanges = await syncTeam(tx, actor, id, input.team, teamFrom);
    await audit(tx, { actorUserId: actor.userId, action: "client.update", entityType: "ClientBrand", entityId: id, before, after: brand, metadata: { teamChanges } });
    return brand;
  });
}

async function moveDateStart(tx: Tx, brandId: string, oldStart: ISODate, newStart: ISODate) {
  const first = await tx.clientStatusHistory.findFirst({ where: { brandId }, orderBy: { effectiveFrom: "asc" } });
  if (first?.effectiveTo && newStart > toISO(first.effectiveTo)) throw invalid("Date START must be before the first status change.");
  const brand = await tx.clientBrand.findUniqueOrThrow({ where: { id: brandId } });
  if (brand.dateOff && newStart > toISO(brand.dateOff)) throw invalid("Date START can't be after Date OFF.");
  if (first && toISO(first.effectiveFrom) === oldStart) await tx.clientStatusHistory.update({ where: { id: first.id }, data: { effectiveFrom: fromISO(newStart) } });
  const eng = await tx.clientEngagement.findFirst({ where: { brandId }, orderBy: { startDate: "asc" }, include: { packages: { orderBy: { effectiveFrom: "asc" }, take: 1 } } });
  if (eng && toISO(eng.startDate) === oldStart) {
    await tx.clientEngagement.update({ where: { id: eng.id }, data: { startDate: fromISO(newStart) } });
    const p = eng.packages[0];
    if (p && toISO(p.effectiveFrom) === oldStart) {
      if (p.effectiveTo && newStart > toISO(p.effectiveTo)) throw invalid("Date START must be before the first package change.");
      await tx.clientEngagementPackage.update({ where: { id: p.id }, data: { effectiveFrom: fromISO(newStart) } });
    }
  }
}

async function changePackage(tx: Tx, actor: CurrentUser, brandId: string, packageId: string, today: ISODate) {
  const eng = await tx.clientEngagement.findFirst({ where: { brandId }, orderBy: { startDate: "desc" }, include: { packages: { where: { effectiveTo: null } } } });
  if (!eng) return;
  const open = eng.packages[0];
  if (open?.packageId === packageId) return;
  await assertPackage(tx, packageId);
  if (eng.endDate) {
    // Inactive: correct the package of the last engagement in place (no new period starts).
    const last = await tx.clientEngagementPackage.findFirst({ where: { engagementId: eng.id }, orderBy: { effectiveFrom: "desc" } });
    if (last && last.packageId !== packageId) await tx.clientEngagementPackage.update({ where: { id: last.id }, data: { packageId, changedById: actor.employeeId } });
    return;
  }
  if (open) {
    const from = toISO(open.effectiveFrom);
    if (from >= today) {
      await tx.clientEngagementPackage.update({ where: { id: open.id }, data: { packageId, changedById: actor.employeeId } });
      return;
    }
    await tx.clientEngagementPackage.update({ where: { id: open.id }, data: { effectiveTo: fromISO(addDays(today, -1)) } });
  }
  await tx.clientEngagementPackage.create({ data: { engagementId: eng.id, packageId, effectiveFrom: fromISO(today), changedById: actor.employeeId } });
}

// ───────────────────────────── Status ─────────────────────────────

export interface StatusChangeInput {
  status: ClientStatusT;
  /** Day the new status starts (Active / Freeze). Defaults to today. */
  effectiveDate?: ISODate | null;
  /** Last day of collaboration — required for Inactive. */
  dateOff?: ISODate | null;
  reason?: string | null;
}

export async function changeClientStatus(actor: CurrentUser, id: string, input: StatusChangeInput) {
  if (!canManageClients(actor)) throw forbidden();
  return withTx(async (tx) => {
    await lockBrand(tx, id);
    const before = await tx.clientBrand.findUnique({ where: { id } });
    if (!before || before.archivedAt) throw notFound("Client");
    if (input.status === before.status) throw invalid(`The client is already ${input.status.toLowerCase()}.`);
    if (input.status === "ACTIVE") {
      const settings = await getSettings(tx);
      const primary = await tx.clientTeamAssignment.count({ where: { brandId: id, role: "CONSULTANT_PRIMARY", effectiveTo: null } });
      if (settings.clientRequirePrimaryConsultant && !primary && !before.primaryConsultantWaived) throw invalid("Assign Consultant 1 (or record an exception) before activating the client.");
    }
    await applyStatusChange(tx, actor, id, input, null);
    const after = await tx.clientBrand.findUniqueOrThrow({ where: { id } });
    await audit(tx, { actorUserId: actor.userId, action: "client.status.change", entityType: "ClientBrand", entityId: id, before: { status: before.status, dateOff: before.dateOff }, after: { status: after.status, dateOff: after.dateOff }, metadata: input });
    return after;
  });
}

/**
 * Closes the open status period and opens the new one. Inactive closes the engagement (Date OFF);
 * reactivation opens a new engagement and keeps the original Date START.
 */
async function applyStatusChange(tx: Tx, actor: CurrentUser, brandId: string, input: StatusChangeInput, packageId: string | null) {
  const today = todayJakarta();
  const brand = await tx.clientBrand.findUniqueOrThrow({ where: { id: brandId } });
  const open = await tx.clientStatusHistory.findFirst({ where: { brandId, effectiveTo: null } });
  if (!open) throw conflict("This client has no open status period.");
  const openFrom = toISO(open.effectiveFrom);
  if (brand.status === "INACTIVE" && input.status === "FREEZE") throw invalid("Reactivate the client before freezing it.");

  let from: ISODate;
  let dateOff: ISODate | null = null;
  if (input.status === "INACTIVE") {
    dateOff = clean(input.dateOff);
    if (!dateOff || !isValidISO(dateOff)) throw invalid("Date OFF is required when a client becomes inactive.");
    if (dateOff < toISO(brand.dateStart)) throw invalid("Date OFF can't be earlier than Date START.");
    if (dateOff > today) throw invalid("Date OFF can't be in the future.");
    if (dateOff < openFrom) throw invalid(`Date OFF can't be before the current ${open.status.toLowerCase()} period started (${openFrom}).`);
    from = addDays(dateOff, 1);
  } else {
    from = clean(input.effectiveDate) ?? today;
    if (!isValidISO(from)) throw invalid("Effective date is invalid.");
    if (from > today) throw invalid("The effective date can't be in the future.");
    if (from <= openFrom) throw invalid(`The effective date must be after ${openFrom}, when the current status started.`);
  }

  await tx.clientStatusHistory.update({ where: { id: open.id }, data: { effectiveTo: fromISO(addDays(from, -1)) } });
  await tx.clientStatusHistory.create({
    data: { brandId, fromStatus: brand.status, status: input.status, effectiveFrom: fromISO(from), reason: clean(input.reason), changedById: actor.employeeId },
  });

  const eng = await tx.clientEngagement.findFirst({ where: { brandId }, orderBy: { startDate: "desc" }, include: { packages: { orderBy: { effectiveFrom: "desc" }, take: 1 } } });
  if (input.status === "INACTIVE") {
    if (eng && !eng.endDate) {
      await tx.clientEngagement.update({ where: { id: eng.id }, data: { endDate: fromISO(dateOff!) } });
      await tx.clientEngagementPackage.updateMany({ where: { engagementId: eng.id, effectiveTo: null }, data: { effectiveTo: fromISO(dateOff!) } });
    }
  } else if (brand.status === "INACTIVE") {
    // Reactivation: new engagement, same Date START on the brand.
    const pkgId = packageId ?? eng?.packages[0]?.packageId;
    if (!pkgId) throw invalid("Choose a package for the new engagement.");
    const created = await tx.clientEngagement.create({ data: { brandId, startDate: fromISO(from) } });
    await tx.clientEngagementPackage.create({ data: { engagementId: created.id, packageId: pkgId, effectiveFrom: fromISO(from), changedById: actor.employeeId } });
  }
  await tx.clientBrand.update({ where: { id: brandId }, data: { status: input.status, dateOff: input.status === "INACTIVE" ? fromISO(dateOff!) : null } });
}

/** Soft-delete for records created by mistake. They disappear from directory and counts; history is kept. */
export async function archiveClient(actor: CurrentUser, id: string, reason: string) {
  if (!canManageClients(actor)) throw forbidden();
  if (reason.trim().length < 5) throw invalid("Give a reason (min. 5 characters).");
  return withTx(async (tx) => {
    const b = await tx.clientBrand.findUnique({ where: { id } });
    if (!b || b.archivedAt) throw notFound("Client");
    await tx.clientBrand.update({ where: { id }, data: { archivedAt: new Date() } });
    await audit(tx, { actorUserId: actor.userId, action: "client.archive", entityType: "ClientBrand", entityId: id, before: b, metadata: { reason } });
  });
}

// ───────────────────────────── Reads ─────────────────────────────

const teamInclude = {
  assignments: { where: { effectiveTo: null }, include: { employee: { select: { id: true, fullName: true, jobTitle: true, isActive: true, photoId: true } } }, orderBy: { createdAt: "asc" } },
  engagements: { orderBy: { startDate: "desc" }, take: 1, include: { packages: { orderBy: { effectiveFrom: "desc" }, take: 1, include: { package: true } } } },
  statusHistory: { orderBy: { effectiveFrom: "asc" } },
  organization: true,
  category: { select: { id: true, name: true } },
  industry: { select: { id: true, name: true } },
  subIndustry: { select: { id: true, name: true } },
  adAccounts: { include: { type: { select: { id: true, name: true, sortOrder: true } } } },
} satisfies Prisma.ClientBrandInclude;

type BrandWithTeam = Prisma.ClientBrandGetPayload<{ include: typeof teamInclude }>;

const periods = (b: BrandWithTeam): StatusPeriod[] => b.statusHistory.map((h) => ({ status: h.status, from: toISO(h.effectiveFrom), to: h.effectiveTo ? toISO(h.effectiveTo) : null }));

function shape(b: BrandWithTeam, today: ISODate) {
  const people = (role: ClientRole) => b.assignments.filter((a) => a.role === role).map((a) => ({ id: a.employee.id, name: a.employee.fullName, title: a.employee.jobTitle, isActive: a.employee.isActive, photoId: a.employee.photoId }));
  const pkg = b.engagements[0]?.packages[0]?.package ?? null;
  const dateStart = toISO(b.dateStart);
  const dateOff = b.dateOff ? toISO(b.dateOff) : null;
  return {
    id: b.id,
    clientCode: b.clientCode,
    name: b.name,
    organization: b.organization?.name ?? null,
    status: b.status as ClientStatusT,
    dateStart,
    dateOff,
    category: b.category?.name ?? null,
    categoryId: b.category?.id ?? null,
    industry: b.industry?.name ?? null,
    industryId: b.industry?.id ?? null,
    subIndustry: b.subIndustry?.name ?? null,
    adAccounts: b.adAccounts.map((a) => a.type).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name)).map((t) => t.name),
    package: pkg ? { id: pkg.id, name: pkg.name, isActive: pkg.isActive } : null,
    consultant1: people("CONSULTANT_PRIMARY")[0] ?? null,
    consultant2: people("CONSULTANT_SECONDARY")[0] ?? null,
    additional: people("CONSULTANT_ADDITIONAL"),
    adsStrategists: people("ADS_STRATEGIST"),
    period: collaborationPeriod({ status: b.status, dateStart, dateOff, history: periods(b) }, today),
  };
}
export type ClientRow = ReturnType<typeof shape>;

export interface ClientFilters {
  q?: string;
  status?: ClientStatusT | "ALL";
  packageId?: string;
  consultantId?: string;
  asId?: string;
  categoryId?: string;
  industryId?: string;
  adAccountId?: string;
  sort?: "name" | "start_desc" | "start_asc" | "period_desc" | "period_asc" | "code";
  page?: number;
  pageSize?: number;
}

export async function listClients(_viewer: CurrentUser, f: ClientFilters = {}) {
  const today = todayJakarta();
  const q = f.q?.trim();
  const brands = await db.clientBrand.findMany({
    where: {
      archivedAt: null,
      ...(f.status && f.status !== "ALL" ? { status: f.status } : {}),
      ...(f.categoryId ? { categoryId: f.categoryId } : {}),
      ...(f.industryId ? { industryId: f.industryId } : {}),
      ...(f.adAccountId ? { adAccounts: { some: { typeId: f.adAccountId } } } : {}),
      ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { clientCode: { contains: q, mode: "insensitive" } }] } : {}),
    },
    include: teamInclude,
    orderBy: { name: "asc" },
  });
  let rows = brands.map((b) => shape(b, today));
  if (f.packageId) rows = rows.filter((r) => r.package?.id === f.packageId);
  if (f.consultantId) rows = rows.filter((r) => [r.consultant1, r.consultant2, ...r.additional].some((p) => p?.id === f.consultantId));
  if (f.asId) rows = rows.filter((r) => r.adsStrategists.some((p) => p.id === f.asId));
  const days = (r: ClientRow) => Date.parse(r.period.end) - Date.parse(r.dateStart);
  const sorters: Record<NonNullable<ClientFilters["sort"]>, (a: ClientRow, b: ClientRow) => number> = {
    name: (a, b) => a.name.localeCompare(b.name),
    code: (a, b) => a.clientCode.localeCompare(b.clientCode),
    start_desc: (a, b) => b.dateStart.localeCompare(a.dateStart),
    start_asc: (a, b) => a.dateStart.localeCompare(b.dateStart),
    period_desc: (a, b) => days(b) - days(a),
    period_asc: (a, b) => days(a) - days(b),
  };
  rows.sort(sorters[f.sort ?? "name"]);
  const pageSize = Math.min(100, Math.max(5, f.pageSize ?? 20));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pages, Math.max(1, f.page ?? 1));
  return { rows: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pages, pageSize, all: rows };
}

export async function clientFilterOptions() {
  const [packages, taxonomy, adAccounts, people] = await Promise.all([
    listPackages({ includeInactive: true }),
    clientTaxonomy(),
    db.clientAdAccountType.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.clientTeamAssignment.findMany({ where: { effectiveTo: null }, distinct: ["employeeId", "role"], select: { role: true, employee: { select: { id: true, fullName: true } } } }),
  ]);
  const uniq = (roles: ClientRole[]) =>
    [...new Map(people.filter((p) => roles.includes(p.role)).map((p) => [p.employee.id, p.employee])).values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  return {
    packages,
    ...taxonomy,
    adAccounts,
    consultants: uniq(["CONSULTANT_PRIMARY", "CONSULTANT_SECONDARY", "CONSULTANT_ADDITIONAL"]),
    adsStrategists: uniq(["ADS_STRATEGIST"]),
  };
}

export async function getClient(viewer: CurrentUser, id: string) {
  const today = todayJakarta();
  const b = await db.clientBrand.findUnique({
    where: { id },
    include: {
      ...teamInclude,
      codeAliases: true,
      statusHistory: { orderBy: { effectiveFrom: "asc" }, include: { changedBy: { select: { id: true, fullName: true } } } },
    },
  });
  if (!b || b.archivedAt) throw notFound("Client");
  const sensitive = await canSeeClientSensitive(viewer, id);
  const [engagements, assignmentHistory] = await Promise.all([
    db.clientEngagement.findMany({ where: { brandId: id }, orderBy: { startDate: "asc" }, include: { packages: { orderBy: { effectiveFrom: "asc" }, include: { package: true } } } }),
    db.clientTeamAssignment.findMany({ where: { brandId: id }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], include: { employee: { select: { id: true, fullName: true, email: true, employeeCode: true } } } }),
  ]);
  return {
    ...shape(b as unknown as BrandWithTeam, today),
    description: b.description,
    websiteUrl: b.websiteUrl,
    instagramUrl: b.instagramUrl,
    tiktokUrl: b.tiktokUrl,
    picName: sensitive ? b.picName : null,
    picPhone: sensitive ? b.picPhone : null,
    picEmail: sensitive ? b.picEmail : null,
    internalNotes: sensitive ? b.internalNotes : null,
    sensitiveVisible: sensitive,
    primaryConsultantWaived: b.primaryConsultantWaived,
    waiverReason: b.waiverReason,
    retiredCodes: b.codeAliases.map((a) => a.code),
    statusHistory: b.statusHistory.map((h) => ({
      id: h.id,
      fromStatus: h.fromStatus,
      status: h.status,
      from: toISO(h.effectiveFrom),
      to: h.effectiveTo ? toISO(h.effectiveTo) : null,
      reason: h.reason,
      by: h.changedBy?.fullName ?? null,
      at: h.createdAt,
    })),
    engagements: engagements.map((e) => ({
      id: e.id,
      start: toISO(e.startDate),
      end: e.endDate ? toISO(e.endDate) : null,
      packages: e.packages.map((p) => ({ id: p.id, name: p.package.name, from: toISO(p.effectiveFrom), to: p.effectiveTo ? toISO(p.effectiveTo) : null })),
    })),
    assignmentHistory: assignmentHistory.map((a) => ({ id: a.id, employee: a.employee, role: a.role, from: toISO(a.effectiveFrom), to: a.effectiveTo ? toISO(a.effectiveTo) : null })),
  };
}
export type ClientDetail = Awaited<ReturnType<typeof getClient>>;

/** Clients an employee is currently assigned to (same assignment records as the client page). */
export async function clientsForEmployee(employeeId: string) {
  const rows = await db.clientTeamAssignment.findMany({
    where: { employeeId, effectiveTo: null, brand: { archivedAt: null } },
    include: { brand: { select: { id: true, name: true, clientCode: true, status: true } } },
    orderBy: { brand: { name: "asc" } },
  });
  return rows.map((r) => ({ id: r.brand.id, name: r.brand.name, clientCode: r.brand.clientCode, status: r.brand.status as ClientStatusT, role: r.role, since: toISO(r.effectiveFrom) }));
}

/** Active employees for consultant / AS pickers (from the Team Directory). */
export async function assignableEmployees() {
  return db.employee.findMany({ where: { isActive: true }, select: { id: true, fullName: true, jobTitle: true }, orderBy: { fullName: "asc" } });
}

/** CSV columns shared by export, the import template and the importer (extra columns are ignored on import). */
export const CLIENT_CSV_COLUMNS = [
  "client_id",
  "brand_name",
  "client_organization",
  "status",
  "date_start",
  "date_off",
  "package",
  "category",
  "industry",
  "sub_industry",
  "ad_accounts",
  "consultant_1",
  "consultant_2",
  "additional_consultants",
  "ads_strategists",
  "website_url",
  "instagram_url",
  "tiktok_url",
  "pic_name",
  "pic_phone",
  "pic_email",
  "brand_description",
  "internal_notes",
] as const;

export const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // spreadsheet formula injection
  return /[",\n;]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Export: people are written as work emails so the file can be re-imported. PIC data only when allowed. */
export async function clientsExportCsv(viewer: CurrentUser, rows: ClientRow[]) {
  const ids = rows.map((r) => r.id);
  const [extra, people] = await Promise.all([
    db.clientBrand.findMany({ where: { id: { in: ids } }, select: { id: true, description: true, websiteUrl: true, instagramUrl: true, tiktokUrl: true, picName: true, picPhone: true, picEmail: true, internalNotes: true } }),
    db.employee.findMany({ select: { id: true, email: true } }),
  ]);
  const sensitiveAll = can(viewer, "client.sensitive");
  const mine = new Set((await db.clientTeamAssignment.findMany({ where: { employeeId: viewer.employeeId, effectiveTo: null }, select: { brandId: true } })).map((a) => a.brandId));
  const email = new Map(people.map((p) => [p.id, p.email]));
  const lines = rows.map((r) => {
    const x = extra.find((e) => e.id === r.id)!;
    const sens = sensitiveAll || mine.has(r.id);
    const values: Record<(typeof CLIENT_CSV_COLUMNS)[number], unknown> = {
      client_id: r.clientCode,
      brand_name: r.name,
      client_organization: r.organization,
      status: r.status,
      date_start: r.dateStart,
      date_off: r.dateOff,
      package: r.package?.name,
      category: r.category,
      industry: r.industry,
      sub_industry: r.subIndustry,
      ad_accounts: r.adAccounts.join("; "),
      consultant_1: r.consultant1 && email.get(r.consultant1.id),
      consultant_2: r.consultant2 && email.get(r.consultant2.id),
      additional_consultants: r.additional.map((p) => email.get(p.id)).join("; "),
      ads_strategists: r.adsStrategists.map((p) => email.get(p.id)).join("; "),
      website_url: x.websiteUrl,
      instagram_url: x.instagramUrl,
      tiktok_url: x.tiktokUrl,
      pic_name: sens ? x.picName : "",
      pic_phone: sens ? x.picPhone : "",
      pic_email: sens ? x.picEmail : "",
      brand_description: x.description,
      internal_notes: sens ? x.internalNotes : "",
    };
    return [...CLIENT_CSV_COLUMNS.map((c) => csvCell(values[c])), csvCell(r.period.label)].join(",");
  });
  return [[...CLIENT_CSV_COLUMNS, "period"].join(","), ...lines].join("\n");
}

// ───────────────────────────── Taxonomy & ad accounts ─────────────────────────────

export async function clientTaxonomy() {
  const [categories, industries] = await Promise.all([
    db.clientCategory.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.clientIndustry.findMany({ include: { subIndustries: { orderBy: { name: "asc" } }, _count: { select: { brands: true } } }, orderBy: { name: "asc" } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: c.name, isActive: c.isActive, sortOrder: c.sortOrder })),
    industries: industries.map((i) => ({ id: i.id, name: i.name, categoryId: i.categoryId, brands: i._count.brands, subIndustries: i.subIndustries.map((x) => ({ id: x.id, name: x.name })) })),
  };
}

const requirePackageAdmin = (u: CurrentUser) => {
  if (!can(u, "clientPackage.manage")) throw forbidden();
};

export async function upsertCategory(actor: CurrentUser, input: { id?: string; name: string; isActive: boolean; sortOrder: number }) {
  requirePackageAdmin(actor);
  const name = input.name.trim();
  if (name.length < 2) throw invalid("Category name is required.");
  return withTx(async (tx) => {
    const dup = await tx.clientCategory.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: input.id ? { id: input.id } : undefined } });
    if (dup) throw conflict(`Category “${dup.name}” already exists.`);
    const data = { name, isActive: input.isActive, sortOrder: input.sortOrder };
    const saved = input.id ? await tx.clientCategory.update({ where: { id: input.id }, data }) : await tx.clientCategory.create({ data });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "client.category.update" : "client.category.create", entityType: "ClientCategory", entityId: saved.id, after: saved });
    return saved;
  });
}

export async function upsertAdAccountType(actor: CurrentUser, input: { id?: string; name: string; isActive: boolean; sortOrder: number }) {
  requirePackageAdmin(actor);
  const name = input.name.trim();
  if (name.length < 2) throw invalid("Ad account name is required.");
  return withTx(async (tx) => {
    const dup = await tx.clientAdAccountType.findFirst({ where: { name: { equals: name, mode: "insensitive" }, NOT: input.id ? { id: input.id } : undefined } });
    if (dup) throw conflict(`“${dup.name}” already exists.`);
    const data = { name, isActive: input.isActive, sortOrder: input.sortOrder };
    const saved = input.id ? await tx.clientAdAccountType.update({ where: { id: input.id }, data }) : await tx.clientAdAccountType.create({ data });
    await audit(tx, { actorUserId: actor.userId, action: input.id ? "client.adaccount.update" : "client.adaccount.create", entityType: "ClientAdAccountType", entityId: saved.id, after: saved });
    return saved;
  });
}

/** Rename or re-file an industry / sub-industry; unused ones can be deleted. */
export async function updateIndustry(actor: CurrentUser, input: { kind: "industry" | "sub"; id: string; name?: string; categoryId?: string | null; remove?: boolean }) {
  requirePackageAdmin(actor);
  return withTx(async (tx) => {
    if (input.kind === "industry") {
      const ind = await tx.clientIndustry.findUnique({ where: { id: input.id }, include: { _count: { select: { brands: true, subIndustries: true } } } });
      if (!ind) throw notFound("Industry");
      if (input.remove) {
        if (ind._count.brands || ind._count.subIndustries) throw conflict("This industry is still used by clients or has sub-industries.");
        await tx.clientIndustry.delete({ where: { id: ind.id } });
      } else {
        const name = input.name?.trim() || ind.name;
        const categoryId = input.categoryId === undefined ? ind.categoryId : input.categoryId;
        await tx.clientIndustry.update({ where: { id: ind.id }, data: { name, categoryId } });
        // keep brands in step with the industry's category
        if (categoryId !== ind.categoryId) await tx.clientBrand.updateMany({ where: { industryId: ind.id }, data: { categoryId } });
      }
      await audit(tx, { actorUserId: actor.userId, action: input.remove ? "client.industry.delete" : "client.industry.update", entityType: "ClientIndustry", entityId: ind.id, before: ind, after: input });
    } else {
      const sub = await tx.clientSubIndustry.findUnique({ where: { id: input.id }, include: { _count: { select: { brands: true } } } });
      if (!sub) throw notFound("Sub-industry");
      if (input.remove) {
        if (sub._count.brands) throw conflict("This sub-industry is still used by clients.");
        await tx.clientSubIndustry.delete({ where: { id: sub.id } });
      } else if (input.name?.trim()) await tx.clientSubIndustry.update({ where: { id: sub.id }, data: { name: input.name.trim() } });
      await audit(tx, { actorUserId: actor.userId, action: input.remove ? "client.subindustry.delete" : "client.subindustry.update", entityType: "ClientSubIndustry", entityId: sub.id, before: sub, after: input });
    }
  });
}
