"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Banknote, PiggyBank } from "lucide-react";
import { setYearEndChoiceAction } from "@/server/actions/requests";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { cn } from "@/lib/cn";

export interface YearEndInfo {
  year: number;
  typeName: string;
  open: boolean;
  opensOn: string;
  closesOn: string;
  projectedRemaining: number;
  tradable: number;
  maxDays: number;
  carryUntilLabel: string;
  closesLabel: string;
  choice: { option: "CASH" | "CARRY"; days: number } | null;
}

/** Employee's year-end choice for leftover annual leave: withdraw as cash or save for next year. */
export function YearEndCard({ info }: { info: YearEndInfo }) {
  const router = useRouter();
  const [option, setOption] = useState<"CASH" | "CARRY">(info.choice?.option ?? "CARRY");
  const [days, setDays] = useState(info.choice?.days ?? info.tradable);
  const [pending, start] = useTransition();
  const save = () =>
    start(async () => {
      const r = await setYearEndChoiceAction({ option, days });
      if (!r.ok) return void toast.error(r.error);
      toast.success(r.message);
      router.refresh();
    });
  const opt = (key: "CASH" | "CARRY", Icon: typeof Banknote, title: string, body: string) => (
    <button
      type="button"
      onClick={() => setOption(key)}
      aria-pressed={option === key}
      className={cn("flex flex-1 items-start gap-3 rounded-2xl border p-4 text-left", option === key ? "border-brand-700 bg-brand-50" : "border-line bg-white hover:border-brand-300")}
    >
      <Icon className={cn("mt-0.5 h-5 w-5", option === key ? "text-brand-700" : "text-subtle")} />
      <span>
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-[12.5px] text-muted">{body}</span>
      </span>
    </button>
  );
  return (
    <Card className="mb-5 border-brand-200">
      <CardHeader
        title={`Year-end ${info.typeName.toLowerCase()} · ${info.year}`}
        description={`You're expected to have ${info.projectedRemaining} day(s) left on 31 Dec. Up to ${info.maxDays} can be traded — choose by ${info.closesLabel}. Leave not traded expires at year end.`}
      />
      <CardBody className="space-y-4">
        {info.tradable <= 0 ? (
          <p className="text-[13px] text-muted">No leftover days to trade.</p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row">
              {opt("CASH", Banknote, "Withdraw", "Paid out in cash with payroll.")}
              {opt("CARRY", PiggyBank, "Save for next year", `Use them by ${info.carryUntilLabel}; unused days expire then.`)}
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-[13px] font-medium text-ink-2">
                Days
                <Input type="number" step={0.5} min={0.5} max={info.tradable} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-28" />
              </label>
              <Button loading={pending} disabled={!info.open || days <= 0 || days > info.tradable} onClick={save}>
                {info.choice ? "Update choice" : "Save choice"}
              </Button>
              {info.choice && <span className="text-[12.5px] text-success">Saved: {info.choice.option === "CASH" ? "withdraw" : "save for next year"} · {info.choice.days} day(s)</span>}
            </div>
            <p className="text-[11.5px] text-muted">If you take more leave before 31 Dec, the traded days are reduced to what is actually left.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
