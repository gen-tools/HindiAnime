import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { Anime } from "@/types/anime";
import { AnimeCard } from "./AnimeCard";
import { AnimeRowControls } from "./AnimeRowControls";

export function AnimeRow({
  title,
  items,
  viewAllHref,
  ranked = false,
  className,
  containerClassName,
}: {
  title: string;
  items: Anime[];
  viewAllHref?: string;
  ranked?: boolean;
  className?: string;
  containerClassName?: string;
}) {
  if (items.length === 0) return null;
  const rowId = `anime-row-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <section className={className ?? "py-7 md:py-9"}>
      <div className={containerClassName ?? "container-page"}>
        {/* Section Header */}
        <div className="mb-4 flex items-end justify-between">
          <h2 className="font-display text-xl font-bold text-text-primary md:text-2xl">
            {title}
          </h2>

          <div className="flex items-center gap-3">
            {/* Header Arrow Controls (< >) */}
            <AnimeRowControls targetId={rowId} title={title} />

            {viewAllHref && (
              <Link
                href={viewAllHref}
                className="focus-ring flex items-center gap-0.5 text-sm font-medium text-text-secondary hover:text-green-light"
              >
                View all
                <ChevronRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>

        {/* Single Horizontal Row / Carousel */}
        <div className="group/row relative">
          <div
            id={rowId}
            className="no-scrollbar -mx-1 flex gap-4 overflow-x-auto scroll-smooth px-1 pb-2 pt-2"
          >
            {items.map((item, i) => (
              <AnimeCard
                key={item.id}
                item={item}
                rank={ranked ? i + 1 : undefined}
                className="w-[150px] shrink-0 sm:w-[168px] md:w-[180px]"
                imageSizes="(max-width: 639px) 150px, (max-width: 767px) 168px, 180px"
              />
            ))}
          </div>

        </div>
      </div>
    </section>
  );
}
