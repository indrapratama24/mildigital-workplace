import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { runDailyJobs } from "@/server/services/jobs";

// Daily jobs. Vercel Cron calls GET with "Authorization: Bearer $CRON_SECRET" (see vercel.json, 07:00 WIB);
// other schedulers can POST with the same header.
export async function GET(req: Request) {
  return POST(req);
}

export async function POST(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const ok = secret.length >= 16 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(await runDailyJobs());
}
