"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission, requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { archiveClient, changeClientStatus, createClient, removePackage, updateClient, upsertPackage } from "../services/clients";
import {
  acknowledgeRegulation,
  archiveRecognition,
  createRegulation,
  discardRegulationDraft,
  publishRegulation,
  saveAnnouncement,
  saveRecognition,
  saveRegulationDraft,
  saveSection,
  setAnnouncementStatus,
  setRegulationArchived,
} from "../services/workplace";
import { setGrants } from "../services/access";
import { setProfilePhoto } from "../services/people";
import { saveUpload } from "../services/files";
import { updateSettings } from "../services/settings";

const refresh = () => revalidatePath("/", "layout");
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const optText = (max = 500) => z.string().max(max).nullable().optional();
const status = z.enum(["ACTIVE", "INACTIVE", "FREEZE"]);

// ── Clients ──
const team = z.object({
  primary: z.string().nullable(),
  secondary: z.string().nullable(),
  additional: z.array(z.string()).max(20),
  adsStrategists: z.array(z.string()).max(10),
});
const info = {
  name: z.string().max(120),
  organizationName: optText(120),
  industry: optText(80),
  description: optText(3000),
  websiteUrl: optText(300),
  instagramUrl: optText(300),
  tiktokUrl: optText(300),
  picName: optText(120),
  picContact: optText(200),
  internalNotes: optText(5000),
};

export async function createClientAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        ...info,
        clientCode: optText(30),
        status,
        dateStart: date,
        dateOff: date.nullable().optional(),
        statusEffectiveDate: date.nullable().optional(),
        packageId: z.string().min(1, "Choose a package"),
        team,
        waivePrimary: z.boolean().optional(),
        waiverReason: optText(300),
      })
      .parse(input);
    const c = await createClient(me, p);
    refresh();
    return { id: c.id, clientCode: c.clientCode };
  }, "Client saved");
}

export async function updateClientAction(id: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        ...info,
        clientCode: z.string().min(3).max(30),
        dateStart: date,
        packageId: z.string().min(1, "Choose a package"),
        team,
        waivePrimary: z.boolean().optional(),
        waiverReason: optText(300),
        status: z.object({ status, effectiveDate: date.nullable().optional(), dateOff: date.nullable().optional(), reason: optText(500) }).nullable().optional(),
      })
      .parse(input);
    await updateClient(me, z.string().parse(id), p);
    refresh();
  }, "Changes saved");
}

export async function changeClientStatusAction(id: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ status, effectiveDate: date.nullable().optional(), dateOff: date.nullable().optional(), reason: optText(500) }).parse(input);
    await changeClientStatus(me, z.string().parse(id), p);
    refresh();
  }, "Status updated");
}

export async function archiveClientAction(id: string, reason: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await archiveClient(me, z.string().parse(id), z.string().max(500).parse(reason));
    refresh();
  }, "Client archived");
}

export async function upsertPackageAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string().optional(), name: z.string().max(60), description: optText(300).transform((v) => v ?? null), isActive: z.boolean(), sortOrder: z.number().int().min(0).max(999) }).parse(input);
    await upsertPackage(me, p);
    refresh();
  }, "Package saved");
}

export async function removePackageAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await removePackage(me, z.string().parse(id));
    refresh();
    return r;
  });
}

export async function updateClientRulesAction(input: unknown) {
  return runAction(async () => {
    const me = await requirePermission("clientPackage.manage");
    const p = z.object({ clientRequirePrimaryConsultant: z.boolean(), clientFreezeCountsAsActive: z.boolean() }).parse(input);
    await updateSettings(me, p);
    refresh();
  }, "Client rules saved");
}

// ── Company Hub ──
export async function saveSectionAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z.object({ id: z.string().optional(), title: z.string().max(120), body: z.string().max(400000), isPublished: z.boolean(), sortOrder: z.number().int().min(0).max(999) }).parse(input);
    await saveSection(me, p);
    refresh();
  }, "Section saved");
}

const regulation = z.object({
  title: z.string().max(200),
  category: z.string().max(80),
  summary: optText(500),
  body: z.string().max(400000),
  effectiveDate: date,
  documentUrl: optText(500),
  attachmentId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  requiresAcknowledgement: z.boolean(),
  changeNote: optText(500),
});

export async function createRegulationAction(input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const r = await createRegulation(me, regulation.parse(input));
    refresh();
    return { id: r.id };
  }, "Draft saved");
}

export async function saveRegulationDraftAction(id: string, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await saveRegulationDraft(me, z.string().parse(id), regulation.parse(input));
    refresh();
  }, "Draft saved");
}

export async function publishRegulationAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await publishRegulation(me, z.string().parse(id));
    refresh();
  }, "Regulation published");
}

export async function discardRegulationDraftAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await discardRegulationDraft(me, z.string().parse(id));
    refresh();
  }, "Draft discarded");
}

export async function archiveRegulationAction(id: string, archived: boolean) {
  return runAction(async () => {
    const me = await requireUser();
    await setRegulationArchived(me, z.string().parse(id), z.boolean().parse(archived));
    refresh();
  }, archived ? "Regulation archived" : "Regulation restored");
}

export async function acknowledgeRegulationAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await acknowledgeRegulation(me, z.string().parse(id));
    refresh();
  }, "Thanks — acknowledgement recorded");
}

export async function saveAnnouncementAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({
        title: z.string().max(200),
        body: z.string().max(400000),
        category: z.string().max(80),
        priority: z.enum(["NORMAL", "IMPORTANT", "CRITICAL"]),
        publishAt: z.string().min(10),
        expiresAt: z.string().nullable().optional(),
        audienceType: z.enum(["ALL", "TEAMS", "LEVELS", "EMPLOYEES"]),
        teamIds: z.array(z.string()).optional(),
        levelIds: z.array(z.string()).optional(),
        employeeIds: z.array(z.string()).optional(),
        linkUrl: optText(500),
        attachmentId: z.string().nullable().optional(),
        status: z.enum(["DRAFT", "PUBLISHED"]),
      })
      .parse(input);
    const a = await saveAnnouncement(me, id ? z.string().parse(id) : null, p);
    refresh();
    return { id: a.id };
  }, "Announcement saved");
}

export async function setAnnouncementStatusAction(id: string, s: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await setAnnouncementStatus(me, z.string().parse(id), z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]).parse(s));
    refresh();
  }, "Announcement updated");
}

export async function saveRecognitionAction(id: string | null, input: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    const p = z
      .object({ employeeId: z.string(), kind: z.enum(["PROMOTION", "RECOGNITION", "MILESTONE"]), title: z.string().max(160), message: optText(1000), date, status: z.enum(["PUBLISHED", "DRAFT"]) })
      .parse(input);
    await saveRecognition(me, id ? z.string().parse(id) : null, p);
    refresh();
  }, "Recognition saved");
}

export async function archiveRecognitionAction(id: string) {
  return runAction(async () => {
    const me = await requireUser();
    await archiveRecognition(me, z.string().parse(id));
    refresh();
  }, "Recognition removed");
}

// ── Platform ──
export async function setGrantsAction(userId: string, permissions: unknown) {
  return runAction(async () => {
    const me = await requireUser();
    await setGrants(me, z.string().parse(userId), z.array(z.string()).max(20).parse(permissions));
    refresh();
  }, "Access updated");
}

export async function updatePlatformAction(input: unknown) {
  return runAction(async () => {
    const me = await requirePermission("settings.manage");
    const p = z
      .object({
        knowledgeHubUrl: z
          .string()
          .trim()
          .max(500)
          .nullable()
          .transform((v) => (v ? v : null))
          .refine((v) => !v || /^https:\/\/[^\s]+$/i.test(v), "Use a full https:// URL"),
      })
      .parse(input);
    await updateSettings(me, p);
    refresh();
  }, "Platform settings saved");
}

export async function uploadPhotoAction(employeeId: string, form: FormData) {
  return runAction(async () => {
    const me = await requireUser();
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    const f = await saveUpload(me, file, { sensitive: false });
    await setProfilePhoto(me, z.string().parse(employeeId), f.id);
    refresh();
  }, "Photo updated");
}

export async function removePhotoAction(employeeId: string) {
  return runAction(async () => {
    const me = await requireUser();
    await setProfilePhoto(me, z.string().parse(employeeId), null);
    refresh();
  }, "Photo removed");
}

/** Generic attachment upload for announcements and regulations (non-sensitive). */
export async function uploadContentFileAction(form: FormData) {
  return runAction(async () => {
    const me = await requirePermission("content.manage");
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("No file");
    const f = await saveUpload(me, file, { sensitive: false, contentAsset: true });
    return { id: f.id, name: f.originalName, size: f.size, mimeType: f.mimeType };
  });
}
