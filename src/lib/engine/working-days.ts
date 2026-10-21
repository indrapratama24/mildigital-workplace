// Centralised working-day & WFO requirement engine.
// Pure functions only (no DB access) so every rule is unit-testable.
//
// Definitions
//   Base scheduled days      = working weekdays in the month (default Mon–Fri)
//   Eligible working days    = base scheduled days − observed holidays (national, company, cuti bersama*)
//   Attendance-eligible days = eligible − approved full-day leave (if policy excludes leave from the denominator)
//                                       − approved offsite days (only when offsite does NOT count as WFO)
//   Percentage minimum       = round(attendance-eligible × WFO%) using the policy rounding mode (default CEIL)
//   Mandatory WFO count      = mandatory-weekday dates that are attendance-eligible, not on leave, not waived
//   Effective minimum WFO    = MAX(percentage minimum − approved reductions, mandatory count)
//   Maximum WFH              = plannable days + offsite credit − effective minimum

import { type ISODate, isoWeekday, monthDates, weekKey } from "../dates";

export type WorkModeT = "WFO" | "WFH" | "OFFSITE";
export type RoundingModeT = "CEIL" | "ROUND" | "FLOOR";
export type HolidayTypeT = "NATIONAL" | "CUTI_BERSAMA" | "COMPANY";

export interface PolicyRules {
  wfoPercent: number;
  mandatoryWeekdays: number[];
  roundingMode: RoundingModeT;
  excludeLeaveFromDenominator: boolean;
  offsiteCountsAsWfo: boolean;
}

export interface HolidayInput {
  date: ISODate;
  name: string;
  type: HolidayTypeT;
  isObserved: boolean;
}

export interface LeaveDay {
  date: ISODate;
  /** 1 = full day, 0.5 = half day. Hourly permissions are 0 (do not change the day's status). */
  portion: number;
  category: "LEAVE" | "PERMISSION";
  label: string;
  typeCode: string;
}

export interface MonthInput {
  year: number;
  month: number;
  workingWeekdays?: number[];
  holidays: HolidayInput[];
  cutiBersamaIsHoliday?: boolean;
  policy: PolicyRules;
  leaves?: LeaveDay[];
  offsiteDates?: ISODate[];
  mandatoryWaiverDates?: ISODate[];
  wfoReductionDays?: number;
}

export type DayKind = "WEEKEND" | "HOLIDAY" | "LEAVE" | "OFFSITE" | "WORKDAY";

export interface DayInfo {
  date: ISODate;
  weekday: number;
  kind: DayKind;
  holiday?: HolidayInput;
  leave?: LeaveDay;
  /** counted in the attendance-eligible denominator */
  attendanceEligible: boolean;
  /** needs a WFO/WFH choice in the planner */
  plannable: boolean;
  mandatory: boolean;
  waived: boolean;
}

export type WarningCode =
  | "MANDATORY_EXCEEDS_RATIO"
  | "POLICY_NO_FLEXIBILITY"
  | "LEAVE_EXCLUDED"
  | "UNACHIEVABLE"
  | "NO_ELIGIBLE_DAYS"
  | "EXCEPTION_APPLIED";

export interface EngineWarning {
  code: WarningCode;
  message: string;
}

export interface MonthRequirement {
  year: number;
  month: number;
  days: DayInfo[];
  baseScheduledDays: number;
  holidayDays: number;
  eligibleWorkingDays: number;
  fullLeaveDays: number;
  halfLeaveDays: number;
  offsiteDays: number;
  attendanceEligibleDays: number;
  plannableDays: number;
  targetPercent: number;
  /** minimum before the leave denominator adjustment (for reporting) */
  baselinePercentMinimum: number;
  percentMinimum: number;
  wfoReduction: number;
  mandatoryDates: ISODate[];
  mandatoryCount: number;
  offsiteCredit: number;
  effectiveMinimumWfo: number;
  maxWfhDays: number;
  effectiveWfoPercent: number;
  warnings: EngineWarning[];
}

export function applyRounding(value: number, pct: number, mode: RoundingModeT): number {
  // integer arithmetic: value * pct / 100 without floating error
  const num = value * pct;
  if (mode === "FLOOR") return Math.floor(num / 100);
  if (mode === "ROUND") return Math.floor((num + 50) / 100);
  return Math.floor((num + 99) / 100);
}

export function isHolidayEffective(h: HolidayInput, cutiBersamaIsHoliday: boolean): boolean {
  if (!h.isObserved) return false;
  if (h.type === "CUTI_BERSAMA") return cutiBersamaIsHoliday;
  return true;
}

export function computeRequirement(input: MonthInput): MonthRequirement {
  const workingWeekdays = input.workingWeekdays ?? [1, 2, 3, 4, 5];
  const cutiBersama = input.cutiBersamaIsHoliday ?? true;
  const { policy } = input;
  const holidayByDate = new Map<ISODate, HolidayInput>();
  for (const h of input.holidays) {
    if (isHolidayEffective(h, cutiBersama) && !holidayByDate.has(h.date)) holidayByDate.set(h.date, h);
  }
  // A day can have several leave entries (e.g. AM + PM halves) — merge portions.
  const leaveByDate = new Map<ISODate, LeaveDay>();
  for (const l of input.leaves ?? []) {
    const prev = leaveByDate.get(l.date);
    if (!prev) leaveByDate.set(l.date, { ...l });
    else leaveByDate.set(l.date, { ...prev, portion: Math.min(1, prev.portion + l.portion), label: `${prev.label} + ${l.label}` });
  }
  const offsite = new Set(input.offsiteDates ?? []);
  const waivers = new Set(input.mandatoryWaiverDates ?? []);

  const days: DayInfo[] = [];
  let base = 0,
    holidayDays = 0,
    eligible = 0,
    fullLeave = 0,
    halfLeave = 0,
    offsiteDays = 0,
    attendanceEligible = 0,
    plannable = 0,
    offsiteCredit = 0;
  const mandatoryDates: ISODate[] = [];

  for (const date of monthDates(input.year, input.month)) {
    const weekday = isoWeekday(date);
    const info: DayInfo = { date, weekday, kind: "WEEKEND", attendanceEligible: false, plannable: false, mandatory: false, waived: false };
    days.push(info);
    if (!workingWeekdays.includes(weekday)) continue;
    base++;
    const holiday = holidayByDate.get(date);
    if (holiday) {
      info.kind = "HOLIDAY";
      info.holiday = holiday;
      holidayDays++;
      continue;
    }
    eligible++;
    const leave = leaveByDate.get(date);
    if (leave) info.leave = leave;
    if (leave && leave.portion >= 1) {
      info.kind = "LEAVE";
      fullLeave++;
      if (!policy.excludeLeaveFromDenominator) {
        info.attendanceEligible = true;
        attendanceEligible++;
      }
      continue;
    }
    if (leave && leave.portion > 0) halfLeave++;
    if (offsite.has(date)) {
      info.kind = "OFFSITE";
      offsiteDays++;
      if (policy.offsiteCountsAsWfo) {
        info.attendanceEligible = true;
        attendanceEligible++;
        offsiteCredit++;
        if (policy.mandatoryWeekdays.includes(weekday)) {
          info.mandatory = true; // satisfied by the approved offsite duty
          mandatoryDates.push(date);
        }
      }
      continue;
    }
    info.kind = "WORKDAY";
    info.attendanceEligible = true;
    info.plannable = true;
    attendanceEligible++;
    plannable++;
    if (policy.mandatoryWeekdays.includes(weekday)) {
      if (waivers.has(date)) info.waived = true;
      else {
        info.mandatory = true;
        mandatoryDates.push(date);
      }
    }
  }

  const warnings: EngineWarning[] = [];
  const pct = clampPercent(policy.wfoPercent);
  const baselineDenominator = attendanceEligible + (policy.excludeLeaveFromDenominator ? fullLeave : 0);
  const baselinePercentMinimum = applyRounding(baselineDenominator, pct, policy.roundingMode);
  const percentMinimum = applyRounding(attendanceEligible, pct, policy.roundingMode);
  const reduction = Math.max(0, Math.floor(input.wfoReductionDays ?? 0));
  const reducedPercentMin = Math.max(0, percentMinimum - reduction);
  const mandatoryCount = mandatoryDates.length;
  const capacity = plannable + offsiteCredit;
  let effective = Math.max(reducedPercentMin, mandatoryCount);
  effective = Math.min(effective, attendanceEligible);

  if (attendanceEligible === 0) {
    warnings.push({ code: "NO_ELIGIBLE_DAYS", message: "No attendance-eligible days this month; no WFO requirement applies." });
  }
  if (mandatoryCount > reducedPercentMin) {
    warnings.push({
      code: "MANDATORY_EXCEEDS_RATIO",
      message: `Mandatory WFO days (${mandatoryCount}) exceed the ${pct}% minimum (${reducedPercentMin} days). The effective minimum is ${mandatoryCount} days (${percentOf(mandatoryCount, attendanceEligible)}%), not ${pct}%.`,
    });
  }
  const mandatoryShare = workingWeekdays.length ? (policy.mandatoryWeekdays.filter((d) => workingWeekdays.includes(d)).length / workingWeekdays.length) * 100 : 0;
  if (mandatoryShare > pct) {
    warnings.push({
      code: "POLICY_NO_FLEXIBILITY",
      message: `${policy.mandatoryWeekdays.length} mandatory weekday(s) = ${Math.round(mandatoryShare)}% of the working week, above the ${pct}% target. Reduce mandatory days to keep the policy flexible.`,
    });
  }
  if (policy.excludeLeaveFromDenominator && fullLeave > 0 && baselinePercentMinimum !== percentMinimum) {
    warnings.push({
      code: "LEAVE_EXCLUDED",
      message: `${fullLeave} approved full-day leave day(s) excluded from the denominator; minimum WFO recalculated from ${baselinePercentMinimum} to ${percentMinimum} days.`,
    });
  }
  if (reduction > 0) {
    warnings.push({ code: "EXCEPTION_APPLIED", message: `Authorised exception reduces the percentage minimum by ${reduction} day(s).` });
  }
  if (effective > capacity) {
    warnings.push({
      code: "UNACHIEVABLE",
      message: `Minimum WFO (${effective}) exceeds the ${capacity} day(s) available for office work. An authorised exception is required.`,
    });
  }

  return {
    year: input.year,
    month: input.month,
    days,
    baseScheduledDays: base,
    holidayDays,
    eligibleWorkingDays: eligible,
    fullLeaveDays: fullLeave,
    halfLeaveDays: halfLeave,
    offsiteDays,
    attendanceEligibleDays: attendanceEligible,
    plannableDays: plannable,
    targetPercent: pct,
    baselinePercentMinimum,
    percentMinimum,
    wfoReduction: reduction,
    mandatoryDates,
    mandatoryCount,
    offsiteCredit,
    effectiveMinimumWfo: effective,
    maxWfhDays: Math.max(0, capacity - effective),
    effectiveWfoPercent: percentOf(effective, attendanceEligible),
    warnings,
  };
}

function clampPercent(p: number) {
  return Math.max(0, Math.min(100, Math.round(p)));
}

export function percentOf(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 10;
}

// ───────────────────────────── Plan evaluation ─────────────────────────────

export type ModeMap = Partial<Record<ISODate, WorkModeT | null>>;

export interface PlanEvaluation {
  plannedWfo: number; // includes offsite credit
  plannedOfficeDays: number;
  plannedWfh: number;
  unplannedDates: ISODate[];
  missingMandatoryDates: ISODate[];
  shortfall: number;
  wfhAllowanceRemaining: number;
  plannedPercent: number;
  complete: boolean;
  compliant: boolean;
  violations: string[];
}

export function evaluatePlan(req: MonthRequirement, modes: ModeMap): PlanEvaluation {
  let office = 0,
    wfh = 0;
  const unplanned: ISODate[] = [];
  const missingMandatory: ISODate[] = [];
  for (const d of req.days) {
    if (!d.plannable) continue;
    const m = modes[d.date];
    if (m === "WFO") office++;
    else if (m === "WFH") wfh++;
    else unplanned.push(d.date);
    if (d.mandatory && m === "WFH") missingMandatory.push(d.date); // unplanned days are reported separately
  }
  const plannedWfo = office + req.offsiteCredit;
  const shortfall = Math.max(0, req.effectiveMinimumWfo - plannedWfo);
  const violations: string[] = [];
  if (unplanned.length) violations.push(`${unplanned.length} working day(s) not planned yet`);
  if (missingMandatory.length) violations.push(`${missingMandatory.length} mandatory WFO day(s) set to WFH`);
  if (shortfall) violations.push(`WFO shortfall of ${shortfall} day(s) against minimum ${req.effectiveMinimumWfo}`);
  return {
    plannedWfo,
    plannedOfficeDays: office,
    plannedWfh: wfh,
    unplannedDates: unplanned,
    missingMandatoryDates: missingMandatory,
    shortfall,
    wfhAllowanceRemaining: req.maxWfhDays - wfh,
    plannedPercent: percentOf(plannedWfo, req.attendanceEligibleDays),
    complete: unplanned.length === 0,
    compliant: unplanned.length === 0 && missingMandatory.length === 0 && shortfall === 0,
    violations,
  };
}

// ───────────────────────────── Auto-generation ─────────────────────────────

export interface GenerateOptions {
  /** WFO days to keep (auto-balance mode). Ignored if not plannable. */
  seedWfo?: ISODate[];
  /** Dates that must not change (e.g. dates with pending changes). */
  locked?: ModeMap;
  /** Dates that should be WFO first (e.g. mandatory in-office events) — applied before balancing. */
  preferWfo?: ISODate[];
}

/**
 * Builds a compliant plan: mandatory days → WFO; additional WFO days are spread so that each
 * ISO week carries a proportional share of office days; everything else → WFH.
 */
export function generatePlan(req: MonthRequirement, opts: GenerateOptions = {}): Record<ISODate, WorkModeT> {
  const plan: Record<ISODate, WorkModeT> = {};
  const plannable = req.days.filter((d) => d.plannable);
  const weekTotals = new Map<string, number>();
  const weekWfo = new Map<string, number>();
  for (const d of plannable) weekTotals.set(weekKey(d.date), (weekTotals.get(weekKey(d.date)) ?? 0) + 1);
  const setWfo = (date: ISODate) => {
    plan[date] = "WFO";
    const k = weekKey(date);
    weekWfo.set(k, (weekWfo.get(k) ?? 0) + 1);
  };

  for (const d of plannable) {
    const locked = opts.locked?.[d.date];
    if (locked === "WFO" || d.mandatory) setWfo(d.date);
    else if (locked === "WFH") plan[d.date] = "WFH";
  }
  const prefer = new Set(opts.preferWfo ?? []);
  for (const d of plannable) if (!plan[d.date] && prefer.has(d.date)) setWfo(d.date);
  const seed = new Set(opts.seedWfo ?? []);
  for (const d of plannable) if (!plan[d.date] && seed.has(d.date)) setWfo(d.date);

  const count = () => Object.values(plan).filter((m) => m === "WFO").length + req.offsiteCredit;
  while (count() < req.effectiveMinimumWfo) {
    const candidates = plannable.filter((d) => !plan[d.date]);
    if (!candidates.length) break;
    candidates.sort((a, b) => {
      const ka = weekKey(a.date),
        kb = weekKey(b.date);
      const la = (weekWfo.get(ka) ?? 0) / (weekTotals.get(ka) ?? 1);
      const lb = (weekWfo.get(kb) ?? 0) / (weekTotals.get(kb) ?? 1);
      if (la !== lb) return la - lb;
      // prefer mid-week days for collaboration (Tue/Wed/Thu), then earliest
      const pa = Math.abs(a.weekday - 3),
        pb = Math.abs(b.weekday - 3);
      if (pa !== pb) return pa - pb;
      return a.date < b.date ? -1 : 1;
    });
    setWfo(candidates[0].date);
  }
  for (const d of plannable) if (!plan[d.date]) plan[d.date] = "WFH";
  return plan;
}

// ───────────────────────────── Revision impact ─────────────────────────────

export interface ChangeInput {
  date: ISODate;
  toMode: WorkModeT;
  isReplacement?: boolean;
}

export interface RevisionImpact {
  plannedWfoBefore: number;
  plannedWfoAfter: number;
  minimumRequired: number;
  shortfall: number;
  replacementRequired: number;
  mandatoryViolations: ISODate[];
  invalid: { date: ISODate; reason: string }[];
  suggestions: ISODate[];
  requiresException: boolean;
  wfhAllowanceBefore: number;
  wfhAllowanceAfter: number;
}

export function computeRevisionImpact(
  req: MonthRequirement,
  approved: ModeMap,
  changes: ChangeInput[],
  today: ISODate,
  blockedDates: ISODate[] = [],
): RevisionImpact {
  const byDate = new Map(req.days.map((d) => [d.date, d]));
  const invalid: { date: ISODate; reason: string }[] = [];
  const after: ModeMap = { ...approved };
  const seen = new Set<ISODate>();
  const blocked = new Set(blockedDates);
  for (const c of changes) {
    const info = byDate.get(c.date);
    if (seen.has(c.date)) invalid.push({ date: c.date, reason: "Date appears twice in the request" });
    seen.add(c.date);
    if (!info) invalid.push({ date: c.date, reason: "Date is outside this month" });
    else if (!info.plannable) invalid.push({ date: c.date, reason: "Not a plannable working day (weekend, holiday, leave or offsite)" });
    else if (c.date < today) invalid.push({ date: c.date, reason: "Past dates cannot be changed — ask HR for an attendance correction" });
    else if (blocked.has(c.date)) invalid.push({ date: c.date, reason: "Date already has a pending change" });
    else if (approved[c.date] === c.toMode) invalid.push({ date: c.date, reason: `Already ${c.toMode}` });
    after[c.date] = c.toMode;
  }
  const before = evaluatePlan(req, approved);
  const next = evaluatePlan(req, after);
  const mandatoryViolations = changes.filter((c) => byDate.get(c.date)?.mandatory && c.toMode !== "WFO").map((c) => c.date);
  const shortfall = Math.max(0, req.effectiveMinimumWfo - next.plannedWfo);

  // Suggest replacement WFO dates: future WFH days that are not mandatory/changed/blocked,
  // prioritising the same week as the first change, then the nearest date.
  const anchor = changes.find((c) => c.toMode === "WFH")?.date ?? today;
  const suggestions = req.days
    .filter((d) => d.plannable && d.date > today && after[d.date] === "WFH" && !seen.has(d.date) && !blocked.has(d.date))
    .sort((a, b) => {
      const sa = weekKey(a.date) === weekKey(anchor) ? 0 : 1;
      const sb = weekKey(b.date) === weekKey(anchor) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return dist(a.date, anchor) - dist(b.date, anchor);
    })
    .slice(0, 5)
    .map((d) => d.date);

  return {
    plannedWfoBefore: before.plannedWfo,
    plannedWfoAfter: next.plannedWfo,
    minimumRequired: req.effectiveMinimumWfo,
    shortfall,
    replacementRequired: shortfall,
    mandatoryViolations,
    invalid,
    suggestions: shortfall > 0 ? suggestions : [],
    // A shortfall that can be covered by replacement dates is not an exception — the employee must
    // add replacement WFO day(s). Only uncoverable shortfalls and mandatory-day changes need one.
    requiresException: mandatoryViolations.length > 0 || (shortfall > 0 && suggestions.length < shortfall),
    wfhAllowanceBefore: before.wfhAllowanceRemaining,
    wfhAllowanceAfter: next.wfhAllowanceRemaining,
  };
}

function dist(a: ISODate, b: ISODate) {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime());
}

// ───────────────────────────── Attendance compliance ─────────────────────────────

export interface AttendanceInput {
  date: ISODate;
  mode: WorkModeT;
  verified: boolean;
}

export type ComplianceStatus =
  | "COMPLIANT"
  | "NON_COMPLIANT"
  | "PENDING_VERIFICATION"
  | "ON_TRACK"
  | "AT_RISK"
  | "PROJECTED_SHORTFALL"
  | "NOT_STARTED";

export interface AttendanceEvaluation {
  phase: "PAST" | "CURRENT" | "FUTURE";
  actualWfoVerified: number;
  actualWfoUnverified: number;
  actualWfh: number;
  offsiteCreditToDate: number;
  approvedWfhToDate: number;
  unauthorizedAbsences: ISODate[];
  mandatoryMissed: ISODate[];
  remainingRequiredWfo: number;
  futurePlannedWfo: number;
  remainingPlannableDays: number;
  attendancePercent: number;
  status: ComplianceStatus;
}

/**
 * Attendance compliance uses verified records only. A self clock-in is "unverified" until a leader/HR
 * verifies it (or policy configures clock-in as sufficient). Planned days are never counted as actual.
 */
export function evaluateAttendance(
  req: MonthRequirement,
  approved: ModeMap,
  records: AttendanceInput[],
  today: ISODate,
): AttendanceEvaluation {
  const recByDate = new Map(records.map((r) => [r.date, r]));
  const first = req.days[0].date,
    last = req.days[req.days.length - 1].date;
  const phase = today > last ? "PAST" : today < first ? "FUTURE" : "CURRENT";
  let verified = 0,
    unverified = 0,
    wfh = 0,
    offsiteToDate = 0,
    approvedWfh = 0,
    futurePlanned = 0,
    futureOffsite = 0,
    remainingPlannable = 0;
  const unauthorized: ISODate[] = [];
  const mandatoryMissed: ISODate[] = [];

  for (const d of req.days) {
    const rec = recByDate.get(d.date);
    const elapsed = d.date < today || (d.date === today && !!rec);
    if (d.kind === "OFFSITE" && req.offsiteCredit > 0) {
      if (d.date <= today) offsiteToDate++;
      else {
        futurePlanned++;
        futureOffsite++;
      }
      continue;
    }
    if (!d.plannable) continue;
    if (elapsed) {
      if (rec?.mode === "WFO" || rec?.mode === "OFFSITE") {
        if (rec.verified) verified++;
        else unverified++;
      } else if (rec?.mode === "WFH") wfh++;
      if (approved[d.date] === "WFH") approvedWfh++;
      if (!rec && approved[d.date] === "WFO") unauthorized.push(d.date);
      if (d.mandatory && !(rec && rec.mode !== "WFH")) mandatoryMissed.push(d.date);
    } else {
      remainingPlannable++;
      if (approved[d.date] === "WFO") futurePlanned++;
    }
  }
  const credit = verified + offsiteToDate;
  const min = req.effectiveMinimumWfo;
  let status: ComplianceStatus;
  if (phase === "FUTURE") status = "NOT_STARTED";
  else if (phase === "PAST") {
    status = credit >= min ? "COMPLIANT" : credit + unverified >= min ? "PENDING_VERIFICATION" : "NON_COMPLIANT";
  } else {
    const need = min - (credit + unverified);
    if (need <= 0) status = "ON_TRACK";
    else if (futurePlanned >= need) status = unauthorized.length || mandatoryMissed.length ? "AT_RISK" : "ON_TRACK";
    else if (remainingPlannable + futureOffsite >= need) status = "AT_RISK";
    else status = "PROJECTED_SHORTFALL";
  }
  return {
    phase,
    actualWfoVerified: verified,
    actualWfoUnverified: unverified,
    actualWfh: wfh,
    offsiteCreditToDate: offsiteToDate,
    approvedWfhToDate: approvedWfh,
    unauthorizedAbsences: unauthorized,
    mandatoryMissed,
    remainingRequiredWfo: Math.max(0, min - credit),
    futurePlannedWfo: futurePlanned,
    remainingPlannableDays: remainingPlannable,
    attendancePercent: percentOf(credit, req.attendanceEligibleDays),
    status,
  };
}

// ───────────────────────────── Quarterly aggregation ─────────────────────────────

export function aggregatePeriod(reqs: MonthRequirement[], wfoPercent: number, rounding: RoundingModeT) {
  const attendanceEligibleDays = reqs.reduce((s, r) => s + r.attendanceEligibleDays, 0);
  const mandatoryCount = reqs.reduce((s, r) => s + r.mandatoryCount, 0);
  const percentMinimum = applyRounding(attendanceEligibleDays, wfoPercent, rounding);
  return {
    attendanceEligibleDays,
    mandatoryCount,
    percentMinimum,
    effectiveMinimumWfo: Math.min(attendanceEligibleDays, Math.max(percentMinimum, mandatoryCount)),
  };
}

// ───────────────────────────── Policy validation ─────────────────────────────

export function validatePolicyRules(p: {
  wfoPercent: number;
  mandatoryWeekdays: number[];
  flexibleWeekdays: number[];
  workingWeekdays?: number[];
}): { errors: string[]; warnings: string[] } {
  const working = p.workingWeekdays ?? [1, 2, 3, 4, 5];
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(p.wfoPercent) || p.wfoPercent < 0 || p.wfoPercent > 100) errors.push("WFO percentage must be a whole number between 0 and 100.");
  const overlap = p.mandatoryWeekdays.filter((d) => p.flexibleWeekdays.includes(d));
  if (overlap.length) errors.push("A weekday cannot be both mandatory and flexible.");
  const nonWorking = [...p.mandatoryWeekdays, ...p.flexibleWeekdays].filter((d) => !working.includes(d));
  if (nonWorking.length) errors.push("Mandatory/flexible days must be working weekdays.");
  const share = (p.mandatoryWeekdays.length / working.length) * 100;
  if (share > p.wfoPercent)
    warnings.push(
      `Mandatory days alone require ${Math.round(share)}% WFO — more than the ${p.wfoPercent}% target. Employees will have no flexibility; the effective minimum follows the mandatory days.`,
    );
  if (p.wfoPercent > 0 && p.mandatoryWeekdays.length === 0) warnings.push("No mandatory days: employees choose all WFO days freely.");
  return { errors, warnings };
}
