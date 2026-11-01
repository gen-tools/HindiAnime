export default function WatchLoading() {
  return (
    <div aria-busy="true" aria-label="Loading episode" role="status" className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 md:py-8 lg:max-w-6xl">
      <div className="mb-4 h-5 w-56 rounded bg-surface-card" />
      <div className="aspect-video w-full rounded-xl border border-border-line bg-surface-card" />
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:justify-between">
        <div className="space-y-3">
          <div className="h-7 w-72 max-w-full rounded bg-surface-card" />
          <div className="h-4 w-44 rounded bg-surface-card" />
          <div className="h-16 max-w-3xl rounded bg-surface-card" />
        </div>
        <div className="h-11 w-44 rounded-lg bg-surface-card" />
      </div>
      <span className="sr-only">Loading episode</span>
    </div>
  );
}
