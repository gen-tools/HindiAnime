import type { Metadata } from "next";
import Link from "next/link";
import { genres } from "@/lib/mock/genres";
import { anime } from "@/lib/mock/anime";
import {
  getCatalogPosterItems,
  getHomepageData,
  getHomepagePosterCatalog,
} from "@/lib/api/client";
import { PosterArt } from "@/components/anime/PosterArt";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { Badge } from "@/components/ui/Badge";
import { posterPalette } from "@/lib/poster";
import {
  Layers,
  ArrowRight,
  Flame,
  Swords,
  Compass,
  Wand2,
  HeartHandshake,
  type LucideIcon,
} from "lucide-react";

export const metadata: Metadata = {
  title: "Anime Genres | Action, Adventure, Fantasy & More | HINDIANIME",
  description:
    "Discover anime across all genres including Action, Romance, Sci-Fi, Fantasy, Thriller, Comedy, and Isekai dubbed in Hindi and regional languages.",
};

const genreIcons: Record<string, LucideIcon> = {
  action: Swords,
  adventure: Compass,
  fantasy: Wand2,
  romance: HeartHandshake,
  comedy: Flame,
};

export default async function GenresDirectoryPage() {
  const homepageData = await getHomepageData();
  const browseItems = getCatalogPosterItems(
    anime,
    getHomepagePosterCatalog(homepageData)
  );
  const getAnimeByGenre = (slug: string) =>
    browseItems.filter((item) => item.genres.includes(slug));
  const actionAnime = getAnimeByGenre("action").slice(0, 6);
  const fantasyAnime = getAnimeByGenre("fantasy").slice(0, 6);

  return (
    <div className="container-page py-10 md:py-14">
      {/* Hero Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border-line bg-gradient-to-br from-surface via-surface-dark to-background p-6 sm:p-10">
        <div className="absolute right-0 top-0 -mr-16 -mt-16 h-64 w-64 rounded-full bg-green-primary/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-green-primary/30 bg-green-primary/10 px-3 py-1 text-xs font-semibold text-green-light">
            <Layers className="h-3.5 w-3.5" />
            <span>Complete Genre Directory</span>
          </div>
          <h1 className="font-display mt-4 text-3xl font-extrabold text-text-primary sm:text-5xl">
            Explore Anime by Genre
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-text-secondary sm:text-base">
            From adrenaline-fueled action battles and deep fantasy lore to tear-jerking romances
            and speculative sci-fi. Find exactly the mood you&rsquo;re looking for.
          </p>
        </div>
      </div>

      {/* Genre Grid Cards */}
      <section className="mt-12">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-2xl font-bold text-text-primary">
            All Genres
          </h2>
          <span className="text-xs text-text-muted">{genres.length} Categories</span>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {genres.map((g) => {
            const count = getAnimeByGenre(g.slug).length;
            const sampleAnime = getAnimeByGenre(g.slug).slice(0, 3);
            const { palette } = posterPalette(g.slug);
            const [base, , bright] = palette;
            const Icon = genreIcons[g.slug] || Layers;

            return (
              <Link
                key={g.slug}
                href={`/genre/${g.slug}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border-line p-5 transition-all duration-200 hover:-translate-y-1 hover:border-green-primary/60 hover:shadow-[0_8px_24px_-4px_rgba(0,0,0,0.6)]"
                style={{
                  background: `linear-gradient(145deg, ${base}33 0%, #0c120e 100%)`,
                }}
              >
                <div
                  className="absolute -right-8 -top-8 h-28 w-28 rounded-full opacity-15 blur-2xl transition-opacity group-hover:opacity-40"
                  style={{ background: bright }}
                  aria-hidden="true"
                />

                <div className="relative z-10">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border-line bg-surface/60 text-green-light">
                        <Icon className="h-4 w-4" />
                      </div>
                      <h3 className="font-display text-lg font-bold text-text-primary group-hover:text-green-light">
                        {g.label}
                      </h3>
                    </div>
                    <Badge tone="outline" className="text-xs">
                      {count} Titles
                    </Badge>
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-text-muted">
                    {g.description}
                  </p>
                </div>

                <div className="relative z-10 mt-5 border-t border-border-line/40 pt-3">
                  <div className="flex items-center gap-2">
                    {sampleAnime.map((item) => (
                      <div
                        key={item.id}
                        className="relative h-12 w-9 shrink-0 overflow-hidden rounded border border-border-line/60"
                      >
                        <PosterArt seed={item.poster} title={item.title} fillContainer showOverlay={false} showSprocket={false} />
                      </div>
                    ))}
                    <div className="ml-auto flex items-center gap-1 text-xs font-semibold text-green-light group-hover:translate-x-1 transition-transform">
                      Browse
                      <ArrowRight className="h-3.5 w-3.5" />
                    </div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Top Action Spotlight */}
      <section className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Swords className="h-5 w-5 text-green-bright" />
            <h2 className="font-display text-2xl font-bold text-text-primary">
              High-Stakes Action &amp; Battles
            </h2>
          </div>
          <Link
            href="/genre/action"
            className="flex items-center gap-1 text-xs font-semibold text-green-light hover:underline"
          >
            View all Action ({getAnimeByGenre("action").length})
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <AnimeGrid items={actionAnime} />
      </section>

      {/* Top Fantasy Spotlight */}
      <section className="mt-16">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wand2 className="h-5 w-5 text-green-bright" />
            <h2 className="font-display text-2xl font-bold text-text-primary">
              Magic, Worlds &amp; Fantasy
            </h2>
          </div>
          <Link
            href="/genre/fantasy"
            className="flex items-center gap-1 text-xs font-semibold text-green-light hover:underline"
          >
            View all Fantasy ({getAnimeByGenre("fantasy").length})
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <AnimeGrid items={fantasyAnime} />
      </section>
    </div>
  );
}
