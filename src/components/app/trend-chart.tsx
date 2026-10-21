// Single-series bar chart: verified WFO % per month, with the month's minimum as a tick.
// Planned % is shown as text below each bar; every bar has a tooltip and the data is also in the table view.
export function TrendChart({ data }: { data: { label: string; planned: number | null; actual: number | null; minimum: number | null }[] }) {
  return (
    <figure>
      <div className="flex h-40 items-end gap-3 border-b border-line px-1" role="img" aria-label="Verified WFO percentage by month">
        {data.map((d) => {
          const h = d.actual ?? 0;
          return (
            <div key={d.label} className="group relative flex h-full flex-1 flex-col items-center justify-end">
              <div className="pointer-events-none absolute -top-1 z-10 hidden -translate-y-full whitespace-nowrap rounded-lg border border-line bg-white px-2.5 py-1.5 text-[11.5px] text-ink shadow-pop group-hover:block">
                <b>{d.label}</b> · verified {d.actual ?? "—"}% · planned {d.planned ?? "—"}% · minimum {d.minimum ?? "—"}%
              </div>
              {d.minimum !== null && <div className="absolute left-1 right-1 h-0.5 rounded bg-ink/50" style={{ bottom: `${Math.min(100, d.minimum)}%` }} aria-hidden />}
              <div className="w-full max-w-[36px] rounded-t-[4px] bg-brand-700 transition-opacity group-hover:opacity-80" style={{ height: `${Math.max(h, d.actual === null ? 0 : 1.5)}%` }} />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-3 px-1">
        {data.map((d) => (
          <div key={d.label} className="flex-1 text-center">
            <div className="text-[11.5px] font-medium text-ink-2">{d.label}</div>
            <div className="text-[11px] text-muted tabular">{d.actual !== null ? `${d.actual}%` : "—"}</div>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 text-[11.5px] text-muted">Bars: verified WFO % · line: minimum required % for that month.</figcaption>
    </figure>
  );
}
