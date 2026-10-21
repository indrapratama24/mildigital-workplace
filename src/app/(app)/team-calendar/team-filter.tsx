"use client";
import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/field";

export function TeamFilter({ teams, value, month }: { teams: { id: string; name: string }[]; value: string; month: string }) {
  const router = useRouter();
  return (
    <Select aria-label="Team" className="h-10 w-auto min-w-[200px] rounded-full" value={value} onChange={(e) => router.push(`/team-calendar?month=${month}${e.target.value ? `&team=${e.target.value}` : ""}`)}>
      <option value="">All teams in my scope</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </Select>
  );
}
