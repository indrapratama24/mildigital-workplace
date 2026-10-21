"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { revealSensitive, setVisibility, updatePersonalData } from "../services/people";

const opt = z.string().max(500).nullable().optional();

export async function updatePersonalDataAction(employeeId: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        joinDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid join date").optional(),
        nickname: z.string().max(40).nullable().optional(),
        birthDate: opt,
        birthPlace: opt,
        phone: opt,
        personalEmail: opt,
        addressKtp: opt,
        addressDomicile: opt,
        nik: opt,
        npwp: opt,
        bankName: opt,
        bankAccountNumber: opt,
        bankAccountHolder: opt,
        maritalStatus: z.enum(["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"]).nullable().optional(),
        dependents: z.number().int().optional(),
        emergencyContactName: opt,
        emergencyContactRelation: opt,
        emergencyContactPhone: opt,
      })
      .parse(input);
    await updatePersonalData(me, z.string().parse(employeeId), p);
    revalidatePath("/directory", "layout");
  }, "Profile updated");
}

export async function revealSensitiveAction(employeeId: string, field: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    return revealSensitive(me, z.string().parse(employeeId), z.enum(["nik", "npwp", "bank"]).parse(field));
  });
}

export async function setDirectoryVisibilityAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const aud = z.enum(["EVERYONE", "SAME_TEAM", "LEADERS", "HR"]);
    await setVisibility(me, z.record(z.string(), aud).parse(input) as never);
    revalidatePath("/", "layout");
  }, "Directory visibility saved");
}
