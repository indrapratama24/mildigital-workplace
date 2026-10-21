// Client & Portfolio, Company Hub and access grants against PostgreSQL ("today" = 2 Nov 2026).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { can } from "@/server/authz";
import { changeClientStatus, clientsForEmployee, createClient, getClient, listClients, removePackage, updateClient, type CreateClientInput } from "@/server/services/clients";
import { portfolioSummary } from "@/server/services/client-metrics";
import {
  acknowledgeRegulation,
  announcementsFor,
  createRegulation,
  getRegulation,
  listRegulations,
  pendingAcknowledgements,
  publishRegulation,
  saveAnnouncement,
  saveRegulationDraft,
} from "@/server/services/workplace";
import { setGrants } from "@/server/services/access";
import { fromISO } from "@/lib/dates";
import { buildOrg, resetDb, type Org } from "./helpers";

let org: Org;
let pkg: { advance: string; basic: string };

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

const manager = async () => {
  const u = await org.actor("leader");
  await db.permissionGrant.createMany({ data: ["client.manage", "client.export"].map((permission) => ({ userId: u.userId, permission })), skipDuplicates: true });
  return org.actor("leader");
};

const input = (over: Partial<CreateClientInput> = {}): CreateClientInput => ({
  name: "Kopi Senja",
  status: "ACTIVE",
  dateStart: "2025-03-01",
  packageId: pkg.advance,
  team: { primary: org.ids.principal, secondary: null, additional: [], adsStrategists: [] },
  ...over,
});

/** Update payload without the create-only status fields. */
const upd = (code: string, over: Partial<CreateClientInput> = {}) => {
  const { status: _s, dateOff: _d, statusEffectiveDate: _e, clientCode: _c, ...rest } = input(over);
  return { ...rest, clientCode: code };
};

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-02T03:00:00Z") });
});
afterAll(async () => {
  vi.useRealTimers();
  await db.$disconnect();
});
beforeEach(async () => {
  await resetDb();
  await db.$executeRawUnsafe(`ALTER SEQUENCE "client_code_seq" RESTART WITH 1`);
  org = await buildOrg();
  pkg = {
    advance: (await db.clientPackage.create({ data: { name: "Advance", sortOrder: 1 } })).id,
    basic: (await db.clientPackage.create({ data: { name: "Basic", sortOrder: 3 } })).id,
  };
});

describe("Access", () => {
  it("client editing needs a granted permission, not seniority", async () => {
    const leader = await org.actor("leader");
    expect(can(leader, "client.manage")).toBe(false);
    await expectError(createClient(leader, input()), "FORBIDDEN");
    await expectError(setGrants(leader, leader.userId, ["client.manage"]), "FORBIDDEN");
    await setGrants(await org.actor("admin"), leader.userId, ["client.manage", "client.sensitive"]);
    const granted = await org.actor("leader");
    expect(can(granted, "client.manage")).toBe(true);
    await expectError(setGrants(await org.actor("admin"), leader.userId, ["settings.manage"]), "VALIDATION");
    expect((await createClient(granted, input())).clientCode).toBe("MIL-CL-0001");
  });
});

describe("Client records", () => {
  it("Client IDs are unique, sequential and never reused", async () => {
    const m = await manager();
    const a = await createClient(m, input());
    const b = await createClient(m, input({ name: "Batik Lestari" }));
    expect([a.clientCode, b.clientCode]).toEqual(["MIL-CL-0001", "MIL-CL-0002"]);
    await expectError(createClient(m, input({ name: "Dup", clientCode: "MIL-CL-0001" })), "CONFLICT");
    const base = upd("MIL-CL-0099");
    await expectError(updateClient(m, a.id, base), "FORBIDDEN"); // ID change needs administrator rights
    await updateClient(await org.actor("admin"), a.id, base);
    await expectError(createClient(m, input({ name: "Reuse", clientCode: "MIL-CL-0001" })), "CONFLICT", /never reused/);
    expect((await createClient(m, input({ name: "Third" }))).clientCode).toBe("MIL-CL-0003");
  });

  it("validates Date START / Date OFF and the team", async () => {
    const m = await manager();
    await expectError(createClient(m, input({ status: "INACTIVE" })), "VALIDATION", /Date OFF is required/);
    await expectError(createClient(m, input({ status: "INACTIVE", dateOff: "2025-01-01" })), "VALIDATION", /earlier than Date START/);
    await expectError(createClient(m, input({ team: { primary: null, secondary: null, additional: [], adsStrategists: [] } })), "VALIDATION", /Consultant 1/);
    await expectError(
      createClient(m, input({ team: { primary: org.ids.principal, secondary: null, additional: [], adsStrategists: [org.ids.junior, org.ids.peer, org.ids.leader2, org.ids.hr] } })),
      "VALIDATION",
      /at most 3/,
    );
    await expectError(createClient(m, input({ team: { primary: org.ids.principal, secondary: org.ids.principal, additional: [], adsStrategists: [] } })), "VALIDATION", /one role/);
    const ok = await createClient(m, input({ waivePrimary: true, waiverReason: "Onboarding, consultant TBD", team: { primary: null, secondary: null, additional: [], adsStrategists: [] } }));
    expect(ok.primaryConsultantWaived).toBe(true);
  });

  it("the database also caps Ads Strategists at three", async () => {
    const m = await manager();
    const c = await createClient(m, input({ team: { primary: org.ids.principal, secondary: null, additional: [], adsStrategists: [org.ids.junior, org.ids.peer, org.ids.leader2] } }));
    await expect(db.clientTeamAssignment.create({ data: { brandId: c.id, employeeId: org.ids.hr, role: "ADS_STRATEGIST", effectiveFrom: fromISO("2026-11-02") } })).rejects.toThrow();
    await expect(db.clientTeamAssignment.deleteMany({ where: { brandId: c.id } })).rejects.toThrow(); // history is never deleted
  });

  it("team changes close assignments and keep history; profiles read the same records", async () => {
    const m = await manager();
    const c = await createClient(m, input({ team: { primary: org.ids.principal, secondary: org.ids.junior, additional: [], adsStrategists: [org.ids.peer] } }));
    expect((await clientsForEmployee(org.ids.junior)).map((x) => x.role)).toEqual(["CONSULTANT_SECONDARY"]);
    await updateClient(m, c.id, upd(c.clientCode, { team: { primary: org.ids.principal, secondary: null, additional: [org.ids.junior], adsStrategists: [] } }));
    const detail = await getClient(m, c.id);
    expect(detail.consultant2).toBeNull();
    expect(detail.additional.map((p) => p.id)).toEqual([org.ids.junior]);
    expect(detail.assignmentHistory.filter((a) => a.to !== null).map((a) => a.role).sort()).toEqual(["ADS_STRATEGIST", "CONSULTANT_SECONDARY"]);
    expect(await clientsForEmployee(org.ids.peer)).toEqual([]);
  });

  it("sensitive client data is limited to managers and the assigned team", async () => {
    const m = await manager();
    const c = await createClient(m, input({ picName: "Pak Demo", picContact: "+62 800", internalNotes: "Renewal risk" }));
    expect((await getClient(await org.actor("junior"), c.id)).picContact).toBeNull();
    expect((await getClient(await org.actor("principal"), c.id)).picContact).toBe("+62 800"); // Consultant 1
    expect((await getClient(m, c.id)).picContact).toBeNull(); // client.manage alone doesn't include client.sensitive
  });
});

describe("Status history & portfolio counts", () => {
  it("freeze, inactive and reactivation are effective-dated and keep Date START", async () => {
    const m = await manager();
    const c = await createClient(m, input({ dateStart: "2025-03-01" }));
    await changeClientStatus(m, c.id, { status: "FREEZE", effectiveDate: "2026-08-01", reason: "Budget hold" });
    await expectError(changeClientStatus(m, c.id, { status: "INACTIVE" }), "VALIDATION", /Date OFF is required/);
    await changeClientStatus(m, c.id, { status: "INACTIVE", dateOff: "2026-09-15" });
    await expectError(changeClientStatus(m, c.id, { status: "ACTIVE", effectiveDate: "2026-12-01" }), "VALIDATION", /future/);
    await changeClientStatus(m, c.id, { status: "ACTIVE", effectiveDate: "2026-10-20", reason: "Renewed" });
    const d = await getClient(m, c.id);
    expect(d.dateStart).toBe("2025-03-01");
    expect(d.dateOff).toBeNull();
    expect(d.statusHistory.map((h) => [h.status, h.from, h.to])).toEqual([
      ["ACTIVE", "2025-03-01", "2026-07-31"],
      ["FREEZE", "2026-08-01", "2026-09-15"],
      ["INACTIVE", "2026-09-16", "2026-10-19"],
      ["ACTIVE", "2026-10-20", null],
    ]);
    expect(d.engagements.map((e) => [e.start, e.end])).toEqual([["2025-03-01", "2026-09-15"], ["2026-10-20", null]]);
    expect(d.period.reactivated).toBe(true);

    // Past months keep their counts; a reactivation is not a new client.
    const aug = await portfolioSummary(2026, 8);
    const sep = await portfolioSummary(2026, 9);
    const oct = await portfolioSummary(2026, 10);
    expect([aug.active, aug.freeze, aug.inactive]).toEqual([0, 1, 0]);
    expect([sep.active, sep.inactive]).toEqual([0, 1]);
    expect([oct.active, oct.newThisPeriod]).toEqual([1, 0]);
  });

  it("counts new clients by first Date START and excludes archived records", async () => {
    const m = await manager();
    await createClient(m, input({ name: "Old", dateStart: "2024-01-01" }));
    await createClient(m, input({ name: "New", dateStart: "2026-11-01" }));
    const nov = await portfolioSummary(2026, 11);
    expect([nov.total, nov.active, nov.newThisPeriod]).toEqual([2, 2, 1]);
    expect(nov.byPackage[0]).toMatchObject({ label: "Advance", count: 2 });
    const { rows } = await listClients(m, { status: "ACTIVE", sort: "start_asc" });
    expect(rows.map((r) => r.name)).toEqual(["Old", "New"]);
  });

  it("package changes are dated and used packages are archived, not deleted", async () => {
    const m = await manager();
    const c = await createClient(m, input({ dateStart: "2026-01-01" }));
    await updateClient(m, c.id, upd(c.clientCode, { dateStart: "2026-01-01", packageId: pkg.basic }));
    const d = await getClient(m, c.id);
    expect(d.package?.name).toBe("Basic");
    expect(d.engagements[0].packages.map((p) => [p.name, p.to])).toEqual([["Advance", "2026-11-01"], ["Basic", null]]);
    const admin = await org.actor("admin");
    expect((await removePackage(admin, pkg.advance)).mode).toBe("archived");
    const unused = await db.clientPackage.create({ data: { name: "Trial" } });
    expect((await removePackage(admin, unused.id)).mode).toBe("deleted");
  });
});

describe("Company Hub", () => {
  it("regulations: drafts are hidden, revisions keep the published version, acknowledgements per version", async () => {
    const hr = await org.actor("hr");
    const emp = await org.actor("junior");
    const r = await createRegulation(hr, { title: "Hybrid Work Policy", category: "HR", body: "Rules for hybrid work at MIL.", effectiveDate: "2026-01-01", requiresAcknowledgement: true });
    expect(await listRegulations(emp)).toEqual([]);
    await expectError(getRegulation(emp, r.id), "NOT_FOUND");
    await expectError(createRegulation(emp, { title: "X", category: "HR", body: "xxxxxxxxxxxx", effectiveDate: "2026-01-01", requiresAcknowledgement: false }), "FORBIDDEN");
    await publishRegulation(hr, r.id);
    expect(await pendingAcknowledgements(emp.employeeId)).toEqual([{ id: r.id, title: "Hybrid Work Policy" }]);
    await acknowledgeRegulation(emp, r.id);
    expect(await pendingAcknowledgements(emp.employeeId)).toEqual([]);

    await saveRegulationDraft(hr, r.id, { title: "Hybrid Work Policy", category: "HR", body: "Updated rules.", effectiveDate: "2027-01-01", requiresAcknowledgement: true, changeNote: "2027 update" });
    const seen = await getRegulation(emp, r.id);
    expect(seen.publishedVersion?.version).toBe(1);
    expect(seen.versions.map((v) => v.version)).toEqual([1]); // the draft v2 is not visible
    await publishRegulation(hr, r.id);
    expect(await pendingAcknowledgements(emp.employeeId)).toHaveLength(1); // new version → acknowledge again
    expect((await getRegulation(emp, r.id)).versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("announcements respect status, schedule, expiry and audience", async () => {
    const hr = await org.actor("hr");
    const base = { body: "Hello team", category: "Update", priority: "NORMAL" as const, status: "PUBLISHED" as const };
    await saveAnnouncement(hr, null, { ...base, title: "Everyone", publishAt: "2026-11-01T00:00:00Z", audienceType: "ALL" });
    await saveAnnouncement(hr, null, { ...base, title: "Draft", status: "DRAFT", publishAt: "2026-11-01T00:00:00Z", audienceType: "ALL" });
    await saveAnnouncement(hr, null, { ...base, title: "Future", publishAt: "2026-12-01T00:00:00Z", audienceType: "ALL" });
    await saveAnnouncement(hr, null, { ...base, title: "Expired", publishAt: "2026-10-01T00:00:00Z", expiresAt: "2026-10-31T00:00:00Z", audienceType: "ALL" });
    await saveAnnouncement(hr, null, { ...base, title: "Just you", publishAt: "2026-11-01T00:00:00Z", audienceType: "EMPLOYEES", employeeIds: [org.ids.principal] });
    await expectError(saveAnnouncement(hr, null, { ...base, title: "No target", publishAt: "2026-11-01T00:00:00Z", audienceType: "TEAMS", teamIds: [] }), "VALIDATION");
    expect((await announcementsFor(org.ids.junior)).map((a) => a.title)).toEqual(["Everyone"]);
    expect((await announcementsFor(org.ids.principal)).map((a) => a.title).sort()).toEqual(["Everyone", "Just you"]);
  });
});
