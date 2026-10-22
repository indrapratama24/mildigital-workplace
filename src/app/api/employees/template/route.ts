import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz";
import { employeeCsvTemplate } from "@/server/services/employee-import";

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!can(me, "employee.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return new NextResponse("﻿" + employeeCsvTemplate(), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="mil-team-template.csv"', "Cache-Control": "private, no-store" },
  });
}
