// Reference configuration shared by the demo seed and the production bootstrap:
// level policies, levels, departments/teams, the holiday calendar and request types.
import type { HolidayType, PrismaClient, Requirement, RequestCategory } from "@prisma/client";
import { fromISO } from "../src/lib/dates";

const d = (s: string) => fromISO(s);

export async function createReferenceData(db: PrismaClient, opts: { demoPolicyHistory?: boolean } = {}) {
  // ── Policies (versioned) ──
  const mkPolicy = async (name: string, description: string, versions: { wfo: number; mandatory: number[]; flexible: number[]; from: string; to?: string; note: string; hr?: boolean }[]) =>
    db.policy.create({
      data: {
        name,
        description,
        versions: {
          create: versions.map((v, i) => ({
            version: i + 1,
            wfoPercent: v.wfo,
            mandatoryWeekdays: v.mandatory,
            flexibleWeekdays: v.flexible,
            submissionDeadlineDay: 25,
            exceptionsRequireHr: v.hr ?? false,
            effectiveFrom: d(v.from),
            effectiveTo: v.to ? d(v.to) : null,
            changeNote: v.note,
          })),
        },
      },
    });
  const pJunior = await mkPolicy("Junior & Associate — 75% WFO", "Collective office days Mon/Wed/Thu.", [
    { wfo: 75, mandatory: [1, 3, 4], flexible: [2, 5], from: "2026-01-01", note: "Initial hybrid policy", hr: true },
  ]);
  const pSenior = await mkPolicy(
    "Senior — 75% WFO",
    "Collective office days Mon/Wed/Thu.",
    opts.demoPolicyHistory
      ? [
          { wfo: 60, mandatory: [1, 3], flexible: [2, 4, 5], from: "2026-01-01", to: "2026-06-30", note: "Pilot: 60% with two collective days" },
          { wfo: 75, mandatory: [1, 3, 4], flexible: [2, 5], from: "2026-07-01", note: "Aligned with Junior collective days from H2 2026" },
        ]
      : [{ wfo: 75, mandatory: [1, 3, 4], flexible: [2, 5], from: "2026-01-01", note: "Initial hybrid policy" }],
  );
  const pPrincipal = await mkPolicy("Principal IC — 50% WFO", "Flexible: one collective day (Wednesday).", [
    { wfo: 50, mandatory: [3], flexible: [1, 2, 4, 5], from: "2026-01-01", note: "Initial hybrid policy" },
  ]);
  const pManager = await mkPolicy("Manager & Leader — 50% WFO", "Leaders anchor Monday planning and Wednesday collab.", [
    { wfo: 50, mandatory: [1, 3], flexible: [2, 4, 5], from: "2026-01-01", note: "Initial hybrid policy" },
  ]);

  const levels = {
    JUNIOR: await db.employeeLevel.create({ data: { code: "JUNIOR", name: "Junior & Associate", rank: 1, policyId: pJunior.id } }),
    SENIOR: await db.employeeLevel.create({ data: { code: "SENIOR", name: "Senior", rank: 2, policyId: pSenior.id } }),
    PRINCIPAL: await db.employeeLevel.create({ data: { code: "PRINCIPAL", name: "Principal — Individual Contributor", rank: 3, policyId: pPrincipal.id, description: "Senior IC track. Not an approver unless given the Leader role." } }),
    MANAGER: await db.employeeLevel.create({ data: { code: "MANAGER", name: "Manager & Leader", rank: 4, policyId: pManager.id } }),
  };

  // ── Departments & teams ──
  const depts = {
    GROWTH: await db.department.create({ data: { code: "GROWTH", name: "Growth & Performance" } }),
    CREATIVE: await db.department.create({ data: { code: "CREATIVE", name: "Creative & Content" } }),
    PEOPLE: await db.department.create({ data: { code: "PEOPLE", name: "Operations & People" } }),
  };
  const teams = {
    PERF: await db.team.create({ data: { name: "Performance Marketing", departmentId: depts.GROWTH.id } }),
    MKT: await db.team.create({ data: { name: "Marketplace", departmentId: depts.GROWTH.id } }),
    DATA: await db.team.create({ data: { name: "Data & Analytics", departmentId: depts.GROWTH.id } }),
    CREA: await db.team.create({ data: { name: "Creative Studio", departmentId: depts.CREATIVE.id } }),
    PPL: await db.team.create({ data: { name: "People Ops", departmentId: depts.PEOPLE.id } }),
  };

  // ── Holidays (SKB 3 Menteri 2026 — verify against the official decree; editable in Settings) ──
  const cal = await db.holidayCalendar.create({ data: { name: "Indonesia — MIL Digital", isDefault: true } });
  const H: [string, string, HolidayType][] = [
    ["2026-01-01", "Tahun Baru 2026 Masehi", "NATIONAL"],
    ["2026-01-16", "Isra Mikraj Nabi Muhammad SAW", "NATIONAL"],
    ["2026-02-16", "Cuti Bersama Tahun Baru Imlek", "CUTI_BERSAMA"],
    ["2026-02-17", "Tahun Baru Imlek 2577 Kongzili", "NATIONAL"],
    ["2026-03-18", "Cuti Bersama Hari Suci Nyepi", "CUTI_BERSAMA"],
    ["2026-03-19", "Hari Suci Nyepi (Tahun Baru Saka 1948)", "NATIONAL"],
    ["2026-03-20", "Cuti Bersama Idul Fitri 1447 H", "CUTI_BERSAMA"],
    ["2026-03-21", "Idul Fitri 1447 H", "NATIONAL"],
    ["2026-03-22", "Idul Fitri 1447 H", "NATIONAL"],
    ["2026-03-23", "Cuti Bersama Idul Fitri 1447 H", "CUTI_BERSAMA"],
    ["2026-03-24", "Cuti Bersama Idul Fitri 1447 H", "CUTI_BERSAMA"],
    ["2026-04-03", "Wafat Yesus Kristus", "NATIONAL"],
    ["2026-04-05", "Kebangkitan Yesus Kristus (Paskah)", "NATIONAL"],
    ["2026-05-01", "Hari Buruh Internasional", "NATIONAL"],
    ["2026-05-14", "Kenaikan Yesus Kristus", "NATIONAL"],
    ["2026-05-15", "Cuti Bersama Kenaikan Yesus Kristus", "CUTI_BERSAMA"],
    ["2026-05-27", "Idul Adha 1447 H", "NATIONAL"],
    ["2026-05-28", "Cuti Bersama Idul Adha 1447 H", "CUTI_BERSAMA"],
    ["2026-05-31", "Hari Raya Waisak 2570 BE", "NATIONAL"],
    ["2026-06-01", "Hari Lahir Pancasila", "NATIONAL"],
    ["2026-06-16", "1 Muharam Tahun Baru Islam 1448 H", "NATIONAL"],
    ["2026-08-17", "Proklamasi Kemerdekaan RI", "NATIONAL"],
    ["2026-08-25", "Maulid Nabi Muhammad SAW", "NATIONAL"],
    ["2026-12-24", "Cuti Bersama Natal", "CUTI_BERSAMA"],
    ["2026-12-25", "Kelahiran Yesus Kristus", "NATIONAL"],
    ["2026-12-31", "MIL Digital year-end day off", "COMPANY"],
    ["2027-01-01", "Tahun Baru 2027 Masehi", "NATIONAL"],
    ["2027-05-01", "Hari Buruh Internasional", "NATIONAL"],
    ["2027-06-01", "Hari Lahir Pancasila", "NATIONAL"],
    ["2027-08-17", "Proklamasi Kemerdekaan RI", "NATIONAL"],
    ["2027-12-25", "Kelahiran Yesus Kristus", "NATIONAL"],
  ];
  await db.holiday.createMany({ data: H.map(([date, name, type]) => ({ calendarId: cal.id, date: d(date), name, type, source: type === "COMPANY" ? "company" : "SKB 3 Menteri 2026 (verify)" })) });

  // ── Request types (LeaveTypes) ──
  const RT: { code: string; name: string; category: RequestCategory; doc: Requirement; del: Requirement; min: number; notice: number; half: boolean; hourly: boolean; bal: boolean; ent: number | null; sensitive: boolean; desc: string }[] = [
    { code: "ANNUAL", name: "Annual Leave", category: "LEAVE", doc: "NONE", del: "REQUIRED", min: 10, notice: 3, half: true, hourly: false, bal: true, ent: 12, sensitive: false, desc: "Paid annual leave. Requires a peer delegate and 3 days' notice." },
    { code: "SICK", name: "Sick Leave", category: "LEAVE", doc: "OPTIONAL", del: "OPTIONAL", min: 5, notice: 0, half: true, hourly: false, bal: false, ent: null, sensitive: true, desc: "Medical leave. Doctor's note recommended for 2+ days; visible only to approvers and HR." },
    { code: "PERSONAL", name: "Personal Permission", category: "PERMISSION", doc: "NONE", del: "OPTIONAL", min: 10, notice: 1, half: true, hourly: true, bal: false, ent: null, sensitive: false, desc: "Short personal permission (hourly or half day)." },
    { code: "EMERGENCY", name: "Emergency Leave", category: "LEAVE", doc: "OPTIONAL", del: "OPTIONAL", min: 10, notice: 0, half: true, hourly: false, bal: false, ent: null, sensitive: true, desc: "Family or personal emergencies." },
    { code: "OFFSITE", name: "Offsite Duty", category: "OFFSITE", doc: "OPTIONAL", del: "NONE", min: 10, notice: 1, half: false, hourly: false, bal: false, ent: null, sensitive: false, desc: "Client visits, events and shoots. Counts toward WFO per policy." },
    { code: "OTHER", name: "Other Permission", category: "PERMISSION", doc: "OPTIONAL", del: "OPTIONAL", min: 20, notice: 1, half: true, hourly: true, bal: false, ent: null, sensitive: false, desc: "Anything not covered above." },
    { code: "ADDITIONAL_WFH", name: "Additional WFH", category: "ADDITIONAL_WFH", doc: "NONE", del: "NONE", min: 10, notice: 0, half: false, hourly: false, bal: false, ent: null, sensitive: false, desc: "Turn an approved WFO day into WFH (replacement WFO may be required)." },
    { code: "SCHEDULE_CHANGE", name: "WFO/WFH Schedule Change", category: "SCHEDULE_CHANGE", doc: "NONE", del: "NONE", min: 10, notice: 0, half: false, hourly: false, bal: false, ent: null, sensitive: false, desc: "Swap or switch approved WFO/WFH dates." },
  ];
  const types: Record<string, string> = {};
  for (const [i, t] of RT.entries()) {
    const row = await db.requestType.create({
      data: { code: t.code, name: t.name, category: t.category, description: t.desc, documentRequirement: t.doc, delegation: t.del, reasonMinLength: t.min, advanceNoticeDays: t.notice, allowHalfDay: t.half, allowHourly: t.hourly, deductsBalance: t.bal, defaultEntitlement: t.ent, isSensitive: t.sensitive, sortOrder: i, ...(t.code === "ANNUAL" ? { monthlyAccrual: true, eligibleStatuses: ["PERMANENT" as const], annualRules: true, advanceNoticeDays: 14 } : {}) },
    });
    types[t.code] = row.id;
  }
  return { levels, depts, teams, types, cal };
}
