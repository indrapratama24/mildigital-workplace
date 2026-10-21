import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz";
import { complianceRows, toCsv } from "@/server/services/compliance";
import { currentMonthJakarta, monthParam, parseMonthParam } from "@/lib/dates";
import { audit } from "@/server/services/audit";
import { db } from "@/server/db";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!can(me, "report.export") && !can(me, "team.view")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const { year, month } = parseMonthParam(url.searchParams.get("month") ?? undefined, currentMonthJakarta());
  const filters = {
    teamId: url.searchParams.get("team") || undefined,
    levelId: url.searchParams.get("level") || undefined,
    leaderId: url.searchParams.get("leader") || undefined,
    status: url.searchParams.get("status") || undefined,
    q: url.searchParams.get("q") || undefined,
  };
  // complianceRows applies the viewer's reporting scope (leaders only export their team)
  const rows = await complianceRows(me, year, month, filters);
  await audit(db, { actorUserId: me.userId, action: "report.export", entityType: "Compliance", entityId: monthParam(year, month), metadata: { filters, rows: rows.length } });
  return new NextResponse("﻿" + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="compliance-${monthParam(year, month)}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
