import { SearchX, Compass, LoaderCircle } from "lucide-react";

export function NoResultsState({ query }: { query?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-line py-20 text-center">
      <SearchX className="h-9 w-9 text-text-muted" />
      <p className="font-display text-lg font-bold text-text-primary">No results found</p>
      <p className="max-w-sm text-sm text-text-muted">
        {query
          ? `Nothing matched "${query}". Try a different title, genre, or language.`
          : "Try adjusting your filters or search for something else."}
      </p>
    </div>
  );
}

export function EmptySearchState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border-line py-20 text-center">
      <Compass className="h-9 w-9 text-text-muted" />
      <p className="font-display text-lg font-bold text-text-primary">Start typing to explore</p>
      <p className="max-w-sm text-sm text-text-muted">
        Search across every anime, movie, and character in the catalog.
      </p>
    </div>
  );
}

export function LoadingState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-20 text-center">
      <LoaderCircle className="h-7 w-7 animate-spin text-green-bright" />
      <p className="text-sm text-text-muted">Loading results…</p>
    </div>
  );
}
