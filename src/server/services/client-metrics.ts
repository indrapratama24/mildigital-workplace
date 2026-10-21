// Portfolio metrics read from effective-dated status history, so a status change today never
// rewrites past counts. This is the service layer the future Performance & Growth module consumes
// (also exposed read-only at /api/clients/metrics).
import { db } from "../db";
import { addMonths, fromISO, monthEnd, monthStart, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import { isNewIn, type ClientStatusT } from "@/lib/engine/clients";
import { getSettings } from "./settings";

async function brandsWithHistory() {
  return db.clientBrand.findMany({
    where: { archivedAt: null },
    select: {
      id: true,
      name: true,
      industry: true,
      dateStart: true,
      statusHistory: { select: { status: true, effectiveFrom: true, effectiveTo: true } },
      engagements: { select: { packages: { select: { effectiveFrom: true, effectiveTo: true, package: { select: { id: true, name: true } } } } } },
      assignments: { select: { role: true, effectiveFrom: true, effectiveTo: true, employee: { select: { id: true, fullName: true } } } },
    },
  });
}
type Brand = Awaited<ReturnType<typeof brandsWithHistory>>[number];

const covers = (r: { effectiveFrom: Date; effectiveTo: Date | null }, d: ISODate) => toISO(r.effectiveFrom) <= d && (!r.effectiveTo || toISO(r.effectiveTo) >= d);
const statusOnDate = (b: Brand, d: ISODate) => (b.statusHistory.find((h) => covers(h, d))?.status ?? null) as ClientStatusT | null;

function countOn(brands: Brand[], date: ISODate, freezeCountsAsActive: boolean) {
  const c = { active: 0, inactive: 0, freeze: 0, total: 0 };
  for (const b of brands) {
    const s = statusOnDate(b, date);
    if (!s) continue; // not a client yet on that date
    c.total++;
    if (s === "ACTIVE") c.active++;
    else if (s === "INACTIVE") c.inactive++;
    else c.freeze++;
  }
  if (freezeCountsAsActive) c.active += c.freeze;
  return c;
}

/** Portfolio summary as of the end of a month (or today for the current month). */
export async function portfolioSummary(year: number, month: number) {
  const today = todayJakarta();
  const start = monthStart(year, month);
  const end = monthEnd(year, month);
  const asOf = end > today ? today : end;
  const [brands, settings] = await Promise.all([brandsWithHistory(), getSettings()]);
  const counts = countOn(brands, asOf, settings.clientFreezeCountsAsActive);
  const newClients = brands.filter((b) => isNewIn(toISO(b.dateStart), start, asOf));
  const activeNow = brands.filter((b) => {
    const s = statusOnDate(b, asOf);
    return s === "ACTIVE" || (settings.clientFreezeCountsAsActive && s === "FREEZE");
  });
  const tally = (keyOf: (b: Brand) => { key: string; label: string }[]) => {
    const m = new Map<string, { label: string; count: number }>();
    for (const b of activeNow) for (const k of keyOf(b)) m.set(k.key, { label: k.label, count: (m.get(k.key)?.count ?? 0) + 1 });
    return [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  };
  return {
    asOf,
    freezeCountsAsActive: settings.clientFreezeCountsAsActive,
    ...counts,
    newThisPeriod: newClients.length,
    newClients: newClients.map((b) => ({ id: b.id, name: b.name, dateStart: toISO(b.dateStart) })),
    byPackage: tally((b) => {
      const p = b.engagements.flatMap((e) => e.packages).find((x) => covers(x, asOf));
      return p ? [{ key: p.package.id, label: p.package.name }] : [{ key: "none", label: "No package" }];
    }),
    byIndustry: tally((b) => [{ key: b.industry ?? "none", label: b.industry ?? "Not set" }]),
    byConsultant: tally((b) =>
      b.assignments.filter((a) => a.role === "CONSULTANT_PRIMARY" && covers(a, asOf)).map((a) => ({ key: a.employee.id, label: a.employee.fullName })),
    ),
  };
}

/** Month-end counts for the last `months` months (oldest first). */
export async function portfolioTrend(months = 12) {
  const today = todayJakarta();
  const [brands, settings] = await Promise.all([brandsWithHistory(), getSettings()]);
  const cur = { year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) };
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = addMonths(cur.year, cur.month, -i);
    const end = monthEnd(m.year, m.month);
    const asOf = end > today ? today : end;
    const c = countOn(brands, asOf, settings.clientFreezeCountsAsActive);
    const newCount = brands.filter((b) => isNewIn(toISO(b.dateStart), monthStart(m.year, m.month), asOf)).length;
    out.push({ month: `${m.year}-${String(m.month).padStart(2, "0")}`, ...c, new: newCount });
  }
  return out;
}

export async function activeClientCount(date: ISODate = todayJakarta()) {
  const [brands, settings] = await Promise.all([brandsWithHistory(), getSettings()]);
  return countOn(brands, date, settings.clientFreezeCountsAsActive).active;
}

export async function newClientsBetween(from: ISODate, to: ISODate) {
  return db.clientBrand.count({ where: { archivedAt: null, dateStart: { gte: fromISO(from), lte: fromISO(to) } } });
}

export async function clientStatusHistory(brandId: string) {
  const rows = await db.clientStatusHistory.findMany({ where: { brandId }, orderBy: { effectiveFrom: "asc" } });
  return rows.map((r) => ({ status: r.status, fromStatus: r.fromStatus, from: toISO(r.effectiveFrom), to: r.effectiveTo ? toISO(r.effectiveTo) : null, reason: r.reason }));
}
