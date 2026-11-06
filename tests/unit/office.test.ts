import { describe, expect, it } from "vitest";
import { officeResolver } from "@/lib/engine/office";

// 2026-11-02 is a Monday.
const cfg = {
  companyWeekdays: [2, 4],
  teamWeekdays: { creative: [1] },
  overrides: [
    { teamId: null, date: "2026-11-03", mode: "WFH" as const, note: "Office closed" },
    { teamId: "creative", date: "2026-11-04", mode: "WFO" as const, note: "Team offsite prep" },
    { teamId: null, date: "2026-11-09", mode: "WFH" as const, note: null },
    { teamId: "creative", date: "2026-11-09", mode: "WFO" as const, note: null },
  ],
};
const resolve = officeResolver(cfg);

describe("office schedule resolution", () => {
  it("uses the company's weekly days for teams without their own", () => {
    expect(resolve(null, "2026-11-05")).toEqual({ mode: "WFO", note: null, source: "PATTERN", scope: "COMPANY" });
    expect(resolve("perf", "2026-11-02").mode).toBe("WFH");
  });
  it("uses a team's own weekly days", () => {
    expect(resolve("creative", "2026-11-02")).toEqual({ mode: "WFO", note: null, source: "PATTERN", scope: "TEAM" });
    expect(resolve("creative", "2026-11-05").mode).toBe("WFH");
  });
  it("lets a company date override beat any weekly days, with its note", () => {
    expect(resolve("perf", "2026-11-03")).toEqual({ mode: "WFH", note: "Office closed", source: "OVERRIDE", scope: "COMPANY" });
    // creative's weekly day is Monday, but the company closure on Tuesday still applies to them
    expect(resolve("creative", "2026-11-03").mode).toBe("WFH");
  });
  it("lets a team date override beat the company override", () => {
    expect(resolve("creative", "2026-11-09")).toEqual({ mode: "WFO", note: null, source: "OVERRIDE", scope: "TEAM" });
    expect(resolve("perf", "2026-11-09").mode).toBe("WFH");
    expect(resolve("creative", "2026-11-04").note).toBe("Team offsite prep");
  });
});
