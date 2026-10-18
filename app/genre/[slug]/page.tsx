import { Suspense } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { genres, getGenre } from "@/lib/mock/genres";
import { createCanonicalMetadata } from "@/lib/seo";
import { GenreBrowseClient } from "@/components/genre/GenreBrowseClient";
import { AnimeGrid } from "@/components/anime/AnimeGrid";
import { catalogIndex } from "@/lib/catalog-index";
import { posterPalette } from "@/lib/poster";
import { Layers, Sparkles } from "lucide-react";

export function generateStaticParams() {
  return genres.map((genre) => ({ slug: genre.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const genre = getGenre(slug);
  if (!genre) return {};
  return createCanonicalMetadata(`/genre/${slug}`, {
    title: `${genre.label} Anime`,
    description: `Explore ${genre.label.toLowerCase()} anime series and movies on Hindi Anime — ${genre.description.toLowerCase()}.`,
  });
}

export default async function GenrePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const genre = getGenre(slug);
  if (!genre) notFound();
  const items = catalogIndex.filter((item) => item.genres.includes(slug));
  const { palette } = posterPalette(slug);
  const [base, , bright] = palette;

  return (
    <div className="container-page py-10">
      <div className="no-scrollbar mb-8 flex items-center gap-2 overflow-x-auto pb-2">
        <Link href="/genre" className="flex items-center gap-1.5 rounded-full border border-border-line bg-surface px-4 py-1.5 text-xs font-semibold text-text-secondary hover:border-green-primary/60 hover:text-white">
          <Layers className="h-3.5 w-3.5" /> All Genres
        </Link>
        {genres.map((item) => (
          <Link
            key={item.slug}
            href={`/genre/${item.slug}`}
            className={`whitespace-nowrap rounded-full px-4 py-1.5 text-xs font-semibold transition-all ${item.slug === slug ? "border border-green-bright bg-green-primary/20 text-green-light shadow-[0_0_12px_-2px_rgba(34,197,94,0.5)]" : "border border-border-line bg-surface text-text-secondary hover:border-green-primary/60 hover:text-white"}`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-border-line p-6 sm:p-8" style={{ background: `linear-gradient(135deg, ${base}44 0%, #080d0a 75%)` }}>
        <div className="absolute -right-12 -top-12 h-48 w-48 rounded-full opacity-20 blur-3xl" style={{ background: bright }} aria-hidden="true" />
        <div className="relative z-10">
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-green-light">
            <Sparkles className="h-3.5 w-3.5" /><span>GENRE SHOWCASE</span>
          </div>
          <h1 className="font-display mt-1 text-3xl font-extrabold text-text-primary md:text-4xl">{genre.label} Anime</h1>
          <p className="mt-2 max-w-xl text-sm text-text-secondary">{genre.description}. {items.length} titles available.</p>
        </div>
      </div>

      <Suspense fallback={<div className="mt-8"><div className="h-11" /><div className="mt-8"><AnimeGrid items={items.slice(0, 12)} /></div></div>}>
        <GenreBrowseClient slug={slug} />
      </Suspense>
    </div>
  );
}
