"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { bulkEditClients, bulkEditEmployees } from "../services/bulk";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const id = z.string().min(1).max(40);
const opt = (max: number) => z.string().max(max).nullable().optional();

export async function bulkEditEmployeesAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        rows: z
          .array(
            z.object({
              id,
              patch: z.object({
                jobTitle: z.string().max(120).optional(),
                teamId: id.nullable().optional(),
                departmentId: id.nullable().optional(),
                employmentStatus: z.enum(["PERMANENT", "CONTRACT", "PROBATION", "INTERN"]).optional(),
                levelId: id.optional(),
                leaderId: id.nullable().optional(),
                leaveDays: z.number().min(-60).max(60).optional(),
              }),
            }),
          )
          .max(200),
        options: z.object({ effectiveFrom: date, reason: z.string().max(500), leaveTypeId: id.optional(), leaveYear: z.number().int().min(2000).max(2100).optional() }),
      })
      .parse(input);
    const r = await bulkEditEmployees(me, p.rows, p.options);
    revalidatePath("/", "layout");
    return r;
  });
}

export async function bulkEditClientsAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        rows: z
          .array(
            z.object({
              id,
              patch: z.object({
                name: z.string().min(2).max(120).optional(),
                packageId: id.optional(),
                categoryId: id.nullable().optional(),
                industryName: opt(80),
                subIndustryName: opt(80),
                adAccounts: z.array(z.string().max(60)).max(20).optional(),
                consultant1: id.nullable().optional(),
                consultant2: id.nullable().optional(),
                adsStrategists: z.array(id).max(10).optional(),
                status: z.enum(["ACTIVE", "INACTIVE", "FREEZE"]).optional(),
                websiteUrl: opt(300),
                picName: opt(120),
                picPhone: opt(40),
                picEmail: opt(200),
              }),
            }),
          )
          .max(200),
        options: z.object({ effectiveFrom: date, statusReason: z.string().max(500).nullable().optional() }),
      })
      .parse(input);
    const r = await bulkEditClients(me, p.rows, p.options);
    revalidatePath("/", "layout");
    return r;
  });
}
