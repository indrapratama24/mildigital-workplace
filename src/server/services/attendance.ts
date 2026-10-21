// Lightweight attendance verification: manual self clock-in (no location tracking), leader/HR
// verification, and HR corrections with a mandatory reason and an immutable correction trail.
import type { VerificationStatus, WorkMode } from "@prisma/client";
import { db, withTx } from "../db";
import { formatDate, fromISO, isoWeekday, isValidISO, todayJakarta, toISO, type ISODate } from "@/lib/dates";
import type { CurrentUser } from "../auth/session";
import { can } from "../authz";
import { conflict, forbidden, invalid, notFound } from "../errors";
import { audit } from "./audit";
import { getHolidays } from "./calendar";
import { notify } from "./notifications";
import { isLeaderOf } from "./org";
import { getSettings } from "./settings";
import { isHolidayEffective } from "@/lib/engine/working-days";

export async function clockIn(actor: CurrentUser, mode: WorkMode, note?: string) {
  const date = todayJakarta();
  const settings = await getSettings();
  const holidays = await getHolidays(db, date, date);
  if (!settings.workingWeekdays.includes(isoWeekday(date)) || holidays.some((h) => isHolidayEffective(h, settings.cutiBersamaIsHoliday)))
    throw invalid("Today is not a working day.");
  return withTx(async (tx) => {
    const existing = await tx.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId: actor.employeeId, date: fromISO(date) } } });
    if (existing) throw conflict(`You already checked in today (${existing.mode}).`);
    const rec = await tx.attendanceRecord.create({
      data: {
        employeeId: actor.employeeId,
        date: fromISO(date),
        mode,
        clockInAt: new Date(),
        source: "SELF_CLOCK_IN",
        // A clock-in alone does not validate the whole day unless policy says so.
        verification: settings.clockInValidatesDay ? "VERIFIED" : "UNVERIFIED",
        note: note?.slice(0, 280),
      },
    });
    await audit(tx, { actorUserId: actor.userId, action: "attendance.clock_in", entityType: "AttendanceRecord", entityId: rec.id, after: { date, mode } });
    return rec;
  });
}

export async function verifyRecords(actor: CurrentUser, recordIds: string[], status: Extract<VerificationStatus, "VERIFIED" | "REJECTED">) {
  if (!can(actor, "attendance.verify")) throw forbidden();
  if (!recordIds.length) return { updated: 0 };
  return withTx(async (tx) => {
    const records = await tx.attendanceRecord.findMany({ where: { id: { in: recordIds } } });
    let updated = 0;
    for (const r of records) {
      if (r.employeeId === actor.employeeId) throw forbidden("You cannot verify your own attendance.");
      if (!can(actor, "company.view") && !(await isLeaderOf(tx, actor.employeeId, r.employeeId))) throw forbidden("Outside your reporting scope.");
      await tx.attendanceRecord.update({ where: { id: r.id }, data: { verification: status, verifiedById: actor.employeeId, verifiedAt: new Date() } });
      updated++;
    }
    await audit(tx, { actorUserId: actor.userId, action: `attendance.${status.toLowerCase()}`, entityType: "AttendanceRecord", entityId: recordIds.join(","), metadata: { count: updated } });
    return { updated };
  });
}

export async function correctRecord(
  actor: CurrentUser,
  input: { employeeId: string; date: ISODate; mode: WorkMode | "NONE"; verification: VerificationStatus; reason: string },
) {
  if (!can(actor, "attendance.correct")) throw forbidden();
  if (input.employeeId === actor.employeeId) throw forbidden("You cannot correct your own attendance.");
  if (!isValidISO(input.date)) throw invalid("Invalid date.");
  if (input.date > todayJakarta()) throw invalid("Future attendance cannot be recorded.");
  if (input.reason.trim().length < 10) throw invalid("A correction reason of at least 10 characters is required.");
  return withTx(async (tx) => {
    const key = { employeeId_date: { employeeId: input.employeeId, date: fromISO(input.date) } };
    const before = await tx.attendanceRecord.findUnique({ where: key });
    if (input.mode === "NONE") {
      if (!before) throw notFound("Attendance record");
      // Records are never deleted; mark as rejected so the trail stays intact.
      const after = await tx.attendanceRecord.update({ where: { id: before.id }, data: { verification: "REJECTED", verifiedById: actor.employeeId, verifiedAt: new Date(), source: "HR_CORRECTION" } });
      await tx.attendanceCorrection.create({ data: { recordId: before.id, before: snapshot(before), after: snapshot(after), reason: input.reason.trim(), correctedById: actor.employeeId } });
      return after;
    }
    const after = await tx.attendanceRecord.upsert({
      where: key,
      create: { employeeId: input.employeeId, date: fromISO(input.date), mode: input.mode, source: "HR_CORRECTION", verification: input.verification, verifiedById: actor.employeeId, verifiedAt: new Date() },
      update: { mode: input.mode, source: "HR_CORRECTION", verification: input.verification, verifiedById: actor.employeeId, verifiedAt: new Date() },
    });
    await tx.attendanceCorrection.create({ data: { recordId: after.id, before: before ? snapshot(before) : undefined, after: snapshot(after), reason: input.reason.trim(), correctedById: actor.employeeId } });
    await audit(tx, { actorUserId: actor.userId, action: "attendance.correct", entityType: "AttendanceRecord", entityId: after.id, before, after, metadata: { reason: input.reason } });
    await notify(tx, { employeeId: input.employeeId, type: "ATTENDANCE_CORRECTED", title: `Attendance corrected for ${formatDate(input.date)}`, body: `${input.mode} · ${input.verification.toLowerCase()} — ${input.reason.trim()}`, link: "/compliance" });
    return after;
  });
}

function snapshot(r: { mode: WorkMode; verification: VerificationStatus; source: string; clockInAt: Date | null }) {
  return { mode: r.mode, verification: r.verification, source: r.source, clockInAt: r.clockInAt?.toISOString() ?? null };
}

export async function todayRecord(employeeId: string) {
  return db.attendanceRecord.findUnique({ where: { employeeId_date: { employeeId, date: fromISO(todayJakarta()) } } });
}

export async function recordsToVerify(viewer: CurrentUser, employeeIds: string[] | null) {
  return db.attendanceRecord.findMany({
    where: { verification: "UNVERIFIED", employeeId: employeeIds ? { in: employeeIds.filter((id) => id !== viewer.employeeId) } : { not: viewer.employeeId } },
    include: { employee: { select: { fullName: true } } },
    orderBy: { date: "desc" },
    take: 200,
  });
}

export async function correctionHistory(limit = 50) {
  return db.attendanceCorrection.findMany({ include: { record: { include: { employee: { select: { fullName: true } } } } }, orderBy: { createdAt: "desc" }, take: limit });
}

export { toISO };
