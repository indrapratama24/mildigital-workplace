"use client";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";
import { setDirectoryVisibilityAction } from "@/server/actions/people";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { Table } from "@/components/ui/misc";

type Audience = "EVERYONE" | "SAME_TEAM" | "LEADERS" | "HR";
const RANK: Record<Audience, number> = { HR: 1, LEADERS: 2, SAME_TEAM: 3, EVERYONE: 4 };

export function VisibilityForm({ fields, audiences }: { fields: { key: string; label: string; group: string; max: Audience; value: Audience }[]; audiences: Record<Audience, string> }) {
  const router = useRouter();
  const [values, setValues] = useState(Object.fromEntries(fields.map((f) => [f.key, f.value])) as Record<string, Audience>);
  const [pending, start] = useTransition();
  const dirty = fields.some((f) => values[f.key] !== f.value);
  const groups = [...new Set(fields.map((f) => f.group))];
  return (
    <div className="space-y-4">
      <Table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Visible to</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Fragment key={g}>
              <tr>
                <td colSpan={2} className="bg-canvas/60 !py-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g}</td>
              </tr>
              {fields
                .filter((f) => f.group === g)
                .map((f) => {
                  const locked = f.max === "HR";
                  return (
                    <tr key={f.key}>
                      <td className="font-medium text-ink">{f.label}</td>
                      <td>
                        {locked ? (
                          <span className="inline-flex items-center gap-1.5 text-[13px] text-muted">
                            <Lock className="h-3.5 w-3.5" /> HR only (locked)
                          </span>
                        ) : (
                          <Select value={values[f.key]} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value as Audience }))} className="h-9 w-auto min-w-[240px]">
                            {(Object.keys(audiences) as Audience[])
                              .filter((a) => RANK[a] <= RANK[f.max])
                              .sort((a, b) => RANK[b] - RANK[a])
                              .map((a) => <option key={a} value={a}>{audiences[a]}</option>)}
                          </Select>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </Fragment>
          ))}
        </tbody>
      </Table>
      <Button
        disabled={!dirty}
        loading={pending}
        onClick={() =>
          start(async () => {
            const r = await setDirectoryVisibilityAction(values);
            if (!r.ok) return void toast.error(r.error);
            toast.success(r.message);
            router.refresh();
          })
        }
      >
        Save visibility
      </Button>
    </div>
  );
}
