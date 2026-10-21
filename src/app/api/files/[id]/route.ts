import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { authorizeFileAccess, readFile } from "@/server/services/files";
import { DomainError } from "@/server/errors";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  try {
    const { id } = await params;
    const file = await authorizeFileAccess(me, id);
    const data = await readFile(file.storageKey);
    // Images (profile photos, announcement images) may be shown inline; everything else downloads.
    const inline = new URL(req.url).searchParams.get("inline") === "1" && file.mimeType.startsWith("image/");
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(file.originalName)}"`,
        "Cache-Control": inline ? "private, max-age=300" : "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    if (e instanceof DomainError) return NextResponse.json({ error: e.message }, { status: e.code === "NOT_FOUND" ? 404 : 403 });
    throw e;
  }
}
