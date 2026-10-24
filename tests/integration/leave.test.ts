// Annual leave policy, final approval and year-end choice ("today" = 2 Nov 2026 unless set otherwise).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { decide } from "@/server/services/approvals";
import { annualRuleIssues, leaveBalance, requestTypesForForm, setYearEndChoice, submitRequest, yearEndStatus } from "@/server/services/requests";
import { upsertRequestType } from "@/server/services/admin";
import { parseLevelExceptions, type LevelException } from "@/lib/engine/request-rules";
import { fromISO } from "@/lib/dates";
import { buildOrg, key, pendingStepFor, resetDb, type Org } from "./helpers";

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
  vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
  await resetDb();
  org = await buildOrg();
  await db.requestType.update({ where: { id: org.types.ANNUAL }, data: { annualRules: true, monthlyAccrual: true, eligibleStatuses: ["PERMANENT"], advanceNoticeDays: 14, delegation: "OPTIONAL" } });
  await db.employee.updateMany({ data: { employmentStatus: "PERMANENT", fullTimeSince: fromISO("2025-01-01") } });
});

const annual = (startDate: string, endDate: string) => ({ requestTypeId: org.types.ANNUAL, startDate, endDate, durationType: "FULL_DAY" as const, reason: "Family holiday trip", idempotencyKey: key() });
const approved = (employeeId: string, start: string, end: string, days: number) =>
  db.request.create({ data: { employeeId, requestTypeId: org.types.ANNUAL, status: "APPROVED", startDate: fromISO(start), endDate: fromISO(end), workingDays: days, reason: "x", idempotencyKey: key() } });

describe("Annual leave rules", () => {
  it("needs 14 days' notice and enforces the tiers", async () => {
    const junior = await org.actor("junior");
    await expectError(submitRequest(junior, annual("2026-11-10", "2026-11-10")), "VALIDATION", /14 day/);
    await approved(org.ids.junior, "2026-03-02", "2026-03-13", 10);
    await expectError(submitRequest(junior, annual("2026-11-23", "2026-11-30")), "VALIDATION", /at most 5/);
    const ok = await submitRequest(junior, annual("2026-11-23", "2026-11-25"));
    expect(ok.status).toBe("PENDING_LEADER");
  });

  it("limits how many people are on leave on the same date", async () => {
    // 7 employees in the test org → 20% = 1 person at a time
    await approved(org.ids.peer, "2026-12-01", "2026-12-04", 4);
    const issues = await annualRuleIssues(db, org.ids.junior, { id: org.types.ANNUAL, annualRules: true }, { startDate: "2026-12-03", endDate: "2026-12-03" }, ["2026-12-03"], 1);
    expect(issues[0]).toMatch(/at most 20% of the team \(1 of 7\)/);
  });
});

describe("Final approval after the leader", () => {
  it("adds the configured approver after the leader, and can be switched off", async () => {
    await db.systemSetting.createMany({ data: [{ key: "finalApproverEmployeeId", value: org.ids.admin }, { key: "finalApprovalRequestTypes", value: [org.types.ANNUAL] }] });
    const junior = await org.actor("junior");
    const r = await submitRequest(junior, annual("2026-11-23", "2026-11-24"));
    await decide(await org.actor("leader"), (await pendingStepFor(org.ids.leader))!.id, "APPROVE", "OK from me");
    expect((await db.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING_LEADER");
    const final = await pendingStepFor(org.ids.admin);
    expect(final?.kind).toBe("FINAL");
    await decide(await org.actor("admin"), final!.id, "APPROVE", "Approved");
    expect((await db.request.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("APPROVED");

    // Off: no final step
    await db.systemSetting.update({ where: { key: "finalApproverEmployeeId" }, data: { value: null as never } });
    const r2 = await submitRequest(junior, annual("2027-01-25", "2027-01-25"));
    await decide(await org.actor("leader"), (await pendingStepFor(org.ids.leader))!.id, "APPROVE", "OK");
    expect((await db.request.findUniqueOrThrow({ where: { id: r2.id } })).status).toBe("APPROVED");
  });
});

describe("Year-end leftover", () => {
  it("opens before 31 Dec, caps at 6 days, and carried days count until June", async () => {
    const junior = await org.actor("junior");
    await approved(org.ids.junior, "2026-03-02", "2026-03-06", 5); // 12 − 5 = 7 left
    expect((await yearEndStatus(org.ids.junior))?.open).toBe(false);
    await expectError(setYearEndChoice(junior, { option: "CARRY", days: 6 }), "INVALID_STATE");

    vi.setSystemTime(new Date("2026-12-05T03:00:00Z"));
    const st = await yearEndStatus(org.ids.junior);
    expect([st?.open, st?.projectedRemaining, st?.tradable]).toEqual([true, 7, 6]);
    await expectError(setYearEndChoice(junior, { option: "CARRY", days: 7 }), "VALIDATION");
    await setYearEndChoice(junior, { option: "CARRY", days: 6 });

    const may = await leaveBalance(db, org.ids.junior, org.types.ANNUAL, 2027, undefined, "2027-05-10");
    expect([may?.carryIn, may?.entitled]).toEqual([6, 5 + 6]); // Jan–May earned + carried
    await approved(org.ids.junior, "2027-04-05", "2027-04-06", 2);
    const aug = await leaveBalance(db, org.ids.junior, org.types.ANNUAL, 2027, undefined, "2027-08-02");
    expect(aug?.carryIn).toBe(2); // only the carried days used before the June cut-off count
  });
});

describe("Exceptions by level", () => {
  const save = async (levelExceptions: LevelException[]) => {
    const t = await db.requestType.findUniqueOrThrow({ where: { id: org.types.ANNUAL } });
    const { createdAt: _c, updatedAt: _u, sortOrder: _s, levelExceptions: _l, description, ...rest } = t;
    return upsertRequestType(await org.actor("admin"), { ...rest, description: description ?? undefined, levelExceptions });
  };

  it("gives leaders their own notice period and entitlement; everyone else keeps the type's rules", async () => {
    await save([{ name: "Leaders", levelIds: [org.levels.MANAGER], advanceNoticeDays: 30, defaultEntitlement: 15 }]);
    expect(parseLevelExceptions((await db.requestType.findUniqueOrThrow({ where: { id: org.types.ANNUAL } })).levelExceptions)).toEqual([
      { name: "Leaders", levelIds: [org.levels.MANAGER], advanceNoticeDays: 30, defaultEntitlement: 15 },
    ]);
    // 21 days ahead: fine for a junior (14 days' notice), too soon for a leader (30)
    await expectError(submitRequest(await org.actor("leader"), annual("2026-11-23", "2026-11-23")), "VALIDATION", /30 day/);
    expect((await submitRequest(await org.actor("junior"), annual("2026-11-23", "2026-11-23"))).status).not.toBe("DRAFT");

    expect((await leaveBalance(db, org.ids.leader, org.types.ANNUAL, 2026))!.yearly).toBe(15);
    expect((await leaveBalance(db, org.ids.junior, org.types.ANNUAL, 2026))!.yearly).toBe(12);

    const forLeader = (await requestTypesForForm(org.ids.leader)).find((t) => t.id === org.types.ANNUAL)!;
    expect(forLeader).toMatchObject({ exceptionName: "Leaders", advanceNoticeDays: 30 });
    expect((await requestTypesForForm(org.ids.junior)).find((t) => t.id === org.types.ANNUAL)).toMatchObject({ exceptionName: null, advanceNoticeDays: 14 });
  });

  it("rejects a level used twice, unknown levels and exceptions that change nothing", async () => {
    await expectError(save([{ name: "Leaders", levelIds: [org.levels.MANAGER], advanceNoticeDays: 30 }, { name: "Seniors", levelIds: [org.levels.MANAGER, org.levels.PRINCIPAL], advanceNoticeDays: 7 }]), "VALIDATION", /only be in one/);
    await expectError(save([{ name: "Ghosts", levelIds: ["nope"], advanceNoticeDays: 7 }]), "VALIDATION", /no longer exists/);
    await expectError(save([{ name: "Leaders", levelIds: [org.levels.MANAGER] }]), "VALIDATION", /doesn't change/);
    // removing all exceptions works
    await save([]);
    expect((await db.requestType.findUniqueOrThrow({ where: { id: org.types.ANNUAL } })).levelExceptions).toEqual([]);
  });
});
