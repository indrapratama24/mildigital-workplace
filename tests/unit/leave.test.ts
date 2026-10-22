import { describe, expect, it } from "vitest";
import { accruedEntitlement, unpaidDays } from "@/lib/engine/leave";

describe("monthly leave accrual", () => {
  const base = { yearly: 12, year: 2026 };
  it("full-time from October: 1 in October, 3 by December", () => {
    expect(accruedEntitlement({ ...base, eligibleSince: "2026-10-15", asOf: "2026-10-20" })).toBe(1);
    expect(accruedEntitlement({ ...base, eligibleSince: "2026-10-15", asOf: "2026-12-08" })).toBe(3);
    expect(accruedEntitlement({ ...base, eligibleSince: "2026-10-15", asOf: "2026-09-30" })).toBe(0);
  });
  it("employees eligible before the year earn from January, capped at the yearly entitlement", () => {
    expect(accruedEntitlement({ ...base, eligibleSince: "2023-05-01", asOf: "2026-03-10" })).toBe(3);
    expect(accruedEntitlement({ ...base, eligibleSince: "2023-05-01", asOf: "2027-02-01" })).toBe(12);
    expect(accruedEntitlement({ ...base, eligibleSince: "2027-01-01", asOf: "2026-12-31" })).toBe(0);
    expect(accruedEntitlement({ ...base, eligibleSince: null, asOf: "2026-12-31" })).toBe(0);
    expect(accruedEntitlement({ yearly: 14, year: 2026, eligibleSince: "2026-01-01", asOf: "2026-06-01" })).toBe(7);
  });
  it("days beyond the remaining balance are unpaid", () => {
    expect(unpaidDays(10, 3)).toBe(0);
    expect(unpaidDays(1, 3)).toBe(2);
    expect(unpaidDays(-2, 3)).toBe(3);
  });
});

import { checkTiers, concurrencyCap, DEFAULT_ANNUAL_RULES as R, offStretch } from "@/lib/engine/leave";
import { addDays, isoWeekday } from "@/lib/dates";

describe("annual leave tiers", () => {
  const span = (start: string, end: string, days: number) => ({ start, end, days });
  it("one leave up to 10 days, then one up to 5 with a month's gap, then 1 day at a time", () => {
    expect(checkTiers(span("2026-03-02", "2026-03-13", 11), [], R)).toMatch(/at most 10/);
    expect(checkTiers(span("2026-03-02", "2026-03-13", 10), [], R)).toBeNull();
    const first = span("2026-03-02", "2026-03-13", 10);
    expect(checkTiers(span("2026-05-04", "2026-05-11", 6), [first], R)).toMatch(/at most 5/);
    expect(checkTiers(span("2026-03-30", "2026-04-01", 3), [first], R)).toMatch(/at least 30 days/);
    expect(checkTiers(span("2026-05-04", "2026-05-08", 5), [first], R)).toBeNull();
    const second = span("2026-05-04", "2026-05-08", 5);
    expect(checkTiers(span("2026-08-03", "2026-08-04", 2), [first, second], R)).toMatch(/1 day at a time/);
    expect(checkTiers(span("2026-08-03", "2026-08-03", 1), [first, second], R)).toBeNull();
    // order doesn't matter: a 4-day leave first still allows a 10-day one later
    expect(checkTiers(span("2026-09-07", "2026-09-18", 10), [span("2026-03-02", "2026-03-05", 4)], R)).toBeNull();
  });

  it("counts adjoining holidays (not plain weekends) in the days off in a row", () => {
    const holidays = new Set(["2026-03-20", "2026-03-23"]); // Fri + Mon holidays around a weekend
    const isOff = (d: string) => isoWeekday(d) >= 6 || holidays.has(d);
    // Mon 9 – Thu 19 Mar: then Fri holiday + weekend + Mon holiday → 15 days
    expect(offStretch("2026-03-09", "2026-03-19", isOff, (d) => holidays.has(d), addDays).days).toBe(15);
    // A plain two-week leave Mon–Fri isn't extended by ordinary weekends
    expect(offStretch("2026-04-06", "2026-04-17", isOff, (d) => holidays.has(d), addDays).days).toBe(12);
  });

  it("caps people on leave at the same time at 20% of the company (at least 1)", () => {
    expect(concurrencyCap(16, 20)).toBe(3);
    expect(concurrencyCap(4, 20)).toBe(1);
    expect(concurrencyCap(50, 20)).toBe(10);
  });
});
