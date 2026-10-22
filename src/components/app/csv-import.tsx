"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, TriangleAlert } from "lucide-react";
/** Result shape shared by the client and team imports. */
export interface CsvImportResult {
  rows: { line: number; name: string; clientCode?: string | null; code?: string; action: "create" | "update"; errors: string[]; warnings: string[] }[];
  created: number;
  updated: number;
  failed: number;
  dryRun: boolean;
}
type Run = (text: string, dryRun: boolean) => Promise<{ ok: boolean; error?: string; data?: unknown }>;
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/field";
import { Notice, Table } from "@/components/ui/misc";
import { Badge } from "@/components/ui/badge";

/** Upload/paste → check every row → import. `run` is the server action for the specific import. */
export function CsvImportForm({ run: runImport, doneHref, doneLabel }: { run: Run; doneHref: string; doneLabel: string }) {
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [pending, start] = useTransition();
  const run = (dryRun: boolean) =>
    start(async () => {
      const r = await runImport(text, dryRun);
      if (!r.ok) return void toast.error(r.error);
      const data = r.data as CsvImportResult;
      setResult(data);
      if (!data.dryRun) toast.success(`Imported: ${data.created} created, ${data.updated} updated${data.failed ? `, ${data.failed} failed` : ""}.`);
    });
  const errors = result?.rows.filter((r) => r.errors.length).length ?? 0;
  const validated = result?.dryRun && errors === 0;
  return (
    <Card>
      <CardHeader title="1. Upload or paste CSV" />
      <CardBody className="space-y-4">
        <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-4 py-4 hover:border-brand-300">
          <FileUp className="h-5 w-5 text-brand-600" />
          <span className="text-[13.5px] text-ink-2">{fileName ?? "Choose a .csv file (UTF-8)"}</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              if (f.size > 4_000_000) return void toast.error("The file is too large (max 4 MB).");
              setFileName(f.name);
              setText(await f.text());
              setResult(null);
            }}
          />
        </label>
        <Textarea value={text} onChange={(e) => { setText(e.target.value); setResult(null); }} className="min-h-[140px] font-mono text-[12px]" placeholder="…or paste CSV here" />
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={pending} disabled={!text.trim()} onClick={() => run(true)}>2. Check rows</Button>
          <Button loading={pending} disabled={!validated} onClick={() => run(false)}>3. Import {result?.rows.length ?? ""} rows</Button>
        </div>
        {result && (
          <>
            {result.dryRun ? (
              errors ? <Notice tone="danger">{errors} row(s) need fixing. Nothing was saved.</Notice> : <Notice tone="success">All {result.rows.length} rows are valid — ready to import.</Notice>
            ) : (
              <Notice tone={result.failed ? "warning" : "success"}>
                Done: {result.created} created, {result.updated} updated{result.failed ? `, ${result.failed} failed (see below)` : ""}. <Link href={doneHref} className="font-medium underline">{doneLabel}</Link>
              </Notice>
            )}
            <Table className="min-w-[640px]">
              <thead><tr><th>Line</th><th>Name</th><th>Action</th><th>Result</th></tr></thead>
              <tbody>
                {result.rows.map((r) => (
                  <tr key={r.line}>
                    <td className="tabular">{r.line}</td>
                    <td><span className="font-medium text-ink">{r.name || "—"}</span>{(r.clientCode ?? r.code) && <span className="ml-1 font-mono text-[11.5px] text-muted">{r.clientCode ?? r.code}</span>}</td>
                    <td><Badge tone={r.action === "create" ? "brand" : "neutral"}>{r.action === "create" ? "New" : "Update"}</Badge></td>
                    <td className="text-[12.5px]">
                      {r.errors.map((e) => <div key={e} className="flex gap-1 text-danger"><TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {e}</div>)}
                      {r.warnings.map((w) => <div key={w} className="text-warning">{w}</div>)}
                      {!r.errors.length && !r.warnings.length && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-3.5 w-3.5" /> OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </CardBody>
    </Card>
  );
}
