import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/session";
import { can } from "@/server/authz";
import { clientsCsv, listClients, type ClientFilters } from "@/server/services/clients";
import { audit } from "@/server/services/audit";
import { db } from "@/server/db";
import { todayJakarta } from "@/lib/dates";

export async function GET(req: Request) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (!can(me, "client.export")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const sp = new URL(req.url).searchParams;
  const filters: ClientFilters = {
    q: sp.get("q") || undefined,
    status: (sp.get("status") as ClientFilters["status"]) || "ALL",
    packageId: sp.get("package") || undefined,
    consultantId: sp.get("consultant") || undefined,
    asId: sp.get("as") || undefined,
    industry: sp.get("industry") || undefined,
    sort: (sp.get("sort") as ClientFilters["sort"]) || "name",
  };
  const { all } = await listClients(me, filters);
  await audit(db, { actorUserId: me.userId, action: "client.export", entityType: "ClientBrand", entityId: "directory", metadata: { filters, rows: all.length } });
  return new NextResponse("﻿" + clientsCsv(all), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="mil-clients-${todayJakarta()}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
