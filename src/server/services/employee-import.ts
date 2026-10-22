// CSV import / export for the Team Directory — same flow as the client import: download the template
// (= export columns), check every row, then import. Rows with a known employee_id update that person;
// other rows create employees. Empty cells on existing people leave their current value unchanged.
import type { EmploymentStatus } from "@prisma/client";
import { db } from "../db";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { forbidden, invalid } from "../errors";
import { todayJakarta, toISO } from "@/lib/dates";
import { parseCsv, createEmployee, updateEmployee, changeLevel, setLeader, effectiveOn } from "./org";
import { updatePersonalData } from "./people";
import { parseDate } from "./client-import";
import { csvCell } from "./clients";

export const EMPLOYEE_CSV_COLUMNS = [
  "employee_id",
  "full_name",
  "nickname",
  "email",
  "job_title",
  "employment_status",
  "level",
  "department",
  "team",
  "leader",
  "secondary_leader",
  "start_date",
  "leave_eligible_since",
  "role",
  "birth_date",
  "phone",
  "role_description",
] as const;

const ALIASES: Record<string, string> = { level_code: "level", department_code: "department", team_name: "team", leader_email: "leader", secondary_leader_email: "secondary_leader" };
const STATUSES = ["PERMANENT", "CONTRACT", "PROBATION", "INTERN"];
const opt = (v: string | undefined) => (v?.trim() ? v.trim() : null);

export function employeeCsvTemplate() {
  const example: Record<(typeof EMPLOYEE_CSV_COLUMNS)[number], string> = {
    employee_id: "MIL-0100",
    full_name: "Contoh Karyawan",
    nickname: "Contoh",
    email: "contoh@mildigital.id",
    job_title: "Performance Marketer",
    employment_status: "PROBATION",
    level: "JUNIOR",
    department: "GROWTH",
    team: "Performance Marketing",
    leader: "leader@mildigital.id",
    secondary_leader: "",
    start_date: "2026-11-01",
    leave_eligible_since: "",
    role: "EMPLOYEE",
    birth_date: "1998-05-17",
    phone: "+62 812-0000-0100",
    role_description: "",
  };
  return `${EMPLOYEE_CSV_COLUMNS.join(",")}\n${EMPLOYEE_CSV_COLUMNS.map((c) => csvCell(example[c])).join(",")}\n`;
}

export interface EmployeeImportRow {
  line: number;
  code: string;
  name: string;
  action: "create" | "update";
  errors: string[];
  warnings: string[];
}

export async function importEmployeesCsvV2(actor: CurrentUser, text: string, dryRun = true) {
  if (!can(actor, "employee.manage")) throw forbidden();
  const raw = parseCsv(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [ALIASES[k] ?? k, v])));
  if (!raw.length) throw invalid("The CSV file is empty.");
  if (raw.length > 1000) throw invalid("Import at most 1,000 rows at a time.");
  if (!("employee_id" in raw[0])) throw invalid("Missing column employee_id. Download the template for the expected columns.");
  const today = todayJakarta();
  const [levels, departments, teams, people] = await Promise.all([
    db.employeeLevel.findMany(),
    db.department.findMany(),
    db.team.findMany(),
    db.employee.findMany({
      include: {
        user: { select: { role: true } },
        levelAssignments: { where: effectiveOn(today), select: { levelId: true } },
        memberships: { where: { ...effectiveOn(today), isPrimary: true }, select: { teamId: true } },
        reportsTo: { where: effectiveOn(today), select: { leaderId: true, type: true } },
      },
    }),
  ]);
  const byCode = new Map(people.map((p) => [p.employeeCode.toLowerCase(), p]));
  const byEmail = new Map(people.map((p) => [p.email.toLowerCase(), p]));
  const fileCodes = new Map<string, string>(); // email/code in file → code
  for (const r of raw) {
    if (r.employee_id) fileCodes.set(r.employee_id.toLowerCase(), r.employee_id);
    if (r.email) fileCodes.set(r.email.toLowerCase(), r.employee_id);
  }

  type Plan = { row: EmployeeImportRow; r: Record<string, string>; existing?: (typeof people)[number]; levelId: string | null; deptId: string | null | undefined; teamId: string | null | undefined; start: string | null; eligible: string | null; birth: string | null };
  const plans: Plan[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    const code = r.employee_id?.trim() ?? "";
    const existing = byCode.get(code.toLowerCase());
    const row: EmployeeImportRow = { line: i + 2, code, name: r.full_name?.trim() || existing?.fullName || "", action: existing ? "update" : "create", errors: [], warnings: [] };
    const err = (m: string) => row.errors.push(m);
    if (!code) err("employee_id is required.");
    if (seen.has(code.toLowerCase())) err(`employee_id ${code} appears twice in the file.`);
    seen.add(code.toLowerCase());
    const email = r.email?.trim().toLowerCase() ?? "";
    if (!existing) {
      for (const c of ["full_name", "email", "job_title", "start_date", "level"]) if (!opt(r[c])) err(`${c} is required for new employees.`);
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) err(`Invalid email "${r.email}".`);
      if (email && byEmail.has(email)) err(`Email ${email} already belongs to ${byEmail.get(email)!.fullName} (${byEmail.get(email)!.employeeCode}).`);
    } else if (email && email !== existing.email.toLowerCase()) row.warnings.push("Email changes aren't imported — change the email with HR on the profile.");
    const lv = opt(r.level);
    const level = lv ? levels.find((l) => l.code.toLowerCase() === lv.toLowerCase() || l.name.toLowerCase() === lv.toLowerCase()) : null;
    if (lv && !level) err(`Unknown level "${lv}" (${levels.map((l) => l.code).join(", ")}).`);
    const dp = opt(r.department);
    const dept = dp ? departments.find((d) => d.code.toLowerCase() === dp.toLowerCase() || d.name.toLowerCase() === dp.toLowerCase()) : undefined;
    if (dp && !dept) err(`Unknown department "${dp}".`);
    const tm = opt(r.team);
    const team = tm ? teams.find((t) => t.name.toLowerCase() === tm.toLowerCase()) : undefined;
    if (tm && !team) err(`Unknown team "${tm}".`);
    const status = opt(r.employment_status)?.toUpperCase();
    if (status && !STATUSES.includes(status)) err(`employment_status must be ${STATUSES.join(", ")}.`);
    const role = opt(r.role)?.toUpperCase();
    if (role && !["EMPLOYEE", "LEADER"].includes(role)) err("CSV import can only set EMPLOYEE or LEADER roles (HR/Admin roles are given on the profile).");
    if (existing && role && existing.user && !["EMPLOYEE", "LEADER"].includes(existing.user.role)) row.warnings.push(`Role stays ${existing.user.role} (HR/Admin roles aren't changed by import).`);
    const dates: Record<string, string | null> = {};
    for (const c of ["start_date", "leave_eligible_since", "birth_date"]) {
      const d = parseDate(r[c]);
      if (d === "invalid") err(`${c} must be YYYY-MM-DD or DD/MM/YYYY.`);
      dates[c] = d === "invalid" ? null : d;
    }
    if (existing && dates.start_date && dates.start_date !== toISO(existing.startDate)) row.warnings.push("Join date isn't changed by import — edit it on the profile (it moves level/team/leader history).");
    for (const c of ["leader", "secondary_leader"]) {
      const v = opt(r[c])?.toLowerCase();
      if (v && !byEmail.has(v) && !byCode.has(v) && !fileCodes.has(v)) err(`${c} “${r[c]}” is not in the directory or this file.`);
      if (v && (v === code.toLowerCase() || v === email)) err(`${c} can't be the employee themselves.`);
    }
    if (r.phone && !/^\+?[0-9][0-9\s-]{7,17}$/.test(r.phone.trim())) err("phone looks invalid.");
    plans.push({ row, r, existing, levelId: level?.id ?? null, deptId: dp ? dept?.id ?? null : undefined, teamId: tm ? team?.id ?? null : undefined, start: dates.start_date, eligible: dates.leave_eligible_since, birth: dates.birth_date });
  });

  const rows = plans.map((p) => p.row);
  const failedPre = rows.filter((r) => r.errors.length).length;
  if (dryRun || failedPre) return { rows, created: 0, updated: 0, failed: failedPre, dryRun: true };

  let created = 0,
    updated = 0;
  const ids = new Map<string, string>(); // lower(code|email) → employee id
  for (const p of people) {
    ids.set(p.employeeCode.toLowerCase(), p.id);
    ids.set(p.email.toLowerCase(), p.id);
  }
  // Pass 1: create / update people
  for (const p of plans) {
    const { r, row } = p;
    try {
      let id: string;
      if (!p.existing) {
        const emp = await createEmployee(actor, {
          employeeCode: r.employee_id.trim(),
          fullName: r.full_name.trim(),
          email: r.email.trim().toLowerCase(),
          jobTitle: r.job_title.trim(),
          employmentStatus: ((opt(r.employment_status)?.toUpperCase() ?? "PROBATION") as EmploymentStatus),
          levelId: p.levelId!,
          departmentId: p.deptId ?? teams.find((t) => t.id === p.teamId)?.departmentId ?? null,
          teamId: p.teamId ?? null,
          leaderId: null,
          secondaryLeaderId: null,
          startDate: p.start!,
          role: (opt(r.role)?.toUpperCase() ?? "EMPLOYEE") as "EMPLOYEE" | "LEADER",
        });
        id = emp.id;
        created++;
      } else {
        id = p.existing.id;
        const current = p.existing;
        const patch: Parameters<typeof updateEmployee>[2] = {};
        if (opt(r.full_name) && r.full_name.trim() !== current.fullName) patch.fullName = r.full_name.trim();
        if (opt(r.job_title) && r.job_title.trim() !== current.jobTitle) patch.jobTitle = r.job_title.trim();
        const st = opt(r.employment_status)?.toUpperCase();
        if (st && st !== current.employmentStatus) patch.employmentStatus = st as EmploymentStatus;
        if (p.deptId !== undefined && p.deptId !== current.departmentId) patch.departmentId = p.deptId;
        if (p.teamId !== undefined && p.teamId !== (current.memberships[0]?.teamId ?? null)) patch.teamId = p.teamId;
        const role = opt(r.role)?.toUpperCase();
        if (role && current.user && ["EMPLOYEE", "LEADER"].includes(current.user.role) && role !== current.user.role) patch.role = role as "EMPLOYEE" | "LEADER";
        if (Object.keys(patch).length) await updateEmployee(actor, id, patch);
        if (p.levelId && p.levelId !== current.levelAssignments[0]?.levelId) await changeLevel(actor, { employeeId: id, levelId: p.levelId, effectiveFrom: today, reason: "Updated by CSV import" });
        updated++;
      }
      // fields shared by new and existing people (empty = unchanged)
      const extra: Parameters<typeof updateEmployee>[2] = {};
      if (opt(r.role_description)) extra.roleDescription = r.role_description.trim();
      if (p.eligible) extra.fullTimeSince = p.eligible;
      if (Object.keys(extra).length) await updateEmployee(actor, id, extra);
      const personal: Parameters<typeof updatePersonalData>[2] = {};
      if (opt(r.nickname)) personal.nickname = r.nickname.trim();
      if (opt(r.phone)) personal.phone = r.phone.trim();
      if (p.birth) personal.birthDate = p.birth;
      if (Object.keys(personal).length) await updatePersonalData(actor, id, personal);
      ids.set(r.employee_id.trim().toLowerCase(), id);
      if (r.email) ids.set(r.email.trim().toLowerCase(), id);
    } catch (e) {
      row.errors.push(e instanceof Error ? e.message : "Could not be saved.");
    }
  }
  // Pass 2: reporting lines (leaders may be new rows from the same file)
  for (const p of plans) {
    if (p.row.errors.length) continue;
    const id = ids.get(p.r.employee_id.trim().toLowerCase());
    if (!id) continue;
    for (const [col, type] of [["leader", "PRIMARY"], ["secondary_leader", "SECONDARY"]] as const) {
      const v = opt(p.r[col])?.toLowerCase();
      if (!v) continue;
      const leaderId = ids.get(v);
      const current = p.existing?.reportsTo.find((x) => x.type === type)?.leaderId;
      if (!leaderId || leaderId === current) continue;
      try {
        // new people report to their leader from their start date; changes for existing people start today
        await setLeader(actor, { employeeId: id, leaderId, type, effectiveFrom: p.existing ? today : p.start! });
      } catch (e) {
        p.row.errors.push(`${col}: ${e instanceof Error ? e.message : "could not be set"}`);
      }
    }
  }
  const failed = rows.filter((r) => r.errors.length).length;
  return { rows, created, updated, failed, dryRun: false };
}

/** Export in the import columns (people as work emails). HR data like phone/birth date only for HR. */
export async function employeesExportCsv(actor: CurrentUser) {
  if (!can(actor, "employee.manage")) throw forbidden();
  const today = todayJakarta();
  const people = await db.employee.findMany({
    where: { isActive: true },
    include: {
      user: { select: { role: true } },
      department: true,
      personalData: { select: { phone: true, birthDate: true } },
      levelAssignments: { where: effectiveOn(today), include: { level: true } },
      memberships: { where: { ...effectiveOn(today), isPrimary: true }, include: { team: true } },
      reportsTo: { where: effectiveOn(today), include: { leader: { select: { email: true } } } },
    },
    orderBy: { employeeCode: "asc" },
  });
  const lines = people.map((p) => {
    const v: Record<(typeof EMPLOYEE_CSV_COLUMNS)[number], unknown> = {
      employee_id: p.employeeCode,
      full_name: p.fullName,
      nickname: p.nickname,
      email: p.email,
      job_title: p.jobTitle,
      employment_status: p.employmentStatus,
      level: p.levelAssignments[0]?.level.code,
      department: p.department?.code,
      team: p.memberships[0]?.team.name,
      leader: p.reportsTo.find((r) => r.type === "PRIMARY")?.leader.email,
      secondary_leader: p.reportsTo.find((r) => r.type === "SECONDARY")?.leader.email,
      start_date: toISO(p.startDate),
      leave_eligible_since: p.fullTimeSince ? toISO(p.fullTimeSince) : "",
      role: p.user?.role,
      birth_date: p.personalData?.birthDate ? toISO(p.personalData.birthDate) : "",
      phone: p.personalData?.phone,
      role_description: p.roleDescription,
    };
    return EMPLOYEE_CSV_COLUMNS.map((c) => csvCell(v[c])).join(",");
  });
  return [EMPLOYEE_CSV_COLUMNS.join(","), ...lines].join("\n");
}
