export default function AnimeLoading() {
  return (
    <div aria-busy="true" aria-label="Loading anime details" role="status" className="pb-14">
      <div className="h-64 border-b border-border-line bg-surface sm:h-80 md:h-96" />
      <div className="container-page relative -mt-28 flex gap-6 sm:-mt-36 md:gap-8">
        <div className="hidden h-64 w-56 shrink-0 rounded-xl bg-surface-card md:block" />
        <div className="min-w-0 flex-1 space-y-4 pt-3">
          <div className="h-9 max-w-lg rounded bg-surface-card" />
          <div className="h-5 max-w-sm rounded bg-surface-card" />
          <div className="h-24 max-w-3xl rounded bg-surface-card" />
          <div className="h-11 w-40 rounded-lg bg-surface-card" />
        </div>
      </div>
      <span className="sr-only">Loading anime details</span>
    </div>
  );
}
