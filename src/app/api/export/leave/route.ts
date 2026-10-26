import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { canViewLeaveReport, filtersFromParams, leaveCsv, leaveReportRows } from "@/server/services/leave-report";
import { audit } from "@/server/services/audit";
import { db } from "@/server/db";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!canViewLeaveReport(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const url = new URL(req.url);
  const filters = filtersFromParams((k) => url.searchParams.get(k) ?? undefined);
  // leaveReportRows applies the viewer's reporting scope (leaders only export their team)
  const rows = await leaveReportRows(me, filters);
  await audit(db, { actorUserId: me.userId, action: "report.export", entityType: "LeaveReport", entityId: `${filters.from}_${filters.to}`, metadata: { filters, rows: rows.length } });
  return new NextResponse("﻿" + leaveCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leave-permission-${filters.from}_${filters.to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
