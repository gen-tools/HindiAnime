import Link from "next/link";
import { genres } from "@/lib/mock/genres";
import { posterPalette } from "@/lib/poster";

export function GenreSection() {
  return (
    <section className="py-8 md:py-10">
      <div className="container-page">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-text-primary md:text-2xl">
            Browse by Genre
          </h2>
          <Link
            href="/genre"
            className="text-xs font-semibold text-text-secondary hover:text-green-light"
          >
            All genres →
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map((genre) => {
            const { palette } = posterPalette(genre.slug);
            const [base, , bright] = palette;
            return (
              <Link
                key={genre.slug}
                href={`/genre/${genre.slug}`}
                className="focus-ring group relative overflow-hidden rounded-xl border border-border-line p-4 transition-colors hover:border-green-primary/60"
                style={{
                  background: `linear-gradient(135deg, ${base} 0%, #0a100d 75%)`,
                }}
              >
                <div
                  className="absolute -right-6 -top-6 h-24 w-24 rounded-full opacity-20 blur-2xl transition-opacity group-hover:opacity-40"
                  style={{ background: bright }}
                  aria-hidden="true"
                />
                <h3 className="relative font-display text-base font-bold text-text-primary group-hover:text-green-light">
                  {genre.label}
                </h3>
                <p className="relative mt-1 text-xs leading-snug text-text-muted">{genre.description}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
