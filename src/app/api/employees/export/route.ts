import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz";
import { employeesExportCsv } from "@/server/services/employee-import";
import { audit } from "@/server/services/audit";
import { db } from "@/server/db";
import { todayJakarta } from "@/lib/dates";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!can(me, "employee.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const csv = await employeesExportCsv(me);
  await audit(db, { actorUserId: me.userId, action: "employee.export", entityType: "Employee", entityId: "directory" });
  return new NextResponse("﻿" + csv, {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="mil-team-${todayJakarta()}.csv"`, "Cache-Control": "private, no-store" },
  });
}
