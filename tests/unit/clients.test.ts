import { describe, expect, it } from "vitest";
import { clientCode, collaborationPeriod, daysInStatus, durationParts, formatDuration, isNewIn, statusOn, validateTeam } from "@/lib/engine/clients";

describe("client period & status rules", () => {
  it("formats Client IDs", () => {
    expect(clientCode(1)).toBe("MIL-CL-0001");
    expect(clientCode(12345)).toBe("MIL-CL-12345");
  });

  it("calculates calendar durations", () => {
    expect(durationParts("2024-01-15", "2026-03-20")).toEqual({ years: 2, months: 2, days: 5 });
    expect(durationParts("2026-01-31", "2026-03-01")).toEqual({ years: 0, months: 1, days: 1 });
    expect(formatDuration({ years: 0, months: 0, days: 12 })).toBe("12 days");
    expect(formatDuration({ years: 1, months: 3, days: 4 })).toBe("1 yr 3 mo");
  });

  it("active: Date START → today; inactive: Date START → Date OFF", () => {
    const active = collaborationPeriod({ status: "ACTIVE", dateStart: "2025-01-01", dateOff: null, history: [{ status: "ACTIVE", from: "2025-01-01", to: null }] }, "2026-04-01");
    expect(active.label).toBe("1 yr 3 mo");
    const inactive = collaborationPeriod(
      { status: "INACTIVE", dateStart: "2025-01-01", dateOff: "2025-06-30", history: [{ status: "ACTIVE", from: "2025-01-01", to: "2025-06-30" }, { status: "INACTIVE", from: "2025-07-01", to: null }] },
      "2026-04-01",
    );
    expect(inactive.end).toBe("2025-06-30");
    expect(inactive.label).toBe("5 mo");
    expect(inactive.activeDays).toBe(181);
  });

  it("freeze shows elapsed time and the suspension separately; reactivation is detected", () => {
    const h = [
      { status: "ACTIVE" as const, from: "2025-01-01", to: "2025-12-31" },
      { status: "INACTIVE" as const, from: "2026-01-01", to: "2026-02-28" },
      { status: "ACTIVE" as const, from: "2026-03-01", to: "2026-03-31" },
      { status: "FREEZE" as const, from: "2026-04-01", to: null },
    ];
    const p = collaborationPeriod({ status: "FREEZE", dateStart: "2025-01-01", dateOff: null, history: h }, "2026-04-30");
    expect(p.freezeSince).toBe("2026-04-01");
    expect(p.frozenDays).toBe(30);
    expect(p.inactiveDays).toBe(59);
    expect(p.reactivated).toBe(true);
    expect(statusOn(h, "2026-01-15")).toBe("INACTIVE");
    expect(statusOn(h, "2024-12-31")).toBeNull();
    expect(daysInStatus(h, "ACTIVE", "2025-12-01", "2026-03-31")).toBe(31 + 31);
  });

  it("new clients are counted by first Date START only", () => {
    expect(isNewIn("2026-10-05", "2026-10-01", "2026-10-31")).toBe(true);
    expect(isNewIn("2022-03-01", "2026-10-01", "2026-10-31")).toBe(false);
  });

  it("validates team assignments", () => {
    const base = { primary: "a", secondary: null, additional: [], adsStrategists: [] };
    expect(validateTeam(base, { status: "ACTIVE", requirePrimary: true, waived: false })).toEqual([]);
    expect(validateTeam({ ...base, primary: null }, { status: "ACTIVE", requirePrimary: true, waived: false })[0]).toMatch(/Consultant/);
    expect(validateTeam({ ...base, primary: null }, { status: "ACTIVE", requirePrimary: true, waived: true })).toEqual([]);
    expect(validateTeam({ ...base, primary: null }, { status: "INACTIVE", requirePrimary: true, waived: false })).toEqual([]);
    expect(validateTeam({ ...base, adsStrategists: ["b", "c", "d", "e"] }, { status: "ACTIVE", requirePrimary: true, waived: false })[0]).toMatch(/at most 3/);
    expect(validateTeam({ ...base, secondary: "a" }, { status: "ACTIVE", requirePrimary: true, waived: false })[0]).toMatch(/one role/);
  });
});
