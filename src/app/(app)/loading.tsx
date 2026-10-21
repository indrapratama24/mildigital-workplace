export default function Loading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 rounded-xl bg-line-2" />
      <div className="h-4 w-96 max-w-full rounded-xl bg-line-2" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="h-40 rounded-2xl bg-line-2" />
        <div className="h-40 rounded-2xl bg-line-2 lg:col-span-2" />
      </div>
      <div className="h-72 rounded-2xl bg-line-2" />
    </div>
  );
}
