// Read-only portfolio metrics for internal consumers (future Performance & Growth module).
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { PORTFOLIO_BREAKDOWNS, portfolioSummary, portfolioTrend, portfolioVisibleFor } from "@/server/services/client-metrics";
import { getSettings } from "@/server/services/settings";
import { currentMonthJakarta, parseMonthParam } from "@/lib/dates";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const { year, month } = parseMonthParam(sp.get("month") ?? undefined, currentMonthJakarta());
  const months = Math.min(36, Math.max(1, Number(sp.get("months") ?? 12) || 12));
  const [summary, trend, settings] = await Promise.all([portfolioSummary(year, month), portfolioTrend(months), getSettings()]);
  const visible = portfolioVisibleFor(me, settings);
  // Full metrics only for people who may see every number; others need at least one to get anything.
  if (visible && visible.size === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { newClients: _omit, ...counts } = summary;
  if (visible) {
    const out: Record<string, unknown> = { asOf: summary.asOf };
    const STAT_FIELD: Record<string, keyof typeof counts> = { active: "active", preparation: "preparation", freeze: "freeze", inactive: "inactive", total: "total", new: "newThisPeriod" };
    for (const [k, f] of Object.entries(STAT_FIELD)) if (visible.has(k)) out[f] = counts[f];
    for (const [k, v] of Object.entries(PORTFOLIO_BREAKDOWNS)) if (visible.has(k)) out[v.key] = counts[v.key];
    return NextResponse.json({ summary: out }, { headers: { "Cache-Control": "private, no-store" } });
  }
  return NextResponse.json({ summary: counts, trend }, { headers: { "Cache-Control": "private, no-store" } });
}
