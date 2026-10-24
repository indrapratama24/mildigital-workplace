// Bulk edit (spreadsheet style) for the Team Directory and the Client directory: each selected row carries
// its own new values. Every row goes through the same service as a single edit (same rules, history and
// audit log); failures are reported per row and don't stop the others.
import type { EmploymentStatus } from "@prisma/client";
import { db, withTx } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden, invalid } from "../errors";
import { fromISO, isValidISO, todayJakarta, type ISODate } from "@/lib/dates";
import { audit } from "./audit";
import { changeLevel, setLeader, updateEmployee } from "./org";
import { changeClientStatus, getClient, updateClient, type UpdateClientInput } from "./clients";
import type { ClientStatusT } from "@/lib/engine/clients";

export interface BulkResult {
  updated: number;
  failed: { id: string; name: string; error: string }[];
}

const MAX = 200;
const message = (e: unknown) => (e instanceof Error ? e.message : "Could not be saved.");

function checkRows(rows: { id: string }[], what: string) {
  if (!rows.length) throw invalid(`No ${what} changed.`);
  if (rows.length > MAX) throw invalid(`Edit at most ${MAX} ${what} at a time.`);
  if (new Set(rows.map((r) => r.id)).size !== rows.length) throw invalid("A row appears twice.");
}

// ───────────────────────────── Team Directory ─────────────────────────────

/** Only the fields present are changed. */
export interface EmployeeRowPatch {
  jobTitle?: string;
  teamId?: string | null;
  departmentId?: string | null;
  employmentStatus?: EmploymentStatus;
  levelId?: string;
  leaderId?: string | null;
  /** Leave days to add (negative deducts) for `options.leaveTypeId` / `options.leaveYear`. */
  leaveDays?: number;
}

export interface EmployeeBulkOptions {
  /** Level and leader changes take effect on this date. */
  effectiveFrom: ISODate;
  /** Reason recorded for level changes and leave adjustments. */
  reason: string;
  leaveTypeId?: string;
  leaveYear?: number;
}

/** Leave adjustment: adds `days` to the year's adjustment of one leave type. */
export async function adjustLeaveBalance(actor: CurrentUser, input: { employeeId: string; requestTypeId: string; year: number; days: number; reason: string }) {
  if (!can(actor, "requestType.manage")) throw forbidden("Leave adjustments need leave administration rights.");
  if (!Number.isFinite(input.days) || input.days === 0 || Math.abs(input.days) > 60 || Math.round(input.days * 2) !== input.days * 2)
    throw invalid("Leave adjustment must be a non-zero number of (half) days up to 60.");
  if (input.reason.trim().length < 5) throw invalid("Give a reason for the leave adjustment (min. 5 characters).");
  return withTx(async (tx) => {
    const type = await tx.requestType.findUnique({ where: { id: input.requestTypeId } });
    if (!type || type.category !== "LEAVE") throw invalid("Choose a leave type.");
    const key = { employeeId_requestTypeId_year: { employeeId: input.employeeId, requestTypeId: input.requestTypeId, year: input.year } };
    const before = await tx.leaveBalance.findUnique({ where: key });
    const b = await tx.leaveBalance.upsert({
      where: key,
      create: { employeeId: input.employeeId, requestTypeId: input.requestTypeId, year: input.year, entitledDays: type.defaultEntitlement ?? 0, adjustedDays: input.days },
      update: { adjustedDays: { increment: input.days } },
    });
    await audit(tx, { actorUserId: actor.userId, action: "leaveBalance.adjust", entityType: "LeaveBalance", entityId: b.id, before, after: b, metadata: { days: input.days, reason: input.reason.trim() } });
    return b;
  });
}

/** Current values of the selected people, for the bulk editor grid. */
export async function employeesForBulk(actor: CurrentUser, ids: string[]) {
  if (!can(actor, "employee.manage")) throw forbidden();
  const d = fromISO(todayJakarta());
  const on = { effectiveFrom: { lte: d }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: d } }] };
  const rows = await db.employee.findMany({
    where: { id: { in: ids.slice(0, MAX) } },
    orderBy: { fullName: "asc" },
    select: {
      id: true,
      fullName: true,
      employeeCode: true,
      jobTitle: true,
      departmentId: true,
      employmentStatus: true,
      photoId: true,
      memberships: { where: { isPrimary: true, ...on }, select: { teamId: true }, take: 1 },
      levelAssignments: { where: on, orderBy: { effectiveFrom: "desc" }, select: { levelId: true }, take: 1 },
      reportsTo: { where: { type: "PRIMARY", ...on }, select: { leaderId: true }, take: 1 },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.fullName,
    code: r.employeeCode,
    photoId: r.photoId,
    jobTitle: r.jobTitle,
    teamId: r.memberships[0]?.teamId ?? null,
    departmentId: r.departmentId,
    employmentStatus: r.employmentStatus,
    levelId: r.levelAssignments[0]?.levelId ?? null,
    leaderId: r.reportsTo[0]?.leaderId ?? null,
  }));
}
export type EmployeeBulkRow = Awaited<ReturnType<typeof employeesForBulk>>[number];

export async function bulkEditEmployees(actor: CurrentUser, rows: { id: string; patch: EmployeeRowPatch }[], opts: EmployeeBulkOptions): Promise<BulkResult> {
  if (!can(actor, "employee.manage")) throw forbidden();
  rows = rows.filter((r) => Object.values(r.patch).some((v) => v !== undefined));
  checkRows(rows, "people");
  if (!isValidISO(opts.effectiveFrom)) throw invalid("Choose the date the changes take effect.");
  if (rows.some((r) => r.patch.levelId) && opts.reason.trim().length < 5) throw invalid("Give a reason for the level changes (min. 5 characters).");
  if (rows.some((r) => r.patch.leaveDays)) {
    if (!can(actor, "requestType.manage")) throw forbidden("Leave adjustments need leave administration rights.");
    if (!opts.leaveTypeId || !opts.leaveYear) throw invalid("Choose the leave type and year for the leave adjustments.");
    if (opts.reason.trim().length < 5) throw invalid("Give a reason for the leave adjustments (min. 5 characters).");
  }

  const names = new Map((await db.employee.findMany({ where: { id: { in: rows.map((r) => r.id) } }, select: { id: true, fullName: true } })).map((e) => [e.id, e.fullName]));
  const result: BulkResult = { updated: 0, failed: [] };
  for (const { id, patch } of rows) {
    const name = names.get(id);
    if (!name) {
      result.failed.push({ id, name: "Unknown", error: "Not found." });
      continue;
    }
    try {
      if (patch.jobTitle !== undefined && patch.jobTitle.trim().length < 2) throw invalid("Job title is too short.");
      if (patch.jobTitle !== undefined || patch.teamId !== undefined || patch.departmentId !== undefined || patch.employmentStatus !== undefined)
        await updateEmployee(actor, id, { jobTitle: patch.jobTitle?.trim(), teamId: patch.teamId, departmentId: patch.departmentId, employmentStatus: patch.employmentStatus });
      if (patch.levelId) await changeLevel(actor, { employeeId: id, levelId: patch.levelId, effectiveFrom: opts.effectiveFrom, reason: opts.reason });
      if (patch.leaderId !== undefined) await setLeader(actor, { employeeId: id, leaderId: patch.leaderId, type: "PRIMARY", effectiveFrom: opts.effectiveFrom });
      if (patch.leaveDays) await adjustLeaveBalance(actor, { employeeId: id, requestTypeId: opts.leaveTypeId!, year: opts.leaveYear!, days: patch.leaveDays, reason: opts.reason });
      result.updated++;
    } catch (e) {
      result.failed.push({ id, name, error: message(e) });
    }
  }
  return result;
}

// ───────────────────────────── Client directory ─────────────────────────────

/** Only the fields present are changed; lists (ad accounts, Ads Strategists) replace the current list. */
export interface ClientRowPatch {
  name?: string;
  packageId?: string;
  categoryId?: string | null;
  industryName?: string | null;
  subIndustryName?: string | null;
  adAccounts?: string[];
  consultant1?: string | null;
  consultant2?: string | null;
  adsStrategists?: string[];
  status?: ClientStatusT;
  websiteUrl?: string | null;
  picName?: string | null;
  picPhone?: string | null;
  picEmail?: string | null;
}

export interface ClientBulkOptions {
  /** Team and status changes take effect on this date (Inactive: the Date OFF). Can't be in the future. */
  effectiveFrom: ISODate;
  statusReason?: string | null;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export async function bulkEditClients(actor: CurrentUser, rows: { id: string; patch: ClientRowPatch }[], opts: ClientBulkOptions): Promise<BulkResult> {
  if (!can(actor, "client.manage")) throw forbidden();
  rows = rows.filter((r) => Object.values(r.patch).some((v) => v !== undefined));
  checkRows(rows, "clients");
  if (!isValidISO(opts.effectiveFrom) || opts.effectiveFrom > todayJakarta()) throw invalid("The effective date must be today or earlier.");

  const result: BulkResult = { updated: 0, failed: [] };
  for (const { id, patch } of rows) {
    let name = "Unknown";
    try {
      const c = await getClient(actor, id);
      name = c.name;
      const { status, ...info } = patch;
      if (Object.values(info).some((v) => v !== undefined)) {
        const adAccounts = patch.adAccounts ?? c.adAccounts;
        const categoryChanged = patch.categoryId !== undefined && (patch.categoryId || null) !== c.categoryId;
        const input: UpdateClientInput = {
          name: patch.name ?? c.name,
          organizationName: c.organization,
          categoryId: patch.categoryId !== undefined ? patch.categoryId : c.categoryId,
          industryName: patch.industryName !== undefined ? patch.industryName : categoryChanged ? null : c.industry,
          subIndustryName: patch.subIndustryName !== undefined ? patch.subIndustryName : categoryChanged || patch.industryName !== undefined ? null : c.subIndustry,
          adAccounts,
          description: c.description,
          websiteUrl: patch.websiteUrl !== undefined ? patch.websiteUrl : c.websiteUrl,
          instagramUrl: c.instagramUrl,
          tiktokUrl: c.tiktokUrl,
          picName: patch.picName !== undefined ? patch.picName : c.picName,
          picPhone: patch.picPhone !== undefined ? patch.picPhone : c.picPhone,
          picEmail: patch.picEmail !== undefined ? patch.picEmail : c.picEmail,
          internalNotes: c.internalNotes,
          clientCode: c.clientCode,
          dateStart: c.dateStart,
          packageId: patch.packageId ?? c.package?.id ?? "",
          team: {
            primary: patch.consultant1 !== undefined ? patch.consultant1 : (c.consultant1?.id ?? null),
            secondary: patch.consultant2 !== undefined ? patch.consultant2 : (c.consultant2?.id ?? null),
            additional: c.additional.map((p) => p.id),
            adsStrategists: patch.adsStrategists ?? c.adsStrategists.map((p) => p.id),
            // Ads Strategists keep the ad accounts they handled, as far as the client still has them.
            asAdAccounts: Object.fromEntries(c.adsStrategists.map((p) => [p.id, p.adAccounts.filter((a) => adAccounts.some((x) => sameName(x, a)))])),
          },
          waivePrimary: c.primaryConsultantWaived,
          waiverReason: c.waiverReason,
          // Team changes start on the chosen date (not before the client's own Date START).
          teamEffectiveDate:
            patch.consultant1 !== undefined || patch.consultant2 !== undefined || patch.adsStrategists !== undefined ? (opts.effectiveFrom < c.dateStart ? c.dateStart : opts.effectiveFrom) : null,
        };
        await updateClient(actor, id, input);
      }
      if (status && status !== c.status)
        await changeClientStatus(actor, id, {
          status,
          effectiveDate: status === "INACTIVE" ? null : opts.effectiveFrom,
          dateOff: status === "INACTIVE" ? opts.effectiveFrom : null,
          reason: opts.statusReason || "Bulk edit",
        });
      result.updated++;
    } catch (e) {
      result.failed.push({ id, name, error: message(e) });
    }
  }
  return result;
}

/** Current values of the selected clients, for the bulk editor grid. */
export async function clientsForBulk(actor: CurrentUser, ids: string[]) {
  if (!can(actor, "client.manage")) throw forbidden();
  const out = [];
  for (const id of [...new Set(ids)].slice(0, MAX)) {
    const c = await getClient(actor, id).catch(() => null);
    if (!c) continue;
    out.push({
      id: c.id,
      code: c.clientCode,
      name: c.name,
      status: c.status,
      packageId: c.package?.id ?? null,
      categoryId: c.categoryId,
      industryName: c.industry,
      subIndustryName: c.subIndustry,
      adAccounts: c.adAccounts,
      consultant1: c.consultant1?.id ?? null,
      consultant2: c.consultant2?.id ?? null,
      adsStrategists: c.adsStrategists.map((p) => p.id),
      websiteUrl: c.websiteUrl,
      picName: c.picName,
      picPhone: c.picPhone,
      picEmail: c.picEmail,
      sensitiveVisible: c.sensitiveVisible,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
export type ClientBulkRow = Awaited<ReturnType<typeof clientsForBulk>>[number];
