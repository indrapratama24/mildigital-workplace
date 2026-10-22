// Team Directory CSV import / export ("today" = 2 Nov 2026).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { EMPLOYEE_CSV_COLUMNS, employeeCsvTemplate, employeesExportCsv, importEmployeesCsvV2 } from "@/server/services/employee-import";
import { effectiveOn } from "@/server/services/org";
import { buildOrg, resetDb, type Org } from "./helpers";

let org: Org;
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
});

const header = EMPLOYEE_CSV_COLUMNS.join(",");
const row = (cells: Partial<Record<(typeof EMPLOYEE_CSV_COLUMNS)[number], string>>) => EMPLOYEE_CSV_COLUMNS.map((c) => cells[c] ?? "").join(",");

describe("Team CSV import", () => {
  it("checks rows first, then creates new people (leaders may be in the same file) and updates existing ones", async () => {
    const hr = await org.actor("hr");
    const level = await db.employeeLevel.findFirstOrThrow({ where: { id: org.levels.JUNIOR } });
    const senior = await db.employeeLevel.findFirstOrThrow({ where: { id: org.levels.MANAGER } });
    const existing = await db.employee.findUniqueOrThrow({ where: { id: org.ids.junior } });
    expect(employeeCsvTemplate().split("\n")[0]).toBe(header);

    const bad = await importEmployeesCsvV2(hr, [header, row({ employee_id: "N-1", full_name: "No Level", email: "x@test.id", job_title: "X", start_date: "2026-11-01", role: "HR" })].join("\n"), false);
    expect(bad.dryRun).toBe(true);
    expect(bad.rows[0].errors.join(" ")).toMatch(/level is required.*|EMPLOYEE or LEADER/);
    expect(await db.employee.count({ where: { employeeCode: "N-1" } })).toBe(0);

    const csv = [
      header,
      row({ employee_id: "N-LEAD", full_name: "New Lead", nickname: "Lead", email: "newlead@test.id", job_title: "Team Lead", level: senior.code, start_date: "01/10/2026", role: "LEADER", employment_status: "PERMANENT", leave_eligible_since: "2026-10-01" }),
      row({ employee_id: "N-MEMBER", full_name: "New Member", email: "member@test.id", job_title: "Marketer", level: level.name, start_date: "2026-11-01", leader: "N-LEAD", phone: "+62 811 222 333" }),
      row({ employee_id: existing.employeeCode, job_title: "Senior Marketer", nickname: "Juju", level: senior.code }),
    ].join("\n");
    const dry = await importEmployeesCsvV2(hr, csv, true);
    expect(dry.rows.map((r) => [r.action, r.errors])).toEqual([["create", []], ["create", []], ["update", []]]);

    const done = await importEmployeesCsvV2(hr, csv, false);
    expect([done.created, done.updated, done.failed]).toEqual([2, 1, 0]);
    const member = await db.employee.findUniqueOrThrow({ where: { employeeCode: "N-MEMBER" }, include: { reportsTo: { include: { leader: true } }, personalData: true } });
    expect(member.employmentStatus).toBe("PROBATION");
    expect(member.reportsTo[0].leader.employeeCode).toBe("N-LEAD");
    expect(member.personalData?.phone).toBe("+62 811 222 333");
    const lead = await db.employee.findUniqueOrThrow({ where: { employeeCode: "N-LEAD" }, include: { user: true } });
    expect([lead.nickname, lead.user?.role, lead.fullTimeSince?.toISOString().slice(0, 10)]).toEqual(["Lead", "LEADER", "2026-10-01"]);
    const updated = await db.employee.findUniqueOrThrow({ where: { id: existing.id }, include: { levelAssignments: { where: effectiveOn("2026-11-02") } } });
    expect([updated.jobTitle, updated.nickname, updated.fullName]).toEqual(["Senior Marketer", "Juju", existing.fullName]); // empty cells keep values
    expect(updated.levelAssignments[0].levelId).toBe(org.levels.MANAGER);

    const exported = await employeesExportCsv(hr);
    expect(exported.split("\n")[0]).toBe(header);
    expect(exported).toContain("newlead@test.id");
    await expect(importEmployeesCsvV2(await org.actor("junior"), csv, true)).rejects.toBeInstanceOf(DomainError);
  });
});
