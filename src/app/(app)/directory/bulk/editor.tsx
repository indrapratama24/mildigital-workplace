"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkEditEmployeesAction } from "@/server/actions/bulk";
import { Input, Select } from "@/components/ui/field";
import { Avatar } from "@/components/ui/misc";
import { BulkToolbar, CellSelect, CellText, ColumnPicker, useBulkDraft, useColumns } from "@/components/app/bulk-grid";
import type { EmployeeBulkRow } from "@/server/services/bulk";

type Opt = { id: string; name: string };
type Row = EmployeeBulkRow & { leaveDays: number | null };

const STATUSES = [
  { value: "PERMANENT", label: "Permanent" },
  { value: "CONTRACT", label: "Contract" },
  { value: "PROBATION", label: "Probation" },
  { value: "INTERN", label: "Intern" },
];

const COLUMNS = [
  { key: "jobTitle", label: "Job title", width: 200 },
  { key: "teamId", label: "Team", width: 180 },
  { key: "departmentId", label: "Department", width: 180 },
  { key: "levelId", label: "Level", width: 170 },
  { key: "leaderId", label: "Leader", width: 180 },
  { key: "employmentStatus", label: "Employment", width: 140 },
  { key: "leaveDays", label: "Leave adjustment (days)", width: 150 },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];

export function EmployeeBulkEditor(props: {
  rows: EmployeeBulkRow[];
  today: string;
  teams: (Opt & { departmentId: string | null })[];
  departments: Opt[];
  levels: Opt[];
  people: Opt[];
  leaveTypes: (Opt & { code: string })[];
  canAdjustLeave: boolean;
}) {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>(() => props.rows.map((r) => ({ ...r, leaveDays: null })));
  const d = useBulkDraft(rows);
  const columns = COLUMNS.filter((c) => c.key !== "leaveDays" || props.canAdjustLeave);
  const [visible, setVisible] = useColumns("bulk:employees", columns.map((c) => c.key));
  const shown = columns.filter((c) => visible.includes(c.key));
  const [saving, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({
    effectiveFrom: props.today,
    reason: "",
    leaveTypeId: (props.leaveTypes.find((t) => t.code === "ANNUAL") ?? props.leaveTypes[0])?.id ?? "",
    leaveYear: Number(props.today.slice(0, 4)),
  });
  const patches = d.patches();
  const dated = patches.some((p) => "levelId" in p.patch || "leaderId" in p.patch);
  const needsReason = patches.some((p) => "levelId" in p.patch || p.patch.leaveDays);
  const hasLeave = patches.some((p) => p.patch.leaveDays);
  const opt = (list: Opt[]) => list.map((o) => ({ value: o.id, label: o.name }));

  const save = () =>
    start(async () => {
      const payload = patches.map(({ id, patch }) => ({ id, patch: { ...patch, leaveDays: patch.leaveDays === null || patch.leaveDays === undefined ? undefined : Number(patch.leaveDays) } }));
      const r = await bulkEditEmployeesAction({ rows: payload, options: opts });
      if (!r.ok) return void toast.error(r.error);
      const res = r.data!;
      const failed = new Set(res.failed.map((f) => f.id));
      setErrors(Object.fromEntries(res.failed.map((f) => [f.id, f.error])));
      // Saved rows take the new values as their baseline; failed rows keep their edits for another try.
      setRows((rs) => rs.map((row) => (failed.has(row.id) ? row : { ...row, ...(patches.find((p) => p.id === row.id)?.patch ?? {}), leaveDays: null }) as Row));
      d.keepOnly([...failed]);
      router.refresh();
      if (res.failed.length) toast.warning(`${res.updated} saved, ${res.failed.length} not saved — see the rows marked in red.`);
      else toast.success(`${res.updated} team member${res.updated === 1 ? "" : "s"} updated`);
    });

  const cell = (row: Row, key: ColKey) => {
    const changed = d.changed(row, key);
    const label = `${COLUMNS.find((c) => c.key === key)!.label} for ${row.name}`;
    switch (key) {
      case "jobTitle":
        return <CellText value={d.value(row, "jobTitle")} onChange={(v) => d.set(row.id, "jobTitle", v)} changed={changed} label={label} />;
      case "teamId":
        return (
          <CellSelect
            value={d.value(row, "teamId")}
            onChange={(v) => {
              d.set(row.id, "teamId", v);
              // the department follows the team
              const dep = props.teams.find((t) => t.id === v)?.departmentId;
              if (dep) d.set(row.id, "departmentId", dep);
            }}
            options={opt(props.teams)}
            changed={changed}
            label={label}
            empty="No team"
          />
        );
      case "departmentId":
        return <CellSelect value={d.value(row, "departmentId")} onChange={(v) => d.set(row.id, "departmentId", v)} options={opt(props.departments)} changed={changed} label={label} empty="No department" />;
      case "levelId":
        return <CellSelect value={d.value(row, "levelId")} onChange={(v) => v && d.set(row.id, "levelId", v)} options={opt(props.levels)} changed={changed} label={label} />;
      case "leaderId":
        return <CellSelect value={d.value(row, "leaderId")} onChange={(v) => d.set(row.id, "leaderId", v)} options={opt(props.people.filter((p) => p.id !== row.id))} changed={changed} label={label} empty="No leader" />;
      case "employmentStatus":
        return <CellSelect value={d.value(row, "employmentStatus")} onChange={(v) => v && d.set(row.id, "employmentStatus", v)} options={STATUSES} changed={changed} label={label} />;
      case "leaveDays":
        return <CellText type="number" step={0.5} value={d.value(row, "leaveDays")} onChange={(v) => d.set(row.id, "leaveDays", v === "" ? null : Number(v))} changed={changed} label={label} />;
    }
  };

  return (
    <>
      <BulkToolbar
        backHref="/directory"
        title={`Editing ${rows.length} team member${rows.length === 1 ? "" : "s"}`}
        changes={d.count}
        saving={saving}
        onSave={save}
        columns={<ColumnPicker columns={columns} visible={visible} onChange={setVisible} />}
      >
        {(dated || needsReason) && (
          <>
            {dated && (
              <label className="text-[12px] font-medium text-ink-2">
                Level & leader changes from
                <Input type="date" value={opts.effectiveFrom} onChange={(e) => setOpts({ ...opts, effectiveFrom: e.target.value })} className="mt-1 h-9 w-[170px]" />
              </label>
            )}
            {hasLeave && (
              <>
                <label className="text-[12px] font-medium text-ink-2">
                  Leave type
                  <Select value={opts.leaveTypeId} onChange={(e) => setOpts({ ...opts, leaveTypeId: e.target.value })} className="mt-1 h-9 w-[170px]">
                    {props.leaveTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </Select>
                </label>
                <label className="text-[12px] font-medium text-ink-2">
                  Year
                  <Input type="number" value={opts.leaveYear} onChange={(e) => setOpts({ ...opts, leaveYear: Number(e.target.value) })} className="mt-1 h-9 w-[90px]" />
                </label>
              </>
            )}
            {needsReason && (
              <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-2">
                Reason (level / leave changes)
                <Input value={opts.reason} onChange={(e) => setOpts({ ...opts, reason: e.target.value })} placeholder="e.g. 2026 promotion round" className="mt-1 h-9" />
              </label>
            )}
          </>
        )}
      </BulkToolbar>

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-canvas/70 text-left text-[12px] font-medium text-muted">
              <th className="sticky left-0 z-[1] min-w-[220px] border-b border-r border-line bg-canvas px-3 py-2">Team member</th>
              {shown.map((c) => (
                <th key={c.key} className="border-b border-r border-line px-3 py-2 last:border-r-0" style={{ minWidth: c.width }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="sticky left-0 z-[1] border-b border-r border-line bg-surface px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar name={row.name} photoId={row.photoId} className="h-7 w-7 text-[11px]" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-ink">{row.name}</span>
                      <span className="block truncate text-[11px] text-muted">{row.code}</span>
                    </span>
                  </div>
                  {errors[row.id] && <p className="mt-1 max-w-[260px] text-[11.5px] text-danger">{errors[row.id]}</p>}
                </td>
                {shown.map((c) => (
                  <td key={c.key} className="border-b border-r border-line p-1 last:border-r-0">{cell(row, c.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Changed cells are highlighted. Leave adjustment adds days to each person&apos;s balance (negative deducts, half days allowed). Every change is kept in the history and the audit log.
      </p>
    </>
  );
}
