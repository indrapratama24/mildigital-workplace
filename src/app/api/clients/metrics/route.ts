// Read-only portfolio metrics for internal consumers (future Performance & Growth module).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { portfolioSummary, portfolioTrend } from "@/server/services/client-metrics";
import { currentMonthJakarta, parseMonthParam } from "@/lib/dates";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const { year, month } = parseMonthParam(sp.get("month") ?? undefined, currentMonthJakarta());
  const months = Math.min(36, Math.max(1, Number(sp.get("months") ?? 12) || 12));
  const [summary, trend] = await Promise.all([portfolioSummary(year, month), portfolioTrend(months)]);
  const { newClients: _omit, ...counts } = summary;
  return NextResponse.json({ summary: counts, trend }, { headers: { "Cache-Control": "private, no-store" } });
}
