import type { Metadata } from "next";
import Link from "next/link";
import { RatingBadge } from "@/components/ui/RatingBadge";
import { LanguageBadges } from "@/components/anime/LanguageBadges";
import { PosterArt } from "@/components/anime/PosterArt";
import { Badge } from "@/components/ui/Badge";
import { getPopularAnime, getTrendingAnime } from "@/lib/mock/anime";
import { getHomepageData } from "@/lib/api/client";

export const metadata: Metadata = {
  title: "Popular Anime",
  description: "The most watched and top-rated anime on HindiAnime right now.",
};

export default async function PopularPage() {
  const { popularItems, trendingItems } = await getHomepageData();

  const popular = popularItems.length > 0 ? popularItems : getPopularAnime();
  const trending = trendingItems.length > 0 ? trendingItems : getTrendingAnime();
  const topRated = [...popular].sort((a, b) => b.rating - a.rating);

  return (
    <div className="container-page py-10">
      <h1 className="font-display text-3xl font-extrabold text-text-primary">Popular</h1>
      <p className="mt-1 text-sm text-text-muted">Most watched, trending, and top rated this week.</p>

      <section className="mt-10">
        <h2 className="mb-5 font-display text-xl font-bold text-text-primary">Most Watched</h2>
        <div className="flex flex-col divide-y divide-border-line rounded-xl border border-border-line bg-surface">
          {popular.map((item, i) => (
            <Link
              key={item.id}
              href={`/anime/${item.slug}`}
              className="focus-ring group flex items-center gap-4 p-3 transition-colors hover:bg-white/[0.03] sm:p-4"
            >
              <span className="font-eyebrow w-10 shrink-0 text-center text-3xl text-green-bright sm:text-4xl">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div className="w-14 shrink-0 sm:w-16">
                <PosterArt seed={item.poster} title={item.title} className="rounded-md" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-text-primary group-hover:text-green-light">
                  {item.title}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <RatingBadge rating={item.rating} />
                  <span>{item.year}</span>
                  <Badge tone="outline">{item.type}</Badge>
                </div>
                <LanguageBadges languages={item.languages} max={4} className="mt-1.5" />
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-5 font-display text-xl font-bold text-text-primary">Trending Now</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 sm:grid-cols-3 md:grid-cols-5">
          {trending.map((item, i) => (
            <Link key={item.id} href={`/anime/${item.slug}`} className="focus-ring group relative block">
              <div className="relative overflow-hidden rounded-xl border border-border-line group-hover:border-green-primary/70">
                <PosterArt seed={item.poster} title={item.title} />
              </div>
              <span className="font-eyebrow pointer-events-none absolute -left-1 -top-2 z-10 text-[48px] leading-none text-black [-webkit-text-stroke:1.5px_#22c55e] opacity-90 sm:text-[56px]">
                {String(i + 1).padStart(2, "0")}
              </span>
              <p className="mt-2 truncate text-sm font-semibold text-text-primary group-hover:text-green-light">
                {item.title}
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="mt-12">
        <h2 className="mb-5 font-display text-xl font-bold text-text-primary">Top Rated</h2>
        <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 md:grid-cols-5">
          {topRated.map((item) => (
            <Link key={item.id} href={`/anime/${item.slug}`} className="focus-ring group block">
              <div className="relative overflow-hidden rounded-xl border border-border-line group-hover:border-green-primary/70">
                <PosterArt seed={item.poster} title={item.title} />
                <RatingBadge rating={item.rating} className="absolute right-2 top-2" />
              </div>
              <p className="mt-2 truncate text-sm font-semibold text-text-primary group-hover:text-green-light">
                {item.title}
              </p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
