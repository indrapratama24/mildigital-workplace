"use server";
// Office schedule (WFO Policy off) and the WFO Policy switch
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "../auth/guard";
import { runAction } from "../errors";
import { setOfficeDays, setOfficePattern, setWfoPolicyEnabled } from "../services/office";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date");
const refresh = () => revalidatePath("/", "layout");
const changed = (r: { replaced: number; notified: number }) =>
  [r.notified ? `${r.notified} employee(s) notified` : "", r.replaced ? `${r.replaced} personal change(s) replaced` : ""].filter(Boolean).join(" · ");

export async function setOfficePatternAction(input: unknown) {
  const r = await runAction(async () => {
    const me = await requireUser();
    const p = z.object({ teamId: z.string().nullable(), wfoWeekdays: z.array(z.number().int().min(1).max(7)).max(7).nullable() }).parse(input);
    const res = await setOfficePattern(me, p);
    refresh();
    return res;
  });
  return r.ok && r.data ? { ...r, message: ["Weekly office days saved", changed(r.data)].filter(Boolean).join(" · ") } : r;
}

export async function setOfficeDaysAction(input: unknown) {
  const r = await runAction(async () => {
    const me = await requireUser();
    const p = z.object({ teamId: z.string().nullable(), dates: z.array(date).min(1).max(62), mode: z.enum(["WFO", "WFH"]).nullable(), note: z.string().max(200).nullable().optional() }).parse(input);
    const res = await setOfficeDays(me, p);
    refresh();
    return res;
  });
  return r.ok && r.data ? { ...r, message: ["Office schedule updated", changed(r.data)].filter(Boolean).join(" · ") } : r;
}

export async function setWfoPolicyEnabledAction(enabled: boolean) {
  return runAction(
    async () => {
      const me = await requireUser();
      const r = await setWfoPolicyEnabled(me, z.boolean().parse(enabled));
      refresh();
      return r;
    },
    enabled ? "WFO Policy turned on" : "WFO Policy turned off — calendars follow the office schedule",
  );
}
