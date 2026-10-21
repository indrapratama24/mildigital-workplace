import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { getEventDetail, toIcs } from "@/server/services/events";
import { DomainError } from "@/server/errors";

/** "Add to my calendar": RFC 5545 file for Google Calendar / Outlook / Apple Calendar. */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const e = await getEventDetail(me, (await params).id);
    if (e.status === "DRAFT") return NextResponse.json({ error: "Drafts can't be exported" }, { status: 400 });
    return new NextResponse(toIcs(e), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": `attachment; filename="${e.title.replace(/[^\w\- ]+/g, "").slice(0, 60) || "event"}.ics"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    if (err instanceof DomainError) return NextResponse.json({ error: err.message }, { status: err.code === "NOT_FOUND" ? 404 : 403 });
    throw err;
  }
}
