"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { correctAttendanceAction, verifyAttendanceAction } from "@/server/actions/work";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { Table } from "@/components/ui/misc";
import { formatDate } from "@/lib/dates";

export function VerifyQueue({ records }: { records: { id: string; name: string; date: string; mode: string; at: string }[] }) {
  const router = useRouter();
  const [sel, setSel] = useState<string[]>([]);
  const [pending, start] = useTransition();
  if (!records.length) return <p className="text-[13px] text-muted">No unverified check-ins in your scope.</p>;
  const act = (status: "VERIFIED" | "REJECTED") =>
    start(async () => {
      const r = await verifyAttendanceAction({ ids: sel, status });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`${r.data?.updated} record(s) ${status.toLowerCase()}`);
      setSel([]);
      router.refresh();
    });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => setSel(sel.length === records.length ? [] : records.map((r) => r.id))}>
          {sel.length === records.length ? "Clear selection" : `Select all (${records.length})`}
        </Button>
        <Button size="sm" disabled={!sel.length} loading={pending} onClick={() => act("VERIFIED")}>
          Verify {sel.length || ""}
        </Button>
        <Button size="sm" variant="danger-outline" disabled={!sel.length || pending} onClick={() => act("REJECTED")}>
          Reject
        </Button>
      </div>
      <div className="max-h-[360px] overflow-y-auto">
        <Table>
          <thead>
            <tr>
              <th className="w-8" />
              <th>Employee</th>
              <th>Date</th>
              <th>Mode</th>
              <th>Checked in</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" className="h-4 w-4 accent-brand-700" aria-label={`Select ${r.name} ${r.date}`} checked={sel.includes(r.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} />
                </td>
                <td className="font-medium text-ink">{r.name}</td>
                <td>{formatDate(r.date)}</td>
                <td>{r.mode}</td>
                <td className="text-muted">{r.at}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export function CorrectionForm({ employees }: { employees: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [f, setF] = useState({ employeeId: "", date: "", mode: "WFO", verification: "VERIFIED", reason: "" });
  const [pending, start] = useTransition();
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Employee" required>
        <Select value={f.employeeId} onChange={(e) => setF({ ...f, employeeId: e.target.value })}>
          <option value="">Choose…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>{e.fullName}</option>
          ))}
        </Select>
      </Field>
      <Field label="Date" required>
        <Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </Field>
      <Field label="Attendance">
        <Select value={f.mode} onChange={(e) => setF({ ...f, mode: e.target.value })}>
          <option value="WFO">WFO</option>
          <option value="WFH">WFH</option>
          <option value="OFFSITE">Offsite</option>
          <option value="NONE">Invalidate record</option>
        </Select>
      </Field>
      <Field label="Verification">
        <Select value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })}>
          <option value="VERIFIED">Verified</option>
          <option value="UNVERIFIED">Unverified</option>
          <option value="REJECTED">Rejected</option>
        </Select>
      </Field>
      <Field label="Reason" required className="sm:col-span-2" hint="Minimum 10 characters. Stored permanently.">
        <Textarea value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className="min-h-[64px]" />
      </Field>
      <div className="sm:col-span-2">
        <Button
          loading={pending}
          disabled={!f.employeeId || !f.date || f.reason.trim().length < 10}
          onClick={() =>
            start(async () => {
              const r = await correctAttendanceAction(f);
              if (!r.ok) return void toast.error(r.error);
              toast.success(r.message);
              setF({ ...f, reason: "" });
              router.refresh();
            })
          }
        >
          Save correction
        </Button>
      </div>
    </div>
  );
}
