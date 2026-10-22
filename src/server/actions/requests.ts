"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { cancelRequest, computeRequestImpact, saveRequestDraft, setYearEndChoice, submitRequest } from "../services/requests";
import { saveUpload } from "../services/files";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const requestSchema = z.object({
  id: z.string().optional(),
  requestTypeId: z.string().min(1, "Choose a request type"),
  startDate: date,
  endDate: date,
  durationType: z.enum(["FULL_DAY", "HALF_DAY_AM", "HALF_DAY_PM", "HOURLY"]),
  startTime: z.string().nullable().optional(),
  endTime: z.string().nullable().optional(),
  reason: z.string().max(2000),
  documentId: z.string().nullable().optional(),
  delegations: z
    .array(
      z.object({
        delegateId: z.string().min(1, "Choose a delegate"),
        handoverNotes: z.string().max(4000),
        tasks: z.array(z.object({ task: z.string().max(300), deadline: z.string().optional() })).max(20),
        coverageStart: date,
        coverageEnd: date,
        attachmentId: z.string().nullable().optional(),
      }),
    )
    .max(5)
    .nullable()
    .optional(),
  idempotencyKey: z.string().uuid(),
});

export async function previewRequestAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = requestSchema.omit({ reason: true, idempotencyKey: true }).parse(input);
    return computeRequestImpact(me, p);
  });
}

export async function saveRequestDraftAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await saveRequestDraft(me, requestSchema.parse(input));
    revalidatePath("/requests");
    return { id: r.id };
  }, "Draft saved");
}

export async function submitRequestAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await submitRequest(me, requestSchema.parse(input));
    revalidatePath("/", "layout");
    return { id: r.id, status: r.status };
  }, "Request submitted");
}

export async function cancelRequestAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await cancelRequest(me, z.string().parse(id));
    revalidatePath("/", "layout");
  }, "Request cancelled");
}

export async function uploadAction(form: FormData) {
  return runAction(async () => {
    const me = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    const f = await saveUpload(me, file, { sensitive: form.get("sensitive") === "true" });
    return { id: f.id, name: f.originalName, size: f.size };
  });
}

export async function setYearEndChoiceAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ option: z.enum(["CASH", "CARRY"]), days: z.number().min(0.5).max(60) }).parse(input);
    await setYearEndChoice(me, p);
    revalidatePath("/", "layout");
  }, "Year-end choice saved");
}
