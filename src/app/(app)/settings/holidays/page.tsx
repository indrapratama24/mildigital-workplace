import Link from "next/link";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { getSettings } from "@/server/services/settings";
import { currentMonthJakarta, formatDateLong, fromISO, toISO } from "@/lib/dates";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, Table } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { DeleteHolidayButton, HolidayDialog, HolidayImport } from "../forms";

export default async function HolidaysPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  await requirePagePermission("holiday.manage");
  const sp = await searchParams;
  const year = Number(sp.year) || currentMonthJakarta().year;
  const [holidays, settings] = await Promise.all([
    db.holiday.findMany({ where: { calendar: { isDefault: true }, date: { gte: fromISO(`${year}-01-01`), lte: fromISO(`${year}-12-31`) } }, orderBy: { date: "asc" } }),
    getSettings(),
  ]);
  const tone = { NATIONAL: "brand", CUTI_BERSAMA: "leave", COMPANY: "offsite" } as const;
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
      <Card>
        <CardHeader
          title={`Holiday calendar ${year}`}
          description="Indonesian national holidays, cuti bersama and company holidays. Weekend holidays don't affect working days."
          action={
            <div className="flex items-center gap-2">
              {[year - 1, year + 1].map((y) => <Link key={y} href={`/settings/holidays?year=${y}`} className="text-[13px] font-medium text-brand-700 hover:underline">{y}</Link>)}
              <HolidayDialog />
            </div>
          }
        />
        <CardBody>
          {holidays.length === 0 ? <p className="text-sm text-muted">No holidays recorded for {year}. Add them manually or import a CSV.</p> : (
            <Table>
              <thead><tr><th>Date</th><th>Name</th><th>Type</th><th>Status</th><th /></tr></thead>
              <tbody>
                {holidays.map((h) => (
                  <tr key={h.id} className={cn(!h.isObserved && "opacity-60")}>
                    <td className="whitespace-nowrap">{formatDateLong(toISO(h.date))}</td>
                    <td className="font-medium text-ink">{h.name}<div className="text-[11px] text-subtle">{h.source}</div></td>
                    <td><Badge tone={tone[h.type]}>{h.type === "CUTI_BERSAMA" ? "Cuti bersama" : h.type.toLowerCase()}</Badge></td>
                    <td>{h.isObserved ? (h.type === "CUTI_BERSAMA" && !settings.cutiBersamaIsHoliday ? <span className="text-muted">working day (setting)</span> : "Office closed") : <span className="text-warning">Override: working day</span>}</td>
                    <td className="whitespace-nowrap text-right">
                      <HolidayDialog initial={{ id: h.id, date: toISO(h.date), name: h.name, type: h.type, isObserved: h.isObserved }} />
                      <DeleteHolidayButton id={h.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>
      <div className="space-y-5">
        <Notice tone="info" title="Cuti bersama">Currently treated as {settings.cutiBersamaIsHoliday ? "non-working days" : "working days"}. Change in Settings → System.</Notice>
        <Card>
          <CardHeader title="Import calendar (CSV)" description="Columns: date, name, type (NATIONAL | CUTI_BERSAMA | COMPANY). Duplicates are skipped." />
          <CardBody><HolidayImport /></CardBody>
        </Card>
        <Notice tone="warning">Seeded 2026 dates follow the SKB 3 Menteri as best known — verify against the official decree. 2027 contains fixed-date holidays only; import lunar-calendar dates when the decree is published.</Notice>
      </div>
    </div>
  );
}
