// Client & Portfolio, Company Hub and access grants against PostgreSQL ("today" = 2 Nov 2026).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/server/db";
import { DomainError } from "@/server/errors";
import { can } from "@/server/authz";
import { changeClientStatus, clientsForEmployee, createClient, getClient, listClients, removePackage, updateClient, type CreateClientInput } from "@/server/services/clients";
import { portfolioSummary, portfolioVisibleFor } from "@/server/services/client-metrics";
import { DEFAULT_SETTINGS, getSettings, updateSettings } from "@/server/services/settings";
import { clientCsvTemplate, importClientsCsv } from "@/server/services/client-import";
import { CLIENT_CSV_COLUMNS, clientsExportCsv } from "@/server/services/clients";
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
  saveSection,
  deleteSection,
  listSections,
  saveHubCategory,
  deleteHubCategory,
  listHubCategories,
  hubCategoryBySlug,
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
    await expectError(createClient(m, input({ team: { primary: null, secondary: null, additional: [], adsStrategists: [] } })), "VALIDATION", /Consultant/);
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
    const c = await createClient(m, input({ picName: "Pak Demo", picPhone: "+62 800 1234", picEmail: "Pic@Brand.id", internalNotes: "Renewal risk" }));
    expect((await getClient(await org.actor("junior"), c.id)).picPhone).toBeNull();
    const assigned = await getClient(await org.actor("principal"), c.id); // Consultant
    expect([assigned.picPhone, assigned.picEmail]).toEqual(["+62 800 1234", "pic@brand.id"]);
    expect((await getClient(m, c.id)).picEmail).toBeNull(); // client.manage alone doesn't include client.sensitive
    await expectError(createClient(m, input({ name: "Bad", picEmail: "not-an-email" })), "VALIDATION", /PIC email/);
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

describe("Classification, ad accounts and CSV import", () => {
  it("industries and sub-industries are created once and reused; ad accounts can be extended", async () => {
    const m = await manager();
    const fashion = await db.clientCategory.create({ data: { name: "Retail-Fashion" } });
    await db.clientAdAccountType.create({ data: { name: "Meta Regular" } });
    const a = await createClient(m, input({ name: "Alpha", categoryId: fashion.id, industryName: "Apparel", subIndustryName: "Hijab", adAccounts: ["Meta Regular", "New Platform"] }));
    await createClient(m, input({ name: "Beta", categoryId: fashion.id, industryName: "apparel", subIndustryName: "HIJAB", adAccounts: ["meta regular"] }));
    expect(await db.clientIndustry.count()).toBe(1);
    expect(await db.clientSubIndustry.count()).toBe(1);
    expect((await db.clientAdAccountType.findMany()).map((t) => t.name).sort()).toEqual(["Meta Regular", "New Platform"]);
    const d = await getClient(m, a.id);
    expect([d.category, d.industry, d.subIndustry]).toEqual(["Retail-Fashion", "Apparel", "Hijab"]);
    expect(d.adAccounts.sort()).toEqual(["Meta Regular", "New Platform"]);
    await expectError(createClient(m, input({ name: "Charlie", subIndustryName: "Orphan" })), "VALIDATION", /industry/);
  });

  it("imports new clients and updates existing ones from the template columns", async () => {
    const m = await manager();
    const fnb = await db.clientCategory.create({ data: { name: "F&B" } });
    expect(clientCsvTemplate().split("\n")[0]).toBe(CLIENT_CSV_COLUMNS.join(","));
    const emp = await db.employee.findUniqueOrThrow({ where: { id: org.ids.principal } });
    const as = await db.employee.findUniqueOrThrow({ where: { id: org.ids.junior } });
    const header = CLIENT_CSV_COLUMNS.join(",");
    const row = (cells: Partial<Record<(typeof CLIENT_CSV_COLUMNS)[number], string>>) => CLIENT_CSV_COLUMNS.map((c) => cells[c] ?? "").map((v) => (/[,;"]/.test(v) ? `"${v}"` : v)).join(",");
    const csv = [
      header,
      row({ brand_name: "Kopi Import", status: "Active", date_start: "01/03/2025", package: "advance", category: "F&B", industry: "Coffee", sub_industry: "Specialty", ad_accounts: "Meta Regular; TTAM", consultant_1: emp.email, ads_strategists: as.employeeCode, pic_phone: "+62 811 222 333", pic_email: "pic@kopi.id" }),
      row({ brand_name: "Old Brand", status: "Inactive", date_start: "2022-01-01", date_off: "2024-12-31", package: "Basic", consultant_1: emp.email }),
    ].join("\n");

    const bad = await importClientsCsv(m, `${header}\n${row({ brand_name: "X", date_start: "2025-01-01", package: "Gold", consultant_1: "nobody@x.id" })}`, false);
    expect(bad.dryRun).toBe(true); // errors → nothing written
    expect(bad.rows[0].errors.join(" ")).toMatch(/Gold.*|nobody/);
    expect(await db.clientBrand.count()).toBe(0);

    const dry = await importClientsCsv(m, csv, true);
    expect(dry.rows.map((r) => [r.action, r.errors])).toEqual([["create", []], ["create", []]]);
    expect(await db.clientBrand.count()).toBe(0);

    const done = await importClientsCsv(m, csv, false);
    expect([done.created, done.updated, done.failed]).toEqual([2, 0, 0]);
    const { rows } = await listClients(m, { sort: "name" });
    const kopi = rows.find((r) => r.name === "Kopi Import")!;
    expect([kopi.category, kopi.industry, kopi.subIndustry, kopi.dateStart, kopi.package?.name]).toEqual(["F&B", "Coffee", "Specialty", "2025-03-01", "Advance"]);
    expect(kopi.adAccounts.sort()).toEqual(["Meta Regular", "TTAM"]);
    expect(kopi.adsStrategists.map((p) => p.id)).toEqual([org.ids.junior]);
    expect(rows.find((r) => r.name === "Old Brand")?.status).toBe("INACTIVE");
    expect(fnb.id).toBe(kopi.categoryId);

    // Re-import with the Client ID → update, status changes are not applied by import
    const again = await importClientsCsv(m, [header, row({ client_id: kopi.clientCode, brand_name: "Kopi Import 2", status: "Freeze", date_start: "2025-03-01", package: "Basic", consultant_1: emp.email })].join("\n"), false);
    expect([again.created, again.updated]).toEqual([0, 1]);
    expect(again.rows[0].warnings[0]).toMatch(/Status stays active/);
    const updated = (await listClients(m, { q: kopi.clientCode })).rows[0];
    expect([updated.name, updated.status, updated.package?.name, updated.adAccounts]).toEqual(["Kopi Import 2", "ACTIVE", "Basic", []]);

    // Export uses the same columns (people as work emails) so it can be re-imported
    const exported = await clientsExportCsv(m, rows);
    expect(exported.split("\n")[0]).toBe(`${header},period`);
    expect(exported).toContain(emp.email);
    await expectError(importClientsCsv(await org.actor("junior"), csv, true), "FORBIDDEN");
  });
});

describe("Client team change date", () => {
  it("records a PIC change from the chosen date and rejects future dates", async () => {
    const m = await manager();
    const c = await createClient(m, input({ dateStart: "2025-01-01" }));
    // created today (2 Nov 2026); move Consultant to someone else effective 2 Nov, add an AS from 2 Nov
    await updateClient(m, c.id, { ...upd(c.clientCode, { dateStart: "2025-01-01", team: { primary: org.ids.peer, secondary: null, additional: [], adsStrategists: [org.ids.junior] } }), teamEffectiveDate: "2026-11-02" });
    await expectError(updateClient(m, c.id, { ...upd(c.clientCode, { dateStart: "2025-01-01" }), teamEffectiveDate: "2026-12-01" }), "VALIDATION", /future/);
    const hist = (await getClient(m, c.id)).assignmentHistory;
    expect(hist.filter((a) => !a.to).map((a) => [a.employee.id, a.role, a.from]).sort()).toEqual(
      [[org.ids.peer, "CONSULTANT_PRIMARY", "2026-11-02"], [org.ids.junior, "ADS_STRATEGIST", "2026-11-02"]].sort(),
    );
    expect(hist.find((a) => a.employee.id === org.ids.principal)?.to).toBe("2026-11-02"); // started the same day → closed that day
  });
});

describe("Preparation status", () => {
  it("clients with a future Date START are in preparation and become active on that day", async () => {
    const m = await manager();
    const c = await createClient(m, input({ name: "Soon Brand", dateStart: "2026-11-20" }));
    await createClient(m, input({ name: "Live Brand", dateStart: "2026-01-01" }));
    let rows = (await listClients(m, { sort: "name" })).rows;
    expect(rows.map((r) => [r.name, r.displayStatus, r.period.label])).toEqual([["Live Brand", "ACTIVE", "10 mo"], ["Soon Brand", "PREPARATION", "Starts soon"]]);
    expect((await listClients(m, { status: "PREPARATION" })).rows.map((r) => r.name)).toEqual(["Soon Brand"]);
    expect((await listClients(m, { status: "ACTIVE" })).rows.map((r) => r.name)).toEqual(["Live Brand"]);
    const nov = await portfolioSummary(2026, 11);
    expect([nov.active, nov.preparation, nov.total]).toEqual([1, 1, 1]);
    // team edits on a client in preparation start with the collaboration
    await updateClient(m, c.id, upd(c.clientCode, { name: "Soon Brand", dateStart: "2026-11-20", team: { primary: org.ids.peer, secondary: null, additional: [], adsStrategists: [] } }));

    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    rows = (await listClients(m, { sort: "name" })).rows;
    expect(rows.find((r) => r.name === "Soon Brand")?.displayStatus).toBe("ACTIVE");
    const after = await portfolioSummary(2026, 11);
    expect([after.active, after.preparation]).toEqual([2, 0]);
    vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
  });
});

describe("Ads Strategist ad accounts", () => {
  it("each Ads Strategist handles some of the client's ad accounts; changes are dated", async () => {
    const m = await manager();
    const ads = ["Meta Regular", "Meta CPAS Shopee", "GMV Max TikTok"];
    const team = (asAdAccounts: Record<string, string[]>) => ({ primary: org.ids.principal, secondary: null, additional: [], adsStrategists: [org.ids.junior, org.ids.peer], asAdAccounts });
    await expectError(createClient(m, input({ adAccounts: ads, team: team({ [org.ids.junior]: ["TTAM"] }) })), "VALIDATION", /TTAM/);
    const c = await createClient(m, input({ dateStart: "2025-01-01", adAccounts: ads, team: team({ [org.ids.junior]: ["Meta Regular", "Meta CPAS Shopee"], [org.ids.peer]: ["GMV Max TikTok"] }) }));
    let got = await getClient(m, c.id);
    // (no sort order set in the test data → alphabetical)
    expect(got.adsStrategists.map((p) => [p.id, p.adAccounts])).toEqual([[org.ids.junior, ["Meta CPAS Shopee", "Meta Regular"]], [org.ids.peer, ["GMV Max TikTok"]]]);

    // On 20 Nov, move Meta CPAS Shopee to the second AS from 15 Nov: the old period closes, a new one starts.
    vi.setSystemTime(new Date("2026-11-20T03:00:00Z"));
    await updateClient(m, c.id, { ...upd(c.clientCode, { dateStart: "2025-01-01", adAccounts: ads, team: team({ [org.ids.junior]: ["Meta Regular"], [org.ids.peer]: ["GMV Max TikTok", "Meta CPAS Shopee"] }) }), teamEffectiveDate: "2026-11-15" });
    vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
    got = await getClient(m, c.id);
    expect(got.adsStrategists.find((p) => p.id === org.ids.peer)?.adAccounts).toEqual(["GMV Max TikTok", "Meta CPAS Shopee"]);
    const junior = got.assignmentHistory.filter((a) => a.employee.id === org.ids.junior);
    expect(junior.map((a) => [a.from, a.to, a.adAccounts])).toEqual([["2026-11-15", null, ["Meta Regular"]], ["2026-11-02", "2026-11-14", ["Meta CPAS Shopee", "Meta Regular"]]]);

    // Updates that don't send ad accounts (e.g. older callers) keep them.
    await updateClient(m, c.id, upd(c.clientCode, { dateStart: "2025-01-01", adAccounts: ads, team: { primary: org.ids.principal, secondary: null, additional: [], adsStrategists: [org.ids.junior, org.ids.peer] } }));
    expect((await getClient(m, c.id)).adsStrategists.find((p) => p.id === org.ids.junior)?.adAccounts).toEqual(["Meta Regular"]);

    // CSV: export writes "email (Ad | Ad)"; importing it back changes nothing.
    const csv = await clientsExportCsv(m, (await listClients(m, {})).rows);
    expect(csv).toMatch(/\(GMV Max TikTok \| Meta CPAS Shopee\)/);
    const res = await importClientsCsv(m, csv, false);
    expect([res.updated, res.failed]).toEqual([1, 0]);
    expect((await getClient(m, c.id)).adsStrategists.map((p) => p.adAccounts)).toEqual([["Meta Regular"], ["GMV Max TikTok", "Meta CPAS Shopee"]]);
    const bad = await importClientsCsv(m, csv.replace("(Meta Regular)", "(TTAM)"), true);
    expect(bad.rows[0].errors.join(" ")).toMatch(/TTAM/);
  });
});

describe("Client bulk edit", () => {
  it("saves each client's own values; team and status changes are dated; failures are per client", async () => {
    const { bulkEditClients, clientsForBulk } = await import("@/server/services/bulk");
    const m = await manager();
    const a = await createClient(m, input({ name: "Alpha Brand", dateStart: "2025-01-01", adAccounts: ["Meta Regular"] }));
    const b = await createClient(m, input({ name: "Beta Brand", dateStart: "2025-01-01" }));
    const opts = { effectiveFrom: "2026-11-02" };
    const r = await bulkEditClients(
      m,
      [
        { id: a.id, patch: { packageId: pkg.basic, adAccounts: ["Meta Regular", "TTAM"], adsStrategists: [org.ids.junior] } },
        { id: b.id, patch: { consultant1: org.ids.peer, adsStrategists: [org.ids.junior, org.ids.peer] } }, // peer can't hold two roles
      ],
      opts,
    );
    expect(r.updated).toBe(1);
    expect(r.failed.map((f) => [f.name, /one role/.test(f.error)])).toEqual([["Beta Brand", true]]);
    const got = await getClient(m, a.id);
    expect([got.package?.id, got.adAccounts, got.adsStrategists.map((p) => p.id), got.name]).toEqual([pkg.basic, ["Meta Regular", "TTAM"], [org.ids.junior], "Alpha Brand"]);
    expect((await getClient(m, b.id)).consultant1?.id).toBe(org.ids.principal); // failed rows are left untouched

    const s = await bulkEditClients(m, [{ id: a.id, patch: { status: "FREEZE" } }, { id: b.id, patch: { name: "Beta Renamed", status: "FREEZE" } }], opts);
    expect(s).toEqual({ updated: 2, failed: [] });
    expect((await listClients(m, { status: "FREEZE" })).rows.map((x) => x.name).sort()).toEqual(["Alpha Brand", "Beta Renamed"]);
    expect((await clientsForBulk(m, [a.id, b.id])).map((x) => [x.name, x.status])).toEqual([["Alpha Brand", "FREEZE"], ["Beta Renamed", "FREEZE"]]);
    await expectError(bulkEditClients(m, [{ id: a.id, patch: { packageId: pkg.advance } }], { effectiveFrom: "2026-12-01" }), "VALIDATION");
    await expectError(bulkEditClients(await org.actor("junior"), [{ id: a.id, patch: { packageId: pkg.basic } }], opts), "FORBIDDEN");
  });
});

describe("Company Hub categories", () => {
  it("adds, renames and deletes a category with its sections", async () => {
    const admin = await org.actor("admin");
    const about = await saveSection(admin, { title: "Vision", body: "", isPublished: true, sortOrder: 1 });
    const cat = await saveHubCategory(admin, { title: "Benefits & Perks", isPublished: true, sortOrder: 1 });
    expect(cat.slug).toBe("benefits-and-perks");
    await saveSection(admin, { categoryId: cat.id, title: "Health insurance", body: "", isPublished: true, sortOrder: 1 });
    expect((await listSections({ categoryId: cat.id })).map((s) => s.title)).toEqual(["Health insurance"]);
    expect((await listSections()).map((s) => s.title)).toEqual(["Vision"]); // About MIL keeps its own sections

    const renamed = await saveHubCategory(admin, { id: cat.id, title: "Perks", isPublished: true, sortOrder: 1 });
    expect(renamed.slug).toBe("benefits-and-perks"); // links keep working
    expect((await saveHubCategory(admin, { title: "Recognition page", isPublished: true, sortOrder: 2 })).slug).toBe("recognition-page");
    await expectError(saveHubCategory(admin, { title: "perks", isPublished: true, sortOrder: 3 }), "VALIDATION");
    await expectError(saveHubCategory(admin, { title: "Regulations", isPublished: true, sortOrder: 3 }), "VALIDATION");
    await expectError(saveHubCategory(await org.actor("junior"), { title: "Mine", isPublished: true, sortOrder: 3 }), "FORBIDDEN");

    await saveHubCategory(admin, { id: cat.id, title: "Perks", isPublished: false, sortOrder: 1 });
    expect(await hubCategoryBySlug("benefits-and-perks")).toBeNull();
    expect((await listHubCategories()).map((c) => c.title)).toEqual(["Recognition page"]);

    await deleteHubCategory(admin, cat.id);
    expect(await db.companyContentSection.count({ where: { categoryId: cat.id } })).toBe(0);
    await deleteSection(admin, about.id);
    expect(await listSections({ includeHidden: true })).toEqual([]);
    await expectError(deleteSection(admin, about.id), "NOT_FOUND");
  });
});

describe("Portfolio visibility per role", () => {
  it("shows employees nothing by default, leaders/HR everything, managers always all", async () => {
    const s = await getSettings();
    expect(portfolioVisibleFor(await org.actor("junior"), s)!.size).toBe(0);
    expect(portfolioVisibleFor(await org.actor("leader"), s)!.has("consultant")).toBe(true);
    expect(portfolioVisibleFor(await org.actor("hr"), s)!.has("active")).toBe(true);
    expect(portfolioVisibleFor(await org.actor("admin"), s)).toBeNull();

    const admin = await org.actor("admin");
    await updateSettings(admin, { clientPortfolioVisibility: { ...DEFAULT_SETTINGS.clientPortfolioVisibility, EMPLOYEE: ["active", "package"], HR: ["total"] } });
    const after = await getSettings();
    expect([...portfolioVisibleFor(await org.actor("junior"), after)!]).toEqual(["active", "package"]);
    expect(portfolioVisibleFor(await org.actor("hr"), after)!.has("active")).toBe(false);

    const hr = await org.actor("hr");
    await setGrants(admin, hr.userId, ["clientPackage.manage"]);
    expect(portfolioVisibleFor(await org.actor("hr"), after)).toBeNull();
  });
});
