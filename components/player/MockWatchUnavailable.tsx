import Link from "next/link";
import type { Anime } from "@/types/anime";
import { PosterArt } from "@/components/anime/PosterArt";

export function MockWatchUnavailable({ anime }: { anime: Anime }) {
  return (
    <div className="container-page flex min-h-[60vh] items-center justify-center py-12">
      <div className="w-full max-w-md rounded-2xl border border-border-line bg-surface p-6 text-center">
        <div className="mx-auto mb-5 h-40 w-28 overflow-hidden rounded-lg">
          <PosterArt seed={anime.poster} title={anime.title} className="h-full w-full" />
        </div>
        <h1 className="font-display text-xl font-bold text-text-primary">{anime.title}</h1>
        <p className="mt-2 text-sm text-text-secondary">
          This placeholder listing does not have a playable stream.
        </p>
        <Link
          href={`/anime/${anime.slug}`}
          className="mt-5 inline-flex rounded-lg border border-border-line px-4 py-2 text-sm font-semibold text-text-primary transition-colors hover:border-green-primary/60 hover:text-green-light"
        >
          Back to details
        </Link>
      </div>
    </div>
  );
}
