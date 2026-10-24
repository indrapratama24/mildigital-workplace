// Default work plans, auto-approval on the 1st, and Team Directory bulk edit.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, withTx } from "@/server/db";
import { DomainError } from "@/server/errors";
import { autoApproveMetPlan, getPlannerData, prefillDefaultPlan, resetDraft, saveDraft } from "@/server/services/schedules";
import { loadMonthContext } from "@/server/services/calendar";
import { bulkEditEmployees } from "@/server/services/bulk";
import { runDailyJobs } from "@/server/services/jobs";
import { todayJakarta } from "@/lib/dates";
import { buildOrg, resetDb, type Org } from "./helpers";

let org: Org;
const at = (iso: string) => vi.setSystemTime(new Date(`${iso}T03:00:00Z`));

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-20T03:00:00Z") });
});
afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});
beforeEach(async () => {
  at("2026-11-20");
  await resetDb();
  org = await buildOrg();
});

describe("Default work plan", () => {
  it("prefills mandatory days as WFO and the rest as WFH, without overwriting planned days", async () => {
    const junior = await org.actor("junior"); // 75%, mandatory Mon/Wed/Thu
    const data = await getPlannerData(junior, org.ids.junior, 2026, 12);
    const plannable = data.days.filter((d) => d.plannable);
    expect(plannable.length).toBeGreaterThan(0);
    for (const d of plannable) expect(d.planned).toBe(d.mandatory ? "WFO" : "WFH");
    // a day the employee changed stays as it is; reset goes back to the default
    const tue = plannable.find((d) => !d.mandatory)!.date;
    await saveDraft(junior, { employeeId: org.ids.junior, year: 2026, month: 12, modes: { [tue]: "WFO" } });
    expect(await withTx((tx) => prefillDefaultPlan(tx, org.ids.junior, 2026, 12))).toBe(false);
    expect((await loadMonthContext(org.ids.junior, 2026, 12)).plannedModes[tue]).toBe("WFO");
    await resetDraft(junior, { employeeId: org.ids.junior, year: 2026, month: 12 });
    expect((await loadMonthContext(org.ids.junior, 2026, 12)).plannedModes[tue]).toBe("WFH");
  });

  it("on the 1st, plans that meet the requirement are submitted and approved automatically", async () => {
    // Principal: 50% with Mon/Tue/Wed mandatory → the default (60% WFO) meets it. Junior's default (Mon/Wed/Thu of 75%) falls short.
    await db.policyVersion.updateMany({ where: { policyId: org.policies.PRINCIPAL }, data: { mandatoryWeekdays: [1, 2, 3], flexibleWeekdays: [4, 5] } });
    const prepared = await runDailyJobs(new Date("2026-11-20T03:00:00Z"));
    expect(prepared.plansPrefilled).toBeGreaterThanOrEqual(2); // December prepared ahead
    expect((await db.monthlySchedule.findFirstOrThrow({ where: { employeeId: org.ids.principal, year: 2026, month: 12 } })).status).toBe("DRAFT");

    expect(prepared.plansAutoApproved).toBe(0); // only on the 1st
    at("2026-12-01");
    expect(todayJakarta()).toBe("2026-12-01");
    expect((await runDailyJobs(new Date("2026-12-01T03:00:00Z"))).plansAutoApproved).toBe(1);
    expect(await autoApproveMetPlan(org.ids.principal, 2026, 12)).toBe("skipped");
    expect(await autoApproveMetPlan(org.ids.junior, 2026, 12)).toBe("short");
    const principal = await db.monthlySchedule.findFirstOrThrow({ where: { employeeId: org.ids.principal, year: 2026, month: 12 }, include: { days: true } });
    expect(principal.status).toBe("APPROVED");
    expect(principal.days.every((d) => d.approvedMode === d.plannedMode)).toBe(true);
    expect((await db.monthlySchedule.findFirstOrThrow({ where: { employeeId: org.ids.junior, year: 2026, month: 12 } })).status).toBe("DRAFT");
    const user = (await db.employee.findUniqueOrThrow({ where: { id: org.ids.principal } })).userId!;
    expect(await db.notification.count({ where: { userId: user, type: "SCHEDULE_APPROVED" } })).toBe(1);
  });
});

describe("Team Directory bulk edit", () => {
  it("saves each row's own values; level and leader are dated, leave adds up; failures are per person", async () => {
    const admin = await org.actor("admin");
    const dept = await db.department.create({ data: { code: "CRE", name: "Creative" } });
    const team = await db.team.create({ data: { name: "Studio", departmentId: dept.id } });
    const today = todayJakarta();
    const opts = { effectiveFrom: "2026-12-01", reason: "Promotion round", leaveTypeId: org.types.ANNUAL, leaveYear: 2026 };
    const r = await bulkEditEmployees(
      admin,
      [
        { id: org.ids.junior, patch: { teamId: team.id, departmentId: dept.id, levelId: org.levels.PRINCIPAL, leaveDays: 2 } },
        { id: org.ids.peer, patch: { jobTitle: "Senior Analyst", leaveDays: -0.5 } },
        { id: org.ids.principal, patch: {} }, // untouched rows are ignored
      ],
      opts,
    );
    expect(r).toEqual({ updated: 2, failed: [] });
    const junior = await db.employee.findUniqueOrThrow({ where: { id: org.ids.junior } });
    expect(junior.departmentId).toBe(dept.id);
    const m = await db.employeeTeamMembership.findFirstOrThrow({ where: { employeeId: org.ids.junior, effectiveTo: null } });
    expect([m.teamId, m.effectiveFrom.toISOString().slice(0, 10)]).toEqual([team.id, today]);
    expect((await loadMonthContext(org.ids.junior, 2026, 12)).policy?.version.wfoPercent).toBe(50);
    expect((await db.employee.findUniqueOrThrow({ where: { id: org.ids.peer } })).jobTitle).toBe("Senior Analyst");
    expect((await db.leaveBalance.findFirstOrThrow({ where: { employeeId: org.ids.junior, year: 2026 } })).adjustedDays).toBe(2);
    expect((await db.leaveBalance.findFirstOrThrow({ where: { employeeId: org.ids.peer, year: 2026 } })).adjustedDays).toBe(-0.5);

    // leader2 can't report to themself → only that row fails
    const r2 = await bulkEditEmployees(admin, [{ id: org.ids.leader2, patch: { leaderId: org.ids.leader2 } }, { id: org.ids.peer, patch: { leaderId: org.ids.leader2, leaveDays: 1 } }], { ...opts, effectiveFrom: today });
    expect(r2.updated).toBe(1);
    expect(r2.failed.map((f) => f.id)).toEqual([org.ids.leader2]);
    expect((await db.leaveBalance.findFirstOrThrow({ where: { employeeId: org.ids.peer, year: 2026 } })).adjustedDays).toBe(0.5);

    await expect(bulkEditEmployees(await org.actor("leader"), [{ id: org.ids.junior, patch: { teamId: team.id } }], opts)).rejects.toBeInstanceOf(DomainError);
    await expect(bulkEditEmployees(admin, [{ id: org.ids.junior, patch: { levelId: org.levels.MANAGER } }], { ...opts, reason: "" })).rejects.toThrow(/reason/);
    expect(await db.auditLog.count({ where: { action: "leaveBalance.adjust" } })).toBe(3);
  });
});
