import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth/guard";
import { listPoliciesWithVersions } from "@/server/services/policy";
import { formatDate, todayJakarta, toISO, WEEKDAY_SHORT } from "@/lib/dates";
import { validatePolicyRules } from "@/lib/engine/working-days";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Notice, Table } from "@/components/ui/misc";
import { CancelVersionButton, LevelRow, NewLevelForm, NewPolicyForm, PolicyEditDialog, PolicyVersionDialog, RemovePolicyButton, RestorePolicyButton } from "../forms";

export default async function PoliciesPage() {
  await requirePagePermission("policy.manage");
  const today = todayJakarta();
  const [allPolicies, levels] = await Promise.all([listPoliciesWithVersions(), db.employeeLevel.findMany({ orderBy: { rank: "asc" } })]);
  const policies = allPolicies.filter((p) => p.isActive);
  const archived = allPolicies.filter((p) => !p.isActive);
  const days = (d: number[]) => (d.length ? d.map((x) => WEEKDAY_SHORT[x]).join(", ") : "none");
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        {policies.map((p) => {
          const current = p.versions.find((v) => toISO(v.effectiveFrom) <= today && (!v.effectiveTo || toISO(v.effectiveTo) >= today)) ?? p.versions[0];
          // Versions starting today or later stay editable (until a plan is submitted under them).
          const upcoming = p.versions.filter((v) => toISO(v.effectiveFrom) >= today);
          const check = current ? validatePolicyRules({ wfoPercent: current.wfoPercent, mandatoryWeekdays: current.mandatoryWeekdays, flexibleWeekdays: current.flexibleWeekdays }) : null;
          return (
            <Card key={p.id}>
              <CardHeader
                title={p.name}
                description={`Levels: ${p.levels.map((l) => l.name).join(", ") || "none"}`}
                action={
                  <div className="flex flex-wrap items-center gap-1">
                    <PolicyEditDialog policy={{ id: p.id, name: p.name, description: p.description }} />
                    <RemovePolicyButton policy={{ id: p.id, name: p.name }} usedBy={p.levels.map((l) => l.name)} />
                    {current && <PolicyVersionDialog policyId={p.id} policyName={p.name} current={current} defaultDate={today} />}
                  </div>
                }
              />
              <CardBody className="space-y-3">
                {current && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-[13px] sm:grid-cols-3">
                    <KV k="Min WFO" v={<b className="font-display text-[18px] text-brand-700">{current.wfoPercent}%</b>} />
                    <KV k="Max WFH" v={`${100 - current.wfoPercent}%`} />
                    <KV k="In effect since" v={formatDate(toISO(current.effectiveFrom))} />
                    <KV k="Mandatory" v={days(current.mandatoryWeekdays)} />
                    <KV k="Flexible" v={days(current.flexibleWeekdays)} />
                    <KV k="Period" v={current.evaluationPeriod.toLowerCase()} />
                    <KV k="Deadline" v={`day ${current.submissionDeadlineDay}`} />
                    <KV k="Leader approval" v={current.requiresLeaderApproval ? "required" : "auto"} />
                    <KV k="HR for exceptions" v={current.exceptionsRequireHr ? "yes" : "no"} />
                    <KV k="Leave in denominator" v={current.excludeLeaveFromDenominator ? "excluded" : "included"} />
                    <KV k="Offsite" v={current.offsiteCountsAsWfo ? "counts as WFO" : "neutral"} />
                    <KV k="Rounding" v={current.roundingMode.toLowerCase()} />
                  </div>
                )}
                {check?.warnings.map((w) => <Notice key={w} tone="warning">{w}</Notice>)}
                {upcoming
                  .slice()
                  .reverse()
                  .map((u) => (
                    <div key={u.id} className="rounded-xl border border-warning/30 bg-warning-soft/40 px-3 py-2.5 text-[13px]">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex flex-wrap items-center gap-2">
                          {toISO(u.effectiveFrom) === today ? <Badge tone="success">Active from today</Badge> : <Badge tone="pending">Scheduled</Badge>}
                          <b className="text-ink">From {formatDate(toISO(u.effectiveFrom))}</b>
                        </span>
                        <span className="flex items-center gap-1">
                          <PolicyVersionDialog policyId={p.id} policyName={p.name} current={u} defaultDate={toISO(u.effectiveFrom)} edit={{ id: u.id, version: u.version, changeNote: u.changeNote }} />
                          <CancelVersionButton id={u.id} version={u.version} fromLabel={formatDate(toISO(u.effectiveFrom))} />
                        </span>
                      </div>
                      <div className="mt-1 text-[12.5px] text-muted">
                        {u.wfoPercent}% WFO · mandatory {days(u.mandatoryWeekdays)} · deadline day {u.submissionDeadlineDay}
                        {u.changeNote && <> · “{u.changeNote}”</>}
                      </div>
                    </div>
                  ))}
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer font-medium text-brand-700">Change history ({p.versions.length})</summary>
                  <Table className="mt-2">
                    <thead><tr><th>WFO</th><th>Mandatory</th><th>Effective</th><th>Note</th></tr></thead>
                    <tbody>
                      {p.versions.map((v) => (
                        <tr key={v.id}>
                          <td>{v.wfoPercent}%</td>
                          <td>{days(v.mandatoryWeekdays)}</td>
                          <td className="whitespace-nowrap">{formatDate(toISO(v.effectiveFrom))} – {v.effectiveTo ? formatDate(toISO(v.effectiveTo)) : "open"}</td>
                          <td className="text-muted">{v.changeNote}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </details>
              </CardBody>
            </Card>
          );
        })}
      </div>
      <Card>
        <CardHeader title="Employee levels" description="Each level maps to a policy. Level ≠ permission role: approval rights come from the user's role and reporting lines." />
        <CardBody>
          {levels.map((l) => <LevelRow key={l.id} level={{ id: l.id, name: l.name, description: l.description, policyId: l.policyId }} policies={policies.map((p) => ({ id: p.id, name: p.name }))} />)}
          <NewLevelForm policies={policies.map((p) => ({ id: p.id, name: p.name }))} />
        </CardBody>
      </Card>
      {archived.length > 0 && (
        <Card>
          <CardHeader title="Archived policies" description="Hidden from selection; kept because past months were evaluated with them." />
          <CardBody className="space-y-2">
            {archived.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-line-2 px-3 py-2 text-[13px]">
                <span className="text-ink">{p.name} <span className="text-muted">· {p.versions.length} version(s)</span></span>
                <RestorePolicyButton id={p.id} />
              </div>
            ))}
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Create a policy" description="Starts with version 1; configure details with “New version”." />
        <CardBody><NewPolicyForm today={today} /></CardBody>
      </Card>
    </div>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11.5px] text-muted">{k}</div>
      <div className="text-ink">{v}</div>
    </div>
  );
}
