// Team Directory & people data: field visibility, self-service limits, encryption and audited reveals.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { getProfile, listDirectory, ptkp, revealSensitive, setVisibility, tenure, updatePersonalData } from "@/server/services/people";
import { fromISO } from "@/lib/dates";
import { buildOrg, resetDb, type Org } from "./helpers";

let org: Org;

async function expectError(p: Promise<unknown>, code: DomainError["code"], msg?: RegExp) {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(DomainError);
    expect((e as DomainError).code).toBe(code);
    if (msg) expect((e as DomainError).message).toMatch(msg);
    return;
  }
  throw new Error(`Expected ${code}`);
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-02T03:00:00Z") });
});
afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  org = await buildOrg();
  // an outsider in another team
  const dept = await db.department.create({ data: { code: "CREATIVE", name: "Creative" } });
  const team = await db.team.create({ data: { name: "Creative Studio", departmentId: dept.id } });
  const u = await db.user.create({ data: { email: "designer@test.id", passwordHash: "x", role: "EMPLOYEE" } });
  const e = await db.employee.create({ data: { employeeCode: "DESIGNER", fullName: "designer", email: "designer@test.id", jobTitle: "Designer", startDate: fromISO("2025-01-01"), userId: u.id, departmentId: dept.id } });
  await db.employeeTeamMembership.create({ data: { employeeId: e.id, teamId: team.id, effectiveFrom: fromISO("2025-01-01") } });
  org.ids.designer = e.id;
  await updatePersonalData(await org.actor("hr"), org.ids.junior, {
    birthDate: "1998-11-20",
    phone: "+62 812-0000-1111",
    addressDomicile: "Jl. Demo 1",
    nik: "3171012345678901",
    bankName: "BCA",
    bankAccountNumber: "1234567890",
    maritalStatus: "MARRIED",
    dependents: 2,
    emergencyContactName: "Spouse",
    emergencyContactPhone: "+62 813-0000-2222",
  });
});

describe("helpers", () => {
  it("computes tenure and PTKP", () => {
    expect(tenure("2024-08-14", "2026-11-02").label).toBe("2 yrs 2 mo");
    expect(tenure("2026-10-20", "2026-11-02").label).toBe("< 1 mo");
    expect(ptkp("MARRIED", 5)).toBe("K/3");
    expect(ptkp("SINGLE", 0)).toBe("TK/0");
    expect(ptkp(null, 0)).toBeNull();
  });
});

describe("directory visibility", () => {
  it("everyone sees the essentials; sensitive fields follow the audience rules", async () => {
    const outsider = await org.actor("designer");
    const { rows } = await listDirectory(outsider);
    const junior = rows.find((r) => r.id === org.ids.junior)!;
    expect(junior.code).toBe("JUNIOR");
    expect(junior.team).toBe("Performance");
    expect(junior.joinDate).toBe("2025-01-01");
    expect(junior.birthday?.label).toMatch(/20 Nov/);
    expect(junior.phone).toBeNull(); // phone defaults to same team
    const p = await getProfile(outsider, org.ids.junior);
    expect(p.personal.nik).toBeUndefined();
    expect(p.personal.bank).toBeUndefined();
    expect(p.personal.addressDomicile).toBeUndefined();
    expect(p.personal.birthDate).toBeUndefined(); // year/age is HR-only by default
    // a teammate sees the phone, the leader sees the emergency contact, HR sees masked identity
    expect((await listDirectory(await org.actor("peer"))).rows.find((r) => r.id === org.ids.junior)!.phone).toBe("+62 812-0000-1111");
    expect((await getProfile(await org.actor("leader"), org.ids.junior)).personal.emergencyContact?.name).toBe("Spouse");
    const hrView = await getProfile(await org.actor("hr"), org.ids.junior);
    expect(hrView.personal.nik).toBe("•••• 8901");
    expect(hrView.personal.ptkp).toBe("K/2");
  });

  it("HR can open or restrict fields, but identity/bank/family stay HR-only", async () => {
    const hr = await org.actor("hr");
    await setVisibility(hr, { phone: "EVERYONE", birthday: "HR" });
    const { rows } = await listDirectory(await org.actor("designer"));
    expect(rows.find((r) => r.id === org.ids.junior)!.phone).toBe("+62 812-0000-1111");
    expect(rows.find((r) => r.id === org.ids.junior)!.birthday).toBeNull();
    await expectError(setVisibility(hr, { bank: "EVERYONE" }), "VALIDATION", /HR only/);
    await expectError(setVisibility(await org.actor("leader"), { phone: "HR" }), "FORBIDDEN");
  });
});

describe("personal data", () => {
  it("is encrypted at rest and only revealed to the employee or HR, with an audit entry", async () => {
    const row = await db.employeePersonalData.findUniqueOrThrow({ where: { employeeId: org.ids.junior } });
    expect(row.nikEncrypted).not.toContain("3171012345678901");
    expect(row.bankAccountEncrypted).not.toContain("1234567890");
    expect(await revealSensitive(await org.actor("junior"), org.ids.junior, "nik")).toBe("3171012345678901");
    expect(await revealSensitive(await org.actor("hr"), org.ids.junior, "bank")).toBe("1234567890");
    await expectError(revealSensitive(await org.actor("leader"), org.ids.junior, "nik"), "FORBIDDEN");
    expect(await db.auditLog.count({ where: { action: "people.sensitive.reveal" } })).toBe(2);
    const logs = await db.auditLog.findMany({ where: { entityType: "EmployeePersonalData" } });
    expect(JSON.stringify(logs)).not.toContain("3171012345678901");
  });

  it("employees self-serve contact details only; NIK must be unique", async () => {
    const junior = await org.actor("junior");
    await updatePersonalData(junior, org.ids.junior, { phone: "+62 811-1111-2222", emergencyContactName: "Mother" });
    await expectError(updatePersonalData(junior, org.ids.junior, { bankAccountNumber: "999999999" }), "FORBIDDEN", /HR/);
    await expectError(updatePersonalData(junior, org.ids.peer, { phone: "+62 811-1111-2222" }), "FORBIDDEN");
    await expectError(updatePersonalData(await org.actor("hr"), org.ids.peer, { nik: "3171012345678901" }), "CONFLICT");
    await expectError(updatePersonalData(await org.actor("hr"), org.ids.peer, { nik: "123" }), "VALIDATION", /16 digits/);
  });
});

describe("join date", () => {
  it("HR can change it; the initial level, team and leader records move with it; employees can't", async () => {
    await expectError(updatePersonalData(await org.actor("junior"), org.ids.junior, { joinDate: "2024-03-01" }), "FORBIDDEN");
    await updatePersonalData(await org.actor("hr"), org.ids.junior, { joinDate: "2024-03-01" });
    const e = await db.employee.findUniqueOrThrow({ where: { id: org.ids.junior }, include: { levelAssignments: true, memberships: true, reportsTo: true } });
    expect(e.startDate.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect(e.levelAssignments[0].effectiveFrom.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect(e.memberships[0].effectiveFrom.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect(e.reportsTo[0].effectiveFrom.toISOString().slice(0, 10)).toBe("2024-03-01");
    expect((await getProfile(await org.actor("designer"), org.ids.junior)).tenure?.label).toBe("2 yrs 8 mo");
    expect(await db.auditLog.count({ where: { action: "employee.join_date.update" } })).toBe(1);
  });
});
