"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { bulkEditClientsAction } from "@/server/actions/bulk";
import { Input } from "@/components/ui/field";
import { BulkToolbar, CellMulti, CellSelect, CellText, ColumnPicker, useBulkDraft, useColumns } from "@/components/app/bulk-grid";
import { MAX_ADS_STRATEGISTS } from "@/lib/engine/clients";
import type { ClientBulkRow } from "@/server/services/bulk";

type Opt = { id: string; name: string };

const STATUSES = [
  { value: "ACTIVE", label: "Active" },
  { value: "FREEZE", label: "Freeze" },
  { value: "INACTIVE", label: "Inactive" },
];

const COLUMNS = [
  { key: "name", label: "Brand name", width: 190 },
  { key: "status", label: "Status", width: 120 },
  { key: "packageId", label: "Package", width: 140 },
  { key: "categoryId", label: "Category", width: 170 },
  { key: "industryName", label: "Industry", width: 170 },
  { key: "subIndustryName", label: "Sub-industry", width: 170 },
  { key: "adAccounts", label: "Ad accounts", width: 220 },
  { key: "consultant1", label: "Consultant", width: 180 },
  { key: "consultant2", label: "Consultant 2", width: 180 },
  { key: "adsStrategists", label: "Ads Strategists", width: 220 },
  { key: "websiteUrl", label: "Website", width: 200 },
  { key: "picName", label: "PIC name", width: 160 },
  { key: "picPhone", label: "PIC phone", width: 150 },
  { key: "picEmail", label: "PIC email", width: 200 },
] as const;
type ColKey = (typeof COLUMNS)[number]["key"];
const DEFAULT_COLUMNS: ColKey[] = ["status", "packageId", "categoryId", "industryName", "adAccounts", "consultant1", "consultant2", "adsStrategists"];
const SENSITIVE: ColKey[] = ["picName", "picPhone", "picEmail"];

export function ClientBulkEditor(props: {
  rows: ClientBulkRow[];
  today: string;
  packages: Opt[];
  categories: Opt[];
  industries: { name: string; categoryId: string | null; subIndustries: string[] }[];
  adAccounts: string[];
  people: Opt[];
}) {
  const router = useRouter();
  const [rows, setRows] = useState(props.rows);
  const d = useBulkDraft(rows);
  const [visible, setVisible] = useColumns("bulk:clients", DEFAULT_COLUMNS);
  const shown = COLUMNS.filter((c) => visible.includes(c.key));
  const [saving, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [opts, setOpts] = useState({ effectiveFrom: props.today, statusReason: "" });
  const patches = d.patches();
  const dated = patches.some((p) => ["consultant1", "consultant2", "adsStrategists", "status"].some((k) => k in p.patch));
  const statusChange = patches.some((p) => "status" in p.patch);
  const opt = (list: Opt[]) => list.map((o) => ({ value: o.id, label: o.name }));
  const people = opt(props.people);

  const save = () =>
    start(async () => {
      const payload = patches.map(({ id, patch }) => ({
        id,
        patch: Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === "string" ? v.trim() || (k === "name" ? v : null) : v])),
      }));
      const r = await bulkEditClientsAction({ rows: payload, options: opts });
      if (!r.ok) return void toast.error(r.error);
      const res = r.data!;
      const failed = new Set(res.failed.map((f) => f.id));
      setErrors(Object.fromEntries(res.failed.map((f) => [f.id, f.error])));
      setRows((rs) => rs.map((row) => (failed.has(row.id) ? row : ({ ...row, ...(patches.find((p) => p.id === row.id)?.patch ?? {}) } as ClientBulkRow))));
      d.keepOnly([...failed]);
      router.refresh();
      if (res.failed.length) toast.warning(`${res.updated} saved, ${res.failed.length} not saved — see the rows marked in red.`);
      else toast.success(`${res.updated} client${res.updated === 1 ? "" : "s"} updated`);
    });

  const cell = (row: ClientBulkRow, key: ColKey) => {
    const changed = d.changed(row, key);
    const label = `${COLUMNS.find((c) => c.key === key)!.label} for ${row.name}`;
    const text = (k: "name" | "industryName" | "subIndustryName" | "websiteUrl" | "picName" | "picPhone" | "picEmail", list?: string) => (
      <CellText value={d.value(row, k)} onChange={(v) => d.set(row.id, k, v)} changed={d.changed(row, k)} label={label} list={list} disabled={SENSITIVE.includes(k) && !row.sensitiveVisible} />
    );
    switch (key) {
      case "name":
        return text("name");
      case "status":
        return <CellSelect value={d.value(row, "status")} onChange={(v) => v && d.set(row.id, "status", v)} options={STATUSES} changed={changed} label={label} />;
      case "packageId":
        return <CellSelect value={d.value(row, "packageId")} onChange={(v) => v && d.set(row.id, "packageId", v)} options={opt(props.packages)} changed={changed} label={label} />;
      case "categoryId":
        return <CellSelect value={d.value(row, "categoryId")} onChange={(v) => d.set(row.id, "categoryId", v)} options={opt(props.categories)} changed={changed} label={label} empty="—" />;
      case "industryName":
        return text("industryName", `ind-${d.value(row, "categoryId") ?? "all"}`);
      case "subIndustryName":
        return text("subIndustryName", `sub-${(d.value(row, "industryName") ?? "").toLowerCase()}`);
      case "adAccounts":
        return (
          <CellMulti
            value={d.value(row, "adAccounts")}
            onChange={(v) => d.set(row.id, "adAccounts", v)}
            options={[...new Set([...props.adAccounts, ...row.adAccounts])].map((a) => ({ value: a, label: a }))}
            changed={changed}
            label={label}
          />
        );
      case "consultant1":
      case "consultant2":
        return <CellSelect value={d.value(row, key)} onChange={(v) => d.set(row.id, key, v)} options={people} changed={changed} label={label} empty="—" />;
      case "adsStrategists":
        return <CellMulti value={d.value(row, "adsStrategists")} onChange={(v) => d.set(row.id, "adsStrategists", v)} options={people} changed={changed} label={label} max={MAX_ADS_STRATEGISTS} />;
      default:
        return text(key);
    }
  };

  return (
    <>
      <BulkToolbar
        backHref="/clients"
        title={`Editing ${rows.length} client${rows.length === 1 ? "" : "s"}`}
        changes={d.count}
        saving={saving}
        onSave={save}
        columns={<ColumnPicker columns={[...COLUMNS]} visible={visible} onChange={setVisible} />}
      >
        {dated && (
          <>
            <label className="text-[12px] font-medium text-ink-2">
              Team & status changes from
              <Input type="date" max={props.today} value={opts.effectiveFrom} onChange={(e) => setOpts({ ...opts, effectiveFrom: e.target.value })} className="mt-1 h-9 w-[170px]" />
            </label>
            {statusChange && (
              <label className="min-w-[220px] flex-1 text-[12px] font-medium text-ink-2">
                Status change reason (optional)
                <Input value={opts.statusReason} onChange={(e) => setOpts({ ...opts, statusReason: e.target.value })} className="mt-1 h-9" />
              </label>
            )}
          </>
        )}
      </BulkToolbar>

      {/* Suggestions for industry / sub-industry cells */}
      {["all", ...props.categories.map((c) => c.id)].map((cat) => (
        <datalist key={cat} id={`ind-${cat}`}>
          {props.industries.filter((i) => cat === "all" || i.categoryId === cat).map((i) => <option key={i.name} value={i.name} />)}
        </datalist>
      ))}
      {props.industries.map((i) => (
        <datalist key={i.name} id={`sub-${i.name.toLowerCase()}`}>
          {i.subIndustries.map((s) => <option key={s} value={s} />)}
        </datalist>
      ))}

      <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-canvas/70 text-left text-[12px] font-medium text-muted">
              <th className="sticky left-0 z-[1] min-w-[200px] border-b border-r border-line bg-canvas px-3 py-2">Client</th>
              {shown.map((c) => (
                <th key={c.key} className="border-b border-r border-line px-3 py-2 last:border-r-0" style={{ minWidth: c.width }}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="sticky left-0 z-[1] border-b border-r border-line bg-surface px-3 py-1.5">
                  <span className="block truncate font-medium text-ink">{d.value(row, "name")}</span>
                  <span className="block font-mono text-[11px] text-muted">{row.code}</span>
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
        Changed cells are highlighted. Team changes and status changes are dated with the date above and kept in each client&apos;s history; Ads Strategists keep the ad accounts they handled. PIC fields are only editable where you can see them.
      </p>
    </>
  );
}
