// CSV import for Client & Portfolio. Columns = CLIENT_CSV_COLUMNS (same as the export and the template).
// Rows with an existing Client ID update that client; other rows create clients.
// Every row is validated first; the import only runs when no row has errors.
import { db } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden, invalid } from "../errors";
import { isValidISO, todayJakarta, toISO } from "@/lib/dates";
import { validateTeam, type ClientStatusT, type TeamInput } from "@/lib/engine/clients";
import { parseCsv } from "./org";
import { getSettings } from "./settings";
import { CLIENT_CSV_COLUMNS, createClient, updateClient, type CreateClientInput, type UpdateClientInput } from "./clients";

export interface ClientImportRow {
  line: number;
  clientCode: string | null;
  name: string;
  action: "create" | "update";
  errors: string[];
  warnings: string[];
}

export interface ClientImportResult {
  rows: ClientImportRow[];
  created: number;
  updated: number;
  failed: number;
  dryRun: boolean;
}

const list = (v: string | undefined) => (v ?? "").split(/[;\n]/).map((x) => x.trim()).filter(Boolean);
const opt = (v: string | undefined) => (v?.trim() ? v.trim() : null);

/** Accepts YYYY-MM-DD or DD/MM/YYYY (also with "-"). */
export function parseDate(v: string | undefined): string | null | "invalid" {
  const s = v?.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return isValidISO(s) ? s : "invalid";
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (!m) return "invalid";
  const iso = `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return isValidISO(iso) ? iso : "invalid";
}

export function clientCsvTemplate() {
  const example = [
    "",
    "Kopi Senja",
    "PT Senja Boga",
    "Active",
    "2025-03-01",
    "",
    "Advance",
    "F&B",
    "Coffee Shop",
    "Specialty Coffee",
    "Meta Regular; GMV Max TikTok",
    "consultant@mildigital.id",
    "",
    "",
    "strategist1@mildigital.id; strategist2@mildigital.id",
    "https://example.com",
    "https://instagram.com/example",
    "https://tiktok.com/@example",
    "Budi (client)",
    "+62 812-0000-0000",
    "pic@example.com",
    "Short description",
    "Internal notes",
  ];
  return `${CLIENT_CSV_COLUMNS.join(",")}\n${example.map((v) => (/[",;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)).join(",")}\n`;
}

export async function importClientsCsv(actor: CurrentUser, text: string, dryRun = true): Promise<ClientImportResult> {
  if (!can(actor, "client.manage")) throw forbidden();
  const raw = parseCsv(text);
  if (!raw.length) throw invalid("The CSV file is empty.");
  if (raw.length > 1000) throw invalid("Import at most 1,000 rows at a time.");
  const missing = ["brand_name"].filter((c) => !(c in raw[0]));
  if (missing.length) throw invalid(`Missing column: ${missing.join(", ")}. Download the template for the expected columns.`);

  const today = todayJakarta();
  const [employees, packages, categories, brands, aliases, settings] = await Promise.all([
    db.employee.findMany({ select: { id: true, email: true, employeeCode: true, isActive: true, fullName: true } }),
    db.clientPackage.findMany(),
    db.clientCategory.findMany(),
    db.clientBrand.findMany({
      where: { archivedAt: null },
      select: { id: true, clientCode: true, status: true, dateStart: true, engagements: { orderBy: { startDate: "desc" }, take: 1, select: { packages: { where: { effectiveTo: null }, select: { packageId: true } } } } },
    }),
    db.clientCodeAlias.findMany(),
    getSettings(),
  ]);
  const byPerson = new Map<string, (typeof employees)[number]>();
  for (const e of employees) {
    byPerson.set(e.email.toLowerCase(), e);
    byPerson.set(e.employeeCode.toLowerCase(), e);
  }
  const byCode = new Map(brands.map((b) => [b.clientCode.toUpperCase(), b]));
  const retired = new Set(aliases.map((a) => a.code.toUpperCase()));
  const seenCodes = new Set<string>();

  const planned: { row: ClientImportRow; create?: CreateClientInput; update?: { id: string; input: UpdateClientInput } }[] = [];
  raw.forEach((r, i) => {
    const row: ClientImportRow = { line: i + 2, clientCode: opt(r.client_id)?.toUpperCase() ?? null, name: r.brand_name?.trim() ?? "", action: "create", errors: [], warnings: [] };
    const err = (m: string) => row.errors.push(m);
    if (!row.name) err("brand_name is required.");
    const existing = row.clientCode ? byCode.get(row.clientCode) : undefined;
    if (existing) row.action = "update";
    if (row.clientCode) {
      if (!existing && retired.has(row.clientCode)) err(`Client ID ${row.clientCode} was retired and can't be reused.`);
      if (seenCodes.has(row.clientCode)) err(`Client ID ${row.clientCode} appears twice in the file.`);
      seenCodes.add(row.clientCode);
    }
    const person = (v: string, label: string) => {
      const e = byPerson.get(v.toLowerCase());
      if (!e) err(`${label}: “${v}” is not in the Team Directory (use work email or employee ID).`);
      else if (!e.isActive) err(`${label}: ${e.fullName} is no longer active.`);
      return e?.id ?? null;
    };
    const team: TeamInput = {
      primary: opt(r.consultant_1) ? person(r.consultant_1, "consultant_1") : null,
      secondary: opt(r.consultant_2) ? person(r.consultant_2, "consultant_2") : null,
      additional: list(r.additional_consultants).map((v) => person(v, "additional_consultants")).filter((x): x is string => !!x),
      adsStrategists: list(r.ads_strategists).map((v) => person(v, "ads_strategists")).filter((x): x is string => !!x),
    };
    const statusRaw = (r.status ?? "").trim().toUpperCase();
    const status = (statusRaw === "" ? (existing?.status ?? "ACTIVE") : statusRaw) as ClientStatusT;
    if (!["ACTIVE", "INACTIVE", "FREEZE"].includes(status)) err(`status must be Active, Inactive or Freeze (got “${r.status}”).`);
    const dateStart = parseDate(r.date_start) ?? (existing ? toISO(existing.dateStart) : null);
    const dateOff = parseDate(r.date_off);
    if (!dateStart) err("date_start is required.");
    if (dateStart === "invalid") err("date_start must be YYYY-MM-DD or DD/MM/YYYY.");
    if (dateOff === "invalid") err("date_off must be YYYY-MM-DD or DD/MM/YYYY.");
    const pkgName = opt(r.package);
    const pkg = pkgName ? packages.find((p) => p.name.toLowerCase() === pkgName.toLowerCase()) : null;
    const packageId = pkg?.id ?? existing?.engagements[0]?.packages[0]?.packageId ?? null;
    if (pkgName && !pkg) err(`package “${pkgName}” doesn't exist (Settings → Packages & client rules).`);
    if (!packageId) err("package is required.");
    if (pkg && !pkg.isActive && !existing) err(`package “${pkg.name}” is archived.`);
    const catName = opt(r.category);
    const category = catName ? categories.find((c) => c.name.toLowerCase() === catName.toLowerCase()) : null;
    if (catName && !category) err(`category “${catName}” doesn't exist (${categories.map((c) => c.name).join(", ")}).`);
    if (opt(r.sub_industry) && !opt(r.industry)) err("sub_industry needs an industry.");
    const teamErrs = validateTeam(team, { status, requirePrimary: settings.clientRequirePrimaryConsultant, waived: false });
    row.errors.push(...teamErrs);

    const info = {
      name: row.name,
      organizationName: opt(r.client_organization),
      categoryId: category?.id ?? null,
      industryName: opt(r.industry),
      subIndustryName: opt(r.sub_industry),
      adAccounts: list(r.ad_accounts),
      description: opt(r.brand_description),
      websiteUrl: opt(r.website_url),
      instagramUrl: opt(r.instagram_url),
      tiktokUrl: opt(r.tiktok_url),
      picName: opt(r.pic_name),
      picPhone: opt(r.pic_phone),
      picEmail: opt(r.pic_email),
      internalNotes: opt(r.internal_notes),
      packageId: packageId ?? "",
      team,
    };
    if (existing) {
      if (status !== existing.status) row.warnings.push(`Status stays ${existing.status.toLowerCase()} — change status on the client page (it needs an effective date).`);
      planned.push({ row, update: { id: existing.id, input: { ...info, clientCode: existing.clientCode, dateStart: dateStart as string } } });
    } else {
      if (status === "INACTIVE" && !dateOff) err("date_off is required for inactive clients.");
      if (dateOff && dateOff !== "invalid" && dateOff > today) err("date_off can't be in the future.");
      planned.push({ row, create: { ...info, clientCode: row.clientCode, status, dateStart: dateStart as string, dateOff: dateOff === "invalid" ? null : dateOff } });
    }
  });

  const rows = planned.map((p) => p.row);
  const failedPre = rows.filter((r) => r.errors.length).length;
  if (dryRun || failedPre) return { rows, created: 0, updated: 0, failed: failedPre, dryRun: true };

  let created = 0,
    updated = 0,
    failed = 0;
  for (const p of planned) {
    try {
      if (p.create) {
        await createClient(actor, p.create);
        created++;
      } else if (p.update) {
        await updateClient(actor, p.update.id, p.update.input);
        updated++;
      }
    } catch (e) {
      failed++;
      p.row.errors.push(e instanceof Error ? e.message : "Could not be saved.");
    }
  }
  return { rows, created, updated, failed, dryRun: false };
}
