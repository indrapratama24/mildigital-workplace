// People data: company-wide directory, personal/HR profile data, field-level visibility and self-service.
// Every field shown to a viewer passes through `canSeeField` on the server — the UI never receives data
// it isn't allowed to display. Identity and bank numbers are encrypted and masked; full values are only
// returned by `revealSensitive`, which is audit-logged.
import type { MaritalStatus } from "@prisma/client";
import { db, withTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { blindIndex, decrypt, encrypt, last4, mask } from "../crypto";
import { audit } from "./audit";
import { effectiveOn } from "./org";
import { addDays, formatDate, fromISO, isValidISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";

// ───────────────────────────── Field visibility ─────────────────────────────

export type Audience = "EVERYONE" | "SAME_TEAM" | "LEADERS" | "HR";
export const AUDIENCE_RANK: Record<Audience, number> = { HR: 1, LEADERS: 2, SAME_TEAM: 3, EVERYONE: 4 };
export const AUDIENCE_LABEL: Record<Audience, string> = {
  EVERYONE: "Everyone at MIL",
  SAME_TEAM: "Same team (+ leaders & HR)",
  LEADERS: "Their leaders & HR",
  HR: "HR only",
};

export const DIRECTORY_FIELDS = {
  email: { label: "Work email", group: "Contact", default: "EVERYONE", max: "EVERYONE" },
  phone: { label: "Phone number", group: "Contact", default: "SAME_TEAM", max: "EVERYONE" },
  personalEmail: { label: "Personal email", group: "Contact", default: "HR", max: "LEADERS" },
  joinDate: { label: "Join date & tenure", group: "Employment", default: "EVERYONE", max: "EVERYONE" },
  employmentStatus: { label: "Employment status", group: "Employment", default: "LEADERS", max: "EVERYONE" },
  birthday: { label: "Birthday (day & month)", group: "Personal", default: "EVERYONE", max: "EVERYONE" },
  birthYear: { label: "Birth year, age & place", group: "Personal", default: "HR", max: "LEADERS" },
  address: { label: "Addresses (KTP & domicile)", group: "Personal", default: "HR", max: "LEADERS" },
  emergencyContact: { label: "Emergency contact", group: "Personal", default: "LEADERS", max: "SAME_TEAM" },
  family: { label: "Marital status, dependents & PTKP", group: "HR & payroll", default: "HR", max: "HR" },
  identity: { label: "NIK & NPWP", group: "HR & payroll", default: "HR", max: "HR" },
  bank: { label: "Bank account", group: "HR & payroll", default: "HR", max: "HR" },
} as const satisfies Record<string, { label: string; group: string; default: Audience; max: Audience }>;
export type DirectoryField = keyof typeof DIRECTORY_FIELDS;
export type VisibilityMap = Record<DirectoryField, Audience>;

const SETTING_KEY = "directoryFieldVisibility";

export async function getVisibility(): Promise<VisibilityMap> {
  const row = await db.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  const stored = (row?.value ?? {}) as Partial<Record<string, Audience>>;
  const out = {} as VisibilityMap;
  for (const [f, def] of Object.entries(DIRECTORY_FIELDS) as [DirectoryField, (typeof DIRECTORY_FIELDS)[DirectoryField]][]) {
    const v = stored[f];
    // never more open than the field's maximum (identity, bank and family data are locked to HR)
    out[f] = v && AUDIENCE_RANK[v] && AUDIENCE_RANK[v] <= AUDIENCE_RANK[def.max] ? v : def.default;
  }
  return out;
}

export async function setVisibility(actor: CurrentUser, patch: Partial<VisibilityMap>) {
  if (!can(actor, "employee.manage")) throw forbidden("Only HR and admins manage directory visibility.");
  const before = await getVisibility();
  const next = { ...before };
  for (const [f, v] of Object.entries(patch) as [DirectoryField, Audience][]) {
    const def = DIRECTORY_FIELDS[f];
    if (!def || !AUDIENCE_RANK[v]) throw invalid("Unknown field or audience.");
    if (AUDIENCE_RANK[v] > AUDIENCE_RANK[def.max]) throw invalid(`${def.label} can be shared with “${AUDIENCE_LABEL[def.max]}” at most.`);
    next[f] = v;
  }
  await withTx(async (tx) => {
    await tx.systemSetting.upsert({ where: { key: SETTING_KEY }, create: { key: SETTING_KEY, value: next, updatedById: actor.userId }, update: { value: next, updatedById: actor.userId } });
    await audit(tx, { actorUserId: actor.userId, action: "directory.visibility.update", entityType: "SystemSetting", entityId: SETTING_KEY, before, after: next });
  });
  return next;
}

interface ViewerContext {
  employeeId: string;
  isHR: boolean;
  teamIds: Set<string>;
  reportIds: Set<string>;
}

async function viewerContext(viewer: CurrentUser): Promise<ViewerContext> {
  const today = todayJakarta();
  const [teams, reports] = await Promise.all([
    db.employeeTeamMembership.findMany({ where: { employeeId: viewer.employeeId, ...effectiveOn(today) }, select: { teamId: true } }),
    db.reportingRelationship.findMany({ where: { leaderId: viewer.employeeId, ...effectiveOn(today) }, select: { employeeId: true } }),
  ]);
  return { employeeId: viewer.employeeId, isHR: can(viewer, "employee.manage"), teamIds: new Set(teams.map((t) => t.teamId)), reportIds: new Set(reports.map((r) => r.employeeId)) };
}

export function canSeeField(ctx: ViewerContext, vis: VisibilityMap, field: DirectoryField, subject: { id: string; teamIds: string[] }) {
  if (subject.id === ctx.employeeId || ctx.isHR) return true;
  const a = vis[field];
  if (a === "HR") return false;
  if (ctx.reportIds.has(subject.id)) return true; // LEADERS and wider
  if (a === "LEADERS") return false;
  if (a === "SAME_TEAM") return subject.teamIds.some((t) => ctx.teamIds.has(t));
  return true;
}

// ───────────────────────────── Helpers ─────────────────────────────

export function tenure(start: ISODate, today: ISODate = todayJakarta()) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let months = (ty - sy) * 12 + (tm - sm) - (td < sd ? 1 : 0);
  if (months < 0) months = 0;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const label = start > today ? "Starts soon" : years ? `${years} yr${years > 1 ? "s" : ""}${rest ? ` ${rest} mo` : ""}` : rest ? `${rest} mo` : "< 1 mo";
  return { years, months, label };
}

/** PTKP code used for PPh 21 (TK/0 … K/3). Final status should be confirmed by HR/tax. */
export function ptkp(marital: MaritalStatus | null | undefined, dependents: number) {
  if (!marital) return null;
  return `${marital === "MARRIED" ? "K" : "TK"}/${Math.min(3, Math.max(0, dependents))}`;
}

const BIRTHDAY_FMT = new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "short", timeZone: "UTC" });
export const formatBirthday = (d: ISODate) => BIRTHDAY_FMT.format(fromISO(d));

function nextOccurrence(monthDay: string, today: ISODate) {
  const y = Number(today.slice(0, 4));
  let d = `${y}-${monthDay}`;
  if (monthDay === "02-29" && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0))) d = `${y}-02-28`;
  return d < today ? `${y + 1}-${monthDay === "02-29" ? "02-28" : monthDay}` : d;
}

// ───────────────────────────── Directory list ─────────────────────────────

export interface DirectoryFilters {
  q?: string;
  teamId?: string;
  levelId?: string;
  leaderId?: string;
  departmentId?: string;
  /** Job title (the person's role in the company). */
  jobTitle?: string;
  employmentStatus?: string;
  status?: "active" | "inactive" | "all";
}

export async function listDirectory(viewer: CurrentUser, f: DirectoryFilters = {}) {
  const today = todayJakarta();
  const [ctx, vis] = await Promise.all([viewerContext(viewer), getVisibility()]);
  const status = ctx.isHR ? f.status ?? "active" : "active"; // only HR sees inactive people
  const employees = await db.employee.findMany({
    where: {
      isActive: status === "all" ? undefined : status === "active",
      ...(f.q ? { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeCode: { contains: f.q, mode: "insensitive" } }, { jobTitle: { contains: f.q, mode: "insensitive" } }] } : {}),
      memberships: f.teamId ? { some: { teamId: f.teamId, ...effectiveOn(today) } } : undefined,
      levelAssignments: f.levelId ? { some: { levelId: f.levelId, ...effectiveOn(today) } } : undefined,
      reportsTo: f.leaderId ? { some: { leaderId: f.leaderId, ...effectiveOn(today) } } : undefined,
      ...(f.departmentId ? { departmentId: f.departmentId } : {}),
      ...(f.jobTitle ? { jobTitle: f.jobTitle } : {}),
    },
    include: {
      user: { select: { role: true } },
      department: { select: { name: true } },
      memberships: { where: effectiveOn(today), include: { team: { select: { id: true, name: true } } }, orderBy: { isPrimary: "desc" } },
      levelAssignments: { where: effectiveOn(today), include: { level: { select: { name: true } } } },
      reportsTo: { where: { type: "PRIMARY", ...effectiveOn(today) }, include: { leader: { select: { id: true, fullName: true } } } },
      personalData: true,
    },
    orderBy: { fullName: "asc" },
  });
  const rows = employees.map((e) => {
    const subject = { id: e.id, teamIds: e.memberships.map((m) => m.teamId) };
    const see = (fld: DirectoryField) => canSeeField(ctx, vis, fld, subject);
    const p = e.personalData;
    const start = toISO(e.startDate);
    const birth = p?.birthDate ? toISO(p.birthDate) : null;
    const completeness = ctx.isHR ? profileCompleteness(p) : null;
    return {
      id: e.id,
      code: e.employeeCode,
      name: e.fullName,
      title: e.jobTitle,
      isActive: e.isActive,
      role: e.user?.role ?? null,
      photoId: e.photoId,
      department: e.department?.name ?? null,
      team: e.memberships[0]?.team.name ?? null,
      level: e.levelAssignments[0]?.level.name ?? null,
      leader: e.reportsTo[0]?.leader ?? null,
      email: see("email") ? e.email : null,
      phone: see("phone") ? p?.phone ?? null : null,
      joinDate: see("joinDate") ? start : null,
      tenure: see("joinDate") ? tenure(start, today) : null,
      birthday: see("birthday") && birth ? { monthDay: birth.slice(5), label: formatBirthday(birth) } : null,
      employmentStatus: see("employmentStatus") ? e.employmentStatus : null,
      completeness,
    };
  });

  const filtered = f.employmentStatus ? rows.filter((r) => r.employmentStatus === f.employmentStatus) : rows;

  // Highlights (respecting visibility)
  const month = today.slice(5, 7);
  const birthdays = rows
    .filter((r) => r.isActive && r.birthday)
    .map((r) => ({ ...r, next: nextOccurrence(r.birthday!.monthDay, today) }))
    .filter((r) => r.next <= addDays(today, 30))
    .sort((a, b) => a.next.localeCompare(b.next));
  const anniversaries = rows
    .filter((r) => r.isActive && r.joinDate && r.joinDate.slice(5, 7) === month && r.joinDate.slice(0, 4) < today.slice(0, 4))
    .map((r) => ({ ...r, years: Number(today.slice(0, 4)) - Number(r.joinDate!.slice(0, 4)) }))
    .sort((a, b) => a.joinDate!.slice(5).localeCompare(b.joinDate!.slice(5)));
  const newJoiners = rows.filter((r) => r.isActive && r.joinDate && r.joinDate >= addDays(today, -90)).sort((a, b) => b.joinDate!.localeCompare(a.joinDate!));
  const teams = new Map<string, number>();
  for (const r of rows.filter((x) => x.isActive)) teams.set(r.team ?? "No team", (teams.get(r.team ?? "No team") ?? 0) + 1);
  const avgTenureMonths = rows.filter((r) => r.isActive && r.tenure).reduce((s, r, _, arr) => s + r.tenure!.months / arr.length, 0);
  return {
    rows: filtered,
    isHR: ctx.isHR,
    visibility: vis,
    highlights: {
      headcount: rows.filter((r) => r.isActive).length,
      teams: [...teams.entries()].sort((a, b) => b[1] - a[1]),
      avgTenure: tenure(addDays(today, -Math.round(avgTenureMonths * 30.44)), today).label,
      birthdays,
      anniversaries,
      newJoiners,
      incompleteProfiles: ctx.isHR ? rows.filter((r) => r.isActive && (r.completeness ?? 100) < 100).length : null,
    },
  };
}
export type DirectoryRow = Awaited<ReturnType<typeof listDirectory>>["rows"][number];

const COMPLETENESS_FIELDS = ["birthDate", "phone", "addressDomicile", "nikEncrypted", "bankAccountEncrypted", "maritalStatus", "emergencyContactPhone"] as const;
function profileCompleteness(p: Record<string, unknown> | null | undefined) {
  if (!p) return 0;
  const filled = COMPLETENESS_FIELDS.filter((k) => p[k] !== null && p[k] !== undefined && p[k] !== "").length;
  return Math.round((filled / COMPLETENESS_FIELDS.length) * 100);
}

// ───────────────────────────── Profile ─────────────────────────────

export async function getProfile(viewer: CurrentUser, employeeId: string) {
  const today = todayJakarta();
  const [ctx, vis] = await Promise.all([viewerContext(viewer), getVisibility()]);
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    include: {
      user: { select: { role: true } },
      department: true,
      memberships: { where: effectiveOn(today), include: { team: true }, orderBy: { isPrimary: "desc" } },
      levelAssignments: { where: effectiveOn(today), include: { level: true } },
      reportsTo: { where: effectiveOn(today), include: { leader: { select: { id: true, fullName: true, jobTitle: true } } } },
      directReports: { where: effectiveOn(today), include: { employee: { select: { id: true, fullName: true, jobTitle: true, isActive: true } } } },
      personalData: true,
    },
  });
  if (!e || (!e.isActive && !ctx.isHR && e.id !== viewer.employeeId)) throw notFound("Employee");
  const subject = { id: e.id, teamIds: e.memberships.map((m) => m.teamId) };
  const see = (f: DirectoryField) => canSeeField(ctx, vis, f, subject);
  const p = e.personalData;
  const isSelf = e.id === viewer.employeeId;
  const birth = p?.birthDate ? toISO(p.birthDate) : null;
  const start = toISO(e.startDate);
  return {
    id: e.id,
    code: e.employeeCode,
    name: e.fullName,
    title: e.jobTitle,
    isActive: e.isActive,
    role: e.user?.role ?? null,
    photoId: e.photoId,
    roleDescription: e.roleDescription,
    department: e.department?.name ?? null,
    teams: e.memberships.map((m) => ({ id: m.team.id, name: m.team.name, primary: m.isPrimary })),
    level: e.levelAssignments[0]?.level.name ?? null,
    leaders: e.reportsTo.map((r) => ({ ...r.leader, type: r.type })),
    directReports: e.directReports.filter((r) => r.employee.isActive).map((r) => r.employee),
    email: see("email") ? e.email : null,
    joinDate: see("joinDate") ? start : null,
    tenure: see("joinDate") ? tenure(start, today) : null,
    employmentStatus: see("employmentStatus") ? e.employmentStatus : null,
    personal: {
      phone: see("phone") ? p?.phone ?? null : undefined,
      personalEmail: see("personalEmail") ? p?.personalEmail ?? null : undefined,
      birthday: see("birthday") ? (birth ? formatBirthday(birth) : null) : undefined,
      birthDate: see("birthYear") ? birth : undefined,
      age: see("birthYear") && birth ? tenure(birth, today).years : undefined,
      birthPlace: see("birthYear") ? p?.birthPlace ?? null : undefined,
      addressKtp: see("address") ? p?.addressKtp ?? null : undefined,
      addressDomicile: see("address") ? p?.addressDomicile ?? null : undefined,
      emergencyContact: see("emergencyContact")
        ? p?.emergencyContactName
          ? { name: p.emergencyContactName, relation: p.emergencyContactRelation, phone: p.emergencyContactPhone }
          : null
        : undefined,
      maritalStatus: see("family") ? p?.maritalStatus ?? null : undefined,
      dependents: see("family") ? p?.dependents ?? 0 : undefined,
      ptkp: see("family") ? ptkp(p?.maritalStatus, p?.dependents ?? 0) : undefined,
      nik: see("identity") ? mask(p?.nikLast4) : undefined,
      npwp: see("identity") ? mask(p?.npwpLast4) : undefined,
      bank: see("bank") ? (p?.bankName || p?.bankAccountLast4 ? { name: p.bankName, account: mask(p.bankAccountLast4), holder: p.bankAccountHolder } : null) : undefined,
    },
    // raw values for edit forms (only for people allowed to edit them; sensitive numbers are never prefilled)
    editable: ctx.isHR || isSelf ? {
      joinDate: start,
      birthDate: birth ?? "",
      birthPlace: p?.birthPlace ?? "",
      phone: p?.phone ?? "",
      personalEmail: p?.personalEmail ?? "",
      addressKtp: p?.addressKtp ?? "",
      addressDomicile: p?.addressDomicile ?? "",
      bankName: p?.bankName ?? "",
      bankAccountHolder: p?.bankAccountHolder ?? "",
      maritalStatus: p?.maritalStatus ?? "",
      dependents: p?.dependents ?? 0,
      emergencyContactName: p?.emergencyContactName ?? "",
      emergencyContactRelation: p?.emergencyContactRelation ?? "",
      emergencyContactPhone: p?.emergencyContactPhone ?? "",
      hasNik: !!p?.nikEncrypted,
      hasNpwp: !!p?.npwpEncrypted,
      hasBankAccount: !!p?.bankAccountEncrypted,
    } : null,
    isSelf,
    canEditAll: ctx.isHR,
    canReveal: ctx.isHR || isSelf,
    completeness: ctx.isHR || isSelf ? profileCompleteness(p) : null,
    updatedAt: p?.updatedAt ?? null,
  };
}
export type Profile = Awaited<ReturnType<typeof getProfile>>;

// ───────────────────────────── Self-service & HR edits ─────────────────────────────

export interface PersonalInput {
  /** HR only: employment start date (join date) */
  joinDate?: string;
  birthDate?: string | null;
  birthPlace?: string | null;
  phone?: string | null;
  personalEmail?: string | null;
  addressKtp?: string | null;
  addressDomicile?: string | null;
  nik?: string | null; // undefined = unchanged, "" = clear
  npwp?: string | null;
  bankName?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolder?: string | null;
  maritalStatus?: MaritalStatus | null;
  dependents?: number;
  emergencyContactName?: string | null;
  emergencyContactRelation?: string | null;
  emergencyContactPhone?: string | null;
}

/** Fields an employee may maintain themselves; everything else (identity, bank, family, birth data) is HR-verified. */
export const SELF_SERVICE_FIELDS: (keyof PersonalInput)[] = ["phone", "personalEmail", "addressDomicile", "emergencyContactName", "emergencyContactRelation", "emergencyContactPhone"];

const PHONE = /^\+?[0-9][0-9\s-]{7,17}$/;
const clean = (v: string | null | undefined) => (v === undefined ? undefined : v === null ? null : v.trim() || null);

export async function updatePersonalData(actor: CurrentUser, employeeId: string, input: PersonalInput) {
  const isHR = can(actor, "employee.manage");
  const isSelf = actor.employeeId === employeeId;
  if (!isHR && !isSelf) throw forbidden();
  if (!isHR) {
    const blocked = (Object.keys(input) as (keyof PersonalInput)[]).filter((k) => input[k] !== undefined && !SELF_SERVICE_FIELDS.includes(k));
    if (blocked.length) throw forbidden("Identity, bank, family and birth details are updated by HR. Contact People Operations to change them.");
  }
  const errs: string[] = [];
  const phone = clean(input.phone),
    eph = clean(input.emergencyContactPhone);
  if (phone && !PHONE.test(phone)) errs.push("Phone number looks invalid (use digits, e.g. +62 812-3456-7890).");
  if (eph && !PHONE.test(eph)) errs.push("Emergency contact phone looks invalid.");
  const pe = clean(input.personalEmail);
  if (pe && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(pe)) errs.push("Personal email is invalid.");
  if (input.joinDate !== undefined && (!isValidISO(input.joinDate) || input.joinDate < "1990-01-01" || input.joinDate > addDays(todayJakarta(), 366)))
    errs.push("Join date is invalid.");
  const bd = clean(input.birthDate);
  if (bd && (!isValidISO(bd) || bd > todayJakarta() || bd < "1940-01-01")) errs.push("Birth date is invalid.");
  const nik = input.nik === undefined ? undefined : (input.nik ?? "").replace(/\s/g, "");
  if (nik && !/^\d{16}$/.test(nik)) errs.push("NIK must be 16 digits.");
  const npwp = input.npwp === undefined ? undefined : (input.npwp ?? "").replace(/[.\-\s]/g, "");
  if (npwp && !/^\d{15,16}$/.test(npwp)) errs.push("NPWP must be 15 or 16 digits.");
  const acct = input.bankAccountNumber === undefined ? undefined : (input.bankAccountNumber ?? "").replace(/[\s-]/g, "");
  if (acct && !/^\d{5,20}$/.test(acct)) errs.push("Bank account number must be 5–20 digits.");
  if (input.dependents !== undefined && (!Number.isInteger(input.dependents) || input.dependents < 0 || input.dependents > 10)) errs.push("Dependents must be 0–10.");
  if (errs.length) throw invalid(errs[0], { errors: errs });

  return withTx(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw notFound("Employee");
    const before = await tx.employeePersonalData.findUnique({ where: { employeeId } });
    const data: Record<string, unknown> = { updatedById: actor.employeeId };
    const set = (k: string, v: unknown) => {
      if (v !== undefined) data[k] = v;
    };
    set("phone", phone);
    set("personalEmail", pe);
    set("addressDomicile", clean(input.addressDomicile));
    set("emergencyContactName", clean(input.emergencyContactName));
    set("emergencyContactRelation", clean(input.emergencyContactRelation));
    set("emergencyContactPhone", eph);
    if (isHR && input.joinDate && input.joinDate !== toISO(emp.startDate)) await moveJoinDate(tx, emp.id, toISO(emp.startDate), input.joinDate, actor);
    if (isHR) {
      set("birthDate", bd === undefined ? undefined : bd ? fromISO(bd) : null);
      set("birthPlace", clean(input.birthPlace));
      set("addressKtp", clean(input.addressKtp));
      set("bankName", clean(input.bankName));
      set("bankAccountHolder", clean(input.bankAccountHolder));
      set("maritalStatus", input.maritalStatus === undefined ? undefined : input.maritalStatus || null);
      set("dependents", input.dependents);
      if (nik !== undefined) {
        if (nik) {
          const hash = blindIndex(nik);
          const dup = await tx.employeePersonalData.findFirst({ where: { nikHash: hash, employeeId: { not: employeeId } } });
          if (dup) throw conflict("This NIK is already registered to another employee.");
          Object.assign(data, { nikEncrypted: encrypt(nik), nikLast4: last4(nik), nikHash: hash });
        } else Object.assign(data, { nikEncrypted: null, nikLast4: null, nikHash: null });
      }
      if (npwp !== undefined) Object.assign(data, npwp ? { npwpEncrypted: encrypt(npwp), npwpLast4: last4(npwp) } : { npwpEncrypted: null, npwpLast4: null });
      if (acct !== undefined) Object.assign(data, acct ? { bankAccountEncrypted: encrypt(acct), bankAccountLast4: last4(acct) } : { bankAccountEncrypted: null, bankAccountLast4: null });
    }
    const after = await tx.employeePersonalData.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data });
    // audit trail never contains plaintext identity or bank numbers
    const safe = (r: typeof after | null) =>
      r && { ...r, nikEncrypted: undefined, nikHash: undefined, npwpEncrypted: undefined, bankAccountEncrypted: undefined, nik: mask(r.nikLast4), npwp: mask(r.npwpLast4), bankAccount: mask(r.bankAccountLast4) };
    await audit(tx, { actorUserId: actor.userId, action: isSelf && !isHR ? "people.self_update" : "people.update", entityType: "EmployeePersonalData", entityId: employeeId, before: safe(before), after: safe(after) });
    return { ok: true };
  });
}

/**
 * Changes an employee's join date. Their first level, team and reporting records start on the join date,
 * so those initial records move with it (later effective-dated changes are untouched).
 */
async function moveJoinDate(tx: Parameters<Parameters<typeof withTx>[0]>[0], employeeId: string, oldStart: ISODate, newStart: ISODate, actor: CurrentUser) {
  const tables = [tx.employeeLevelAssignment, tx.employeeTeamMembership, tx.reportingRelationship] as unknown as {
    findMany(a: unknown): Promise<{ id: string; effectiveFrom: Date; effectiveTo: Date | null }[]>;
    update(a: unknown): Promise<unknown>;
  }[];
  for (const t of tables) {
    const rows = await t.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });
    const first = rows[0];
    if (!first) continue;
    const firstFrom = toISO(first.effectiveFrom);
    // only the record that began with the employment (on or before the old join date) follows the join date
    if (firstFrom > oldStart) continue;
    if (first.effectiveTo && toISO(first.effectiveTo) < newStart)
      throw invalid(`The new join date is after a later level/team/leader change (${formatDate(toISO(first.effectiveTo))}). Adjust those records first.`);
    await t.update({ where: { id: first.id }, data: { effectiveFrom: fromISO(newStart) } });
  }
  await tx.employee.update({ where: { id: employeeId }, data: { startDate: fromISO(newStart) } });
  await audit(tx, { actorUserId: actor.userId, action: "employee.join_date.update", entityType: "Employee", entityId: employeeId, before: { joinDate: oldStart }, after: { joinDate: newStart } });
}

/** Returns the full NIK / NPWP / bank account number to the employee themself or HR, and logs the access. */
export async function revealSensitive(actor: CurrentUser, employeeId: string, field: "nik" | "npwp" | "bank") {
  if (actor.employeeId !== employeeId && !can(actor, "employee.manage")) throw forbidden();
  const p = await db.employeePersonalData.findUnique({ where: { employeeId } });
  const enc = field === "nik" ? p?.nikEncrypted : field === "npwp" ? p?.npwpEncrypted : p?.bankAccountEncrypted;
  if (!enc) throw notFound("Value");
  await audit(db, { actorUserId: actor.userId, action: "people.sensitive.reveal", entityType: "EmployeePersonalData", entityId: employeeId, metadata: { field } });
  return decrypt(enc);
}

export { formatDate };

// ───────────────────────────── Profile photo ─────────────────────────────

/** Employees set their own photo; HR can set anyone's. Photos are visible to every signed-in colleague. */
export async function setProfilePhoto(actor: CurrentUser, employeeId: string, fileId: string | null) {
  if (actor.employeeId !== employeeId && !can(actor, "employee.manage")) throw forbidden();
  return withTx(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp) throw notFound("Employee");
    if (fileId) {
      const f = await tx.storedFile.findUnique({ where: { id: fileId } });
      if (!f || f.ownerId !== actor.userId || !f.mimeType.startsWith("image/")) throw invalid("Upload a PNG, JPEG or WEBP image.");
    }
    await tx.employee.update({ where: { id: employeeId }, data: { photoId: fileId } });
    await audit(tx, { actorUserId: actor.userId, action: "employee.photo.update", entityType: "Employee", entityId: employeeId, before: { photoId: emp.photoId }, after: { photoId: fileId } });
  });
}
