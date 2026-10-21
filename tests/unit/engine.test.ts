import { describe, expect, it } from "vitest";
import {
  aggregatePeriod,
  applyRounding,
  computeRequirement,
  computeRevisionImpact,
  evaluateAttendance,
  evaluatePlan,
  generatePlan,
  validatePolicyRules,
  type HolidayInput,
  type MonthInput,
  type PolicyRules,
} from "@/lib/engine/working-days";
import { daysInMonth, isLeapYear, isoWeekday, monthDates, weekKey } from "@/lib/dates";

const JUNIOR: PolicyRules = { wfoPercent: 75, mandatoryWeekdays: [1, 3, 4], roundingMode: "CEIL", excludeLeaveFromDenominator: true, offsiteCountsAsWfo: true };
const PRINCIPAL: PolicyRules = { wfoPercent: 50, mandatoryWeekdays: [], roundingMode: "CEIL", excludeLeaveFromDenominator: true, offsiteCountsAsWfo: true };
const base = (overrides: Partial<MonthInput> = {}): MonthInput => ({ year: 2026, month: 11, holidays: [], policy: JUNIOR, ...overrides });

const DEC_HOLIDAYS: HolidayInput[] = [
  { date: "2026-12-24", name: "Cuti Bersama Natal", type: "CUTI_BERSAMA", isObserved: true },
  { date: "2026-12-25", name: "Hari Raya Natal", type: "NATIONAL", isObserved: true },
];

describe("rounding", () => {
  it("uses integer arithmetic for each mode", () => {
    expect(applyRounding(21, 75, "CEIL")).toBe(16);
    expect(applyRounding(21, 75, "ROUND")).toBe(16);
    expect(applyRounding(21, 75, "FLOOR")).toBe(15);
    expect(applyRounding(20, 75, "CEIL")).toBe(15); // exact — no float drift
    expect(applyRounding(22, 50, "CEIL")).toBe(11);
    expect(applyRounding(21, 50, "ROUND")).toBe(11); // 10.5 rounds half-up
    expect(applyRounding(0, 75, "CEIL")).toBe(0);
  });
});

describe("dates", () => {
  it("handles month lengths and leap years", () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(isLeapYear(2000)).toBe(true);
    expect(monthDates(2026, 4)).toHaveLength(30);
    expect(monthDates(2026, 12).at(-1)).toBe("2026-12-31");
  });
  it("computes ISO weekdays and week keys", () => {
    expect(isoWeekday("2026-10-20")).toBe(2); // Tuesday
    expect(isoWeekday("2026-11-01")).toBe(7); // Sunday
    expect(weekKey("2026-11-01")).toBe("2026-10-26");
  });
});

describe("monthly requirement — WFO percentages", () => {
  it("75% policy, November 2026 (21 working days)", () => {
    const r = computeRequirement(base());
    expect(r.baseScheduledDays).toBe(21);
    expect(r.eligibleWorkingDays).toBe(21);
    expect(r.percentMinimum).toBe(16); // ceil(15.75)
    expect(r.mandatoryCount).toBe(13); // Mon/Wed/Thu
    expect(r.effectiveMinimumWfo).toBe(16);
    expect(r.maxWfhDays).toBe(5);
    expect(r.warnings.map((w) => w.code)).not.toContain("MANDATORY_EXCEEDS_RATIO");
  });

  it("50% policy without mandatory days is flexible", () => {
    const r = computeRequirement(base({ policy: PRINCIPAL }));
    expect(r.effectiveMinimumWfo).toBe(11); // ceil(10.5)
    expect(r.mandatoryCount).toBe(0);
    expect(r.maxWfhDays).toBe(10);
    expect(r.warnings).toHaveLength(0);
  });

  it("80% policy", () => {
    const r = computeRequirement(base({ policy: { ...JUNIOR, wfoPercent: 80 } }));
    expect(r.effectiveMinimumWfo).toBe(17); // ceil(16.8)
    expect(r.maxWfhDays).toBe(4);
  });

  it("flags mandatory weekday conflicts instead of assuming the ratio", () => {
    const r = computeRequirement(base({ policy: { ...PRINCIPAL, mandatoryWeekdays: [1, 3, 4] } }));
    expect(r.percentMinimum).toBe(11);
    expect(r.mandatoryCount).toBe(13);
    expect(r.effectiveMinimumWfo).toBe(13); // MAX(percentage, mandatory)
    expect(r.effectiveWfoPercent).toBeCloseTo(61.9, 1);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toContain("MANDATORY_EXCEEDS_RATIO");
    expect(codes).toContain("POLICY_NO_FLEXIBILITY");
  });
});

describe("month boundaries, leap years and holidays", () => {
  it("February 2026 (non-leap, 20 weekdays) gives an exact 75%", () => {
    const r = computeRequirement(base({ year: 2026, month: 2 }));
    expect(r.days).toHaveLength(28);
    expect(r.eligibleWorkingDays).toBe(20);
    expect(r.effectiveMinimumWfo).toBe(15);
  });

  it("February 2028 (leap year) includes the 29th", () => {
    const r = computeRequirement(base({ year: 2028, month: 2 }));
    expect(r.days).toHaveLength(29);
    expect(r.days.at(-1)?.date).toBe("2028-02-29");
    expect(r.eligibleWorkingDays).toBe(21);
  });

  it("subtracts public holidays and cuti bersama", () => {
    const r = computeRequirement(base({ month: 12, holidays: DEC_HOLIDAYS }));
    expect(r.baseScheduledDays).toBe(23);
    expect(r.holidayDays).toBe(2);
    expect(r.eligibleWorkingDays).toBe(21);
    expect(r.effectiveMinimumWfo).toBe(16);
    expect(r.mandatoryCount).toBe(13); // Thu 24 Dec removed from mandatory set
    expect(r.days.find((d) => d.date === "2026-12-25")?.kind).toBe("HOLIDAY");
  });

  it("treats cuti bersama independently when configured as a working day", () => {
    const r = computeRequirement(base({ month: 12, holidays: DEC_HOLIDAYS, cutiBersamaIsHoliday: false }));
    expect(r.eligibleWorkingDays).toBe(22);
    expect(r.effectiveMinimumWfo).toBe(17); // ceil(16.5)
  });

  it("ignores holidays that are manually overridden (not observed) and weekend holidays", () => {
    const r = computeRequirement(
      base({
        month: 12,
        holidays: [
          { ...DEC_HOLIDAYS[1], isObserved: false },
          { date: "2026-12-27", name: "Sunday holiday", type: "COMPANY", isObserved: true },
        ],
      }),
    );
    expect(r.eligibleWorkingDays).toBe(23);
  });
});

describe("approved leave and the denominator", () => {
  const leaves = [
    { date: "2026-11-02", portion: 1, category: "LEAVE" as const, label: "Annual", typeCode: "ANNUAL" },
    { date: "2026-11-03", portion: 1, category: "LEAVE" as const, label: "Annual", typeCode: "ANNUAL" },
  ];

  it("excludes full-day leave by default and recalculates the minimum", () => {
    const r = computeRequirement(base({ leaves }));
    expect(r.fullLeaveDays).toBe(2);
    expect(r.attendanceEligibleDays).toBe(19);
    expect(r.baselinePercentMinimum).toBe(16);
    expect(r.percentMinimum).toBe(15); // ceil(14.25)
    expect(r.mandatoryCount).toBe(12); // Monday 2 Nov is on leave
    expect(r.effectiveMinimumWfo).toBe(15);
    expect(r.warnings.map((w) => w.code)).toContain("LEAVE_EXCLUDED");
    // leave is not WFH and not a violation
    expect(r.days.find((d) => d.date === "2026-11-02")?.plannable).toBe(false);
  });

  it("keeps leave in the denominator when configured", () => {
    const r = computeRequirement(base({ leaves, policy: { ...JUNIOR, excludeLeaveFromDenominator: false } }));
    expect(r.attendanceEligibleDays).toBe(21);
    expect(r.effectiveMinimumWfo).toBe(16);
    expect(r.plannableDays).toBe(19);
    expect(r.maxWfhDays).toBe(3);
  });

  it("merges overlapping half-day entries into a full day", () => {
    const r = computeRequirement(
      base({
        leaves: [
          { date: "2026-11-10", portion: 0.5, category: "PERMISSION", label: "AM", typeCode: "PERSONAL" },
          { date: "2026-11-10", portion: 0.5, category: "LEAVE", label: "PM", typeCode: "ANNUAL" },
        ],
      }),
    );
    expect(r.fullLeaveDays).toBe(1);
    expect(r.halfLeaveDays).toBe(0);
  });

  it("half-day leave keeps the day plannable", () => {
    const r = computeRequirement(base({ leaves: [{ date: "2026-11-10", portion: 0.5, category: "LEAVE", label: "AM", typeCode: "ANNUAL" }] }));
    expect(r.halfLeaveDays).toBe(1);
    expect(r.attendanceEligibleDays).toBe(21);
    expect(r.days.find((d) => d.date === "2026-11-10")?.plannable).toBe(true);
  });

  it("flags requirements that become unachievable", () => {
    const many = ["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"].map((date) => ({
      date,
      portion: 1,
      category: "LEAVE" as const,
      label: "Sick",
      typeCode: "SICK",
    }));
    const r = computeRequirement(base({ leaves: many, policy: { ...JUNIOR, excludeLeaveFromDenominator: false } }));
    expect(r.warnings.map((w) => w.code)).toContain("UNACHIEVABLE");
  });
});

describe("offsite duty", () => {
  it("counts towards WFO when configured", () => {
    const r = computeRequirement(base({ offsiteDates: ["2026-11-04"] }));
    expect(r.offsiteCredit).toBe(1);
    expect(r.attendanceEligibleDays).toBe(21);
    expect(r.plannableDays).toBe(20);
    const plan = generatePlan(r);
    expect(evaluatePlan(r, plan).plannedWfo).toBe(16);
  });

  it("is neutral (excluded from the denominator) when it does not count", () => {
    const r = computeRequirement(base({ offsiteDates: ["2026-11-04"], policy: { ...JUNIOR, offsiteCountsAsWfo: false } }));
    expect(r.offsiteCredit).toBe(0);
    expect(r.attendanceEligibleDays).toBe(20);
    expect(r.effectiveMinimumWfo).toBe(15);
    expect(r.mandatoryCount).toBe(12);
  });
});

describe("exceptions", () => {
  it("applies mandatory-day waivers and WFO reductions but never below mandatory days", () => {
    const r = computeRequirement(base({ mandatoryWaiverDates: ["2026-11-02"], wfoReductionDays: 5 }));
    expect(r.mandatoryCount).toBe(12);
    expect(r.percentMinimum).toBe(16);
    expect(r.effectiveMinimumWfo).toBe(12); // max(16-5, 12)
    expect(r.warnings.map((w) => w.code)).toContain("EXCEPTION_APPLIED");
  });
});

describe("plan generation and evaluation", () => {
  it("generates a compliant, balanced plan that locks mandatory days", () => {
    const r = computeRequirement(base({ month: 12, holidays: DEC_HOLIDAYS }));
    const plan = generatePlan(r);
    const ev = evaluatePlan(r, plan);
    expect(ev.compliant).toBe(true);
    expect(ev.plannedWfo).toBe(r.effectiveMinimumWfo);
    for (const d of r.mandatoryDates) expect(plan[d]).toBe("WFO");
    expect(plan["2026-12-25"]).toBeUndefined();
  });

  it("spreads flexible WFO days across weeks (Principal 50%)", () => {
    const r = computeRequirement(base({ policy: PRINCIPAL }));
    const plan = generatePlan(r);
    const perWeek = new Map<string, number>();
    for (const [d, m] of Object.entries(plan)) if (m === "WFO") perWeek.set(weekKey(d), (perWeek.get(weekKey(d)) ?? 0) + 1);
    const full = [...perWeek.entries()].filter(([wk]) => wk >= "2026-11-02" && wk <= "2026-11-23").map(([, n]) => n);
    expect(Math.max(...full) - Math.min(...full)).toBeLessThanOrEqual(1);
    expect(evaluatePlan(r, plan).plannedWfo).toBe(11);
  });

  it("auto-balance keeps the employee's existing WFO picks", () => {
    const r = computeRequirement(base({ policy: PRINCIPAL }));
    const plan = generatePlan(r, { seedWfo: ["2026-11-06", "2026-11-13"] });
    expect(plan["2026-11-06"]).toBe("WFO");
    expect(plan["2026-11-13"]).toBe("WFO");
  });

  it("reports violations for incomplete or non-compliant plans", () => {
    const r = computeRequirement(base());
    const allWfh = Object.fromEntries(r.days.filter((d) => d.plannable).map((d) => [d.date, "WFH" as const]));
    const ev = evaluatePlan(r, allWfh);
    expect(ev.compliant).toBe(false);
    expect(ev.shortfall).toBe(16);
    expect(ev.missingMandatoryDates).toHaveLength(13);
    expect(evaluatePlan(r, {}).complete).toBe(false);
  });
});

describe("revision impact (additional WFH requiring replacement)", () => {
  const r = computeRequirement(base());
  const approved = generatePlan(r); // exactly 16 WFO
  const flexWfo = r.days.find((d) => d.plannable && !d.mandatory && approved[d.date] === "WFO" && d.date > "2026-11-10")!.date;

  it("identifies the shortfall and suggests replacement dates", () => {
    const impact = computeRevisionImpact(r, approved, [{ date: flexWfo, toMode: "WFH" }], "2026-11-09");
    expect(impact.plannedWfoBefore).toBe(16);
    expect(impact.plannedWfoAfter).toBe(15);
    expect(impact.minimumRequired).toBe(16);
    expect(impact.shortfall).toBe(1);
    expect(impact.replacementRequired).toBe(1);
    expect(impact.suggestions.length).toBeGreaterThan(0);
    expect(impact.suggestions.every((d) => approved[d] === "WFH" && d > "2026-11-09")).toBe(true);
    expect(impact.requiresException).toBe(false);
  });

  it("clears the shortfall when a replacement date is included", () => {
    const first = computeRevisionImpact(r, approved, [{ date: flexWfo, toMode: "WFH" }], "2026-11-09");
    const impact = computeRevisionImpact(
      r,
      approved,
      [
        { date: flexWfo, toMode: "WFH" },
        { date: first.suggestions[0], toMode: "WFO", isReplacement: true },
      ],
      "2026-11-09",
    );
    expect(impact.shortfall).toBe(0);
    expect(impact.plannedWfoAfter).toBe(16);
    expect(impact.requiresException).toBe(false);
  });

  it("requires an authorised exception for mandatory days or when no replacement exists", () => {
    const mandatory = r.mandatoryDates.find((d) => d > "2026-11-10")!;
    expect(computeRevisionImpact(r, approved, [{ date: mandatory, toMode: "WFH" }], "2026-11-09").requiresException).toBe(true);
    // late in the month: every remaining future day is already WFO, so no replacement exists
    const plannable = r.days.filter((d) => d.plannable).map((d) => d.date);
    const late: Record<string, "WFO" | "WFH"> = {};
    const future = plannable.filter((d) => d >= "2026-11-24");
    const early = plannable.filter((d) => d < "2026-11-24");
    early.forEach((d, i) => (late[d] = i < 16 - future.length ? "WFO" : "WFH"));
    future.forEach((d) => (late[d] = "WFO"));
    const impact = computeRevisionImpact(r, late, [{ date: "2026-11-24", toMode: "WFH" }], "2026-11-23");
    expect(impact.shortfall).toBe(1);
    expect(impact.suggestions).toHaveLength(0);
    expect(impact.requiresException).toBe(true);
  });

  it("rejects past, non-plannable, blocked and duplicate dates", () => {
    const impact = computeRevisionImpact(
      r,
      approved,
      [
        { date: "2026-11-01", toMode: "WFH" },
        { date: "2026-11-05", toMode: "WFH" },
        { date: "2026-11-20", toMode: "WFH" },
        { date: "2026-11-20", toMode: "WFO" },
      ],
      "2026-11-10",
      ["2026-11-20"],
    );
    const reasons = impact.invalid.map((i) => i.reason).join("|");
    expect(reasons).toMatch(/Not a plannable/);
    expect(reasons).toMatch(/Past dates/);
    expect(reasons).toMatch(/pending change/);
    expect(reasons).toMatch(/twice/);
  });
});

describe("attendance compliance", () => {
  const r = computeRequirement(base());
  const approved = generatePlan(r);
  const wfoDates = Object.entries(approved).filter(([, m]) => m === "WFO").map(([d]) => d);

  it("past month: compliant only with verified attendance", () => {
    const recs = wfoDates.map((date) => ({ date, mode: "WFO" as const, verified: true }));
    expect(evaluateAttendance(r, approved, recs, "2026-12-05").status).toBe("COMPLIANT");
    const unverified = wfoDates.map((date) => ({ date, mode: "WFO" as const, verified: false }));
    expect(evaluateAttendance(r, approved, unverified, "2026-12-05").status).toBe("PENDING_VERIFICATION");
    expect(evaluateAttendance(r, approved, [], "2026-12-05").status).toBe("NON_COMPLIANT");
  });

  it("current month: on track / at risk / projected shortfall", () => {
    const today = "2026-11-16";
    const past = wfoDates.filter((d) => d < today);
    const recs = past.map((date) => ({ date, mode: "WFO" as const, verified: true }));
    expect(evaluateAttendance(r, approved, recs, today).status).toBe("ON_TRACK");
    // missed office days but still recoverable
    const missed = recs.slice(2);
    const atRisk = evaluateAttendance(r, approved, missed, today);
    expect(atRisk.status).toBe("AT_RISK");
    expect(atRisk.unauthorizedAbsences).toHaveLength(2);
    // nothing attended and too few days left
    expect(evaluateAttendance(r, approved, [], "2026-11-25").status).toBe("PROJECTED_SHORTFALL");
  });

  it("future month is not started and planned days never count as actual", () => {
    const ev = evaluateAttendance(r, approved, [], "2026-10-20");
    expect(ev.status).toBe("NOT_STARTED");
    expect(ev.actualWfoVerified).toBe(0);
  });
});

describe("quarterly aggregation and policy validation", () => {
  it("aggregates a quarter on the combined denominator", () => {
    const reqs = [10, 11, 12].map((month) => computeRequirement(base({ month, policy: PRINCIPAL })));
    const q = aggregatePeriod(reqs, 50, "CEIL");
    expect(q.attendanceEligibleDays).toBe(22 + 21 + 23);
    expect(q.effectiveMinimumWfo).toBe(33);
  });

  it("validates policy rules", () => {
    expect(validatePolicyRules({ wfoPercent: 50, mandatoryWeekdays: [1, 3, 4], flexibleWeekdays: [2, 5] }).warnings[0]).toMatch(/60%/);
    expect(validatePolicyRules({ wfoPercent: 75, mandatoryWeekdays: [1], flexibleWeekdays: [1] }).errors).toHaveLength(1);
    expect(validatePolicyRules({ wfoPercent: 120, mandatoryWeekdays: [], flexibleWeekdays: [] }).errors).toHaveLength(1);
    expect(validatePolicyRules({ wfoPercent: 75, mandatoryWeekdays: [1, 3, 4], flexibleWeekdays: [2, 5] }).errors).toHaveLength(0);
  });
});

import { describeRule, expandOccurrences, validateRule } from "@/lib/engine/recurrence";
import { jakartaToUtc, utcToJakarta } from "@/lib/dates";

describe("internal calendar recurrence", () => {
  it("expands weekly Monday huddles until the end date", () => {
    const d = expandOccurrences("2026-10-05", { freq: "WEEKLY", interval: 1, byWeekdays: [1], untilDate: "2026-10-31" });
    expect(d).toEqual(["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]);
  });
  it("supports custom every-2-weeks on several weekdays", () => {
    const d = expandOccurrences("2026-10-05", { freq: "CUSTOM", interval: 2, byWeekdays: [1, 4], untilDate: "2026-11-05" });
    expect(d).toEqual(["2026-10-05", "2026-10-08", "2026-10-19", "2026-10-22", "2026-11-02", "2026-11-05"]);
  });
  it("supports daily on weekdays only and monthly skipping short months", () => {
    expect(expandOccurrences("2026-10-30", { freq: "DAILY", interval: 1, byWeekdays: [1, 2, 3, 4, 5], untilDate: "2026-11-03" })).toEqual(["2026-10-30", "2026-11-02", "2026-11-03"]);
    expect(expandOccurrences("2026-01-31", { freq: "MONTHLY", interval: 1, byWeekdays: [], untilDate: "2026-05-31" })).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
    expect(expandOccurrences("2026-10-05", { freq: "NONE", interval: 1, byWeekdays: [], untilDate: "2026-10-05" })).toEqual(["2026-10-05"]);
  });
  it("validates and describes rules", () => {
    expect(validateRule("2026-10-05", { freq: "WEEKLY", interval: 1, byWeekdays: [1], untilDate: "2026-09-01" })).toMatch(/end date/);
    expect(validateRule("2026-10-05", { freq: "WEEKLY", interval: 1, byWeekdays: [1], untilDate: "2028-01-01" })).toMatch(/one year/);
    expect(describeRule("2026-10-05", { freq: "WEEKLY", interval: 1, byWeekdays: [1], untilDate: "2026-12-28" })).toBe("Every week on Monday until 28 Des 2026");
  });
  it("converts Jakarta wall time to UTC and back", () => {
    const d = jakartaToUtc("2026-10-26", "09:00");
    expect(d.toISOString()).toBe("2026-10-26T02:00:00.000Z");
    expect(utcToJakarta(new Date("2026-10-26T18:30:00Z"))).toEqual({ date: "2026-10-27", time: "01:30" });
  });
});
