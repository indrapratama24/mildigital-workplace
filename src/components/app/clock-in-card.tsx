"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Building2, Home, MapPin, CheckCircle2, CircleDashed } from "lucide-react";
import { clockInAction } from "@/server/actions/work";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export function ClockInCard({ isWorkday, dayLabel, planned, mandatory, record }: { isWorkday: boolean; dayLabel: string | null; planned: string | null; mandatory: boolean; record: { mode: string; at: string | null; verified: boolean } | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (mode: "WFO" | "WFH" | "OFFSITE") =>
    start(async () => {
      const r = await clockInAction({ mode });
      if (!r.ok) toast.error(r.error);
      else {
        toast.success(`Checked in (${mode}).`);
        router.refresh();
      }
    });
  return (
    <Card className="relative overflow-hidden">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand-50" aria-hidden />
      <CardHeader title="Today" description={isWorkday ? `Planned: ${planned ?? "not planned"}${mandatory ? " · mandatory office day" : ""}` : dayLabel ?? "Not a working day"} />
      <CardBody className="relative">
        {record ? (
          <div className="flex items-center gap-3 rounded-xl bg-canvas px-3 py-3">
            {record.verified ? <CheckCircle2 className="h-6 w-6 text-success" /> : <CircleDashed className="h-6 w-6 text-warning" />}
            <div>
              <div className="text-sm font-semibold text-ink">Checked in · {record.mode}</div>
              <div className="text-[12px] text-muted">
                {record.at} · {record.verified ? "verified" : "awaiting verification"}
              </div>
            </div>
          </div>
        ) : isWorkday ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted">Manual check-in. No location tracking — your leader or HR verifies office attendance.</p>
            <div className="flex flex-wrap gap-2">
              {planned === "OFFSITE" ? (
                <Button onClick={() => go("OFFSITE")} loading={pending}>
                  <MapPin className="h-4 w-4" /> Check in offsite
                </Button>
              ) : (
                <>
                  <Button onClick={() => go("WFO")} loading={pending} variant={planned === "WFH" ? "secondary" : "primary"}>
                    <Building2 className="h-4 w-4" /> Check in at office
                  </Button>
                  <Button onClick={() => go("WFH")} disabled={pending} variant={planned === "WFH" ? "primary" : "secondary"}>
                    <Home className="h-4 w-4" /> Working from home
                  </Button>
                </>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[13px] text-muted">Enjoy your day off.</p>
        )}
      </CardBody>
    </Card>
  );
}
