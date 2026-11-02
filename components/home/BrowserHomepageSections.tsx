"use client";

import { useEffect, useState } from "react";
import { AnimeHero } from "@/components/anime/AnimeHero";
import { DeferredHomeContinueWatching } from "@/components/home/DeferredHomeContinueWatching";
import { TrendingSection } from "@/components/home/TrendingSection";
import { PopularSection } from "@/components/home/PopularSection";
import { LatestSection } from "@/components/home/LatestSection";
import { AllAnimeSection } from "@/components/home/AllAnimeSection";
import { MovieSection } from "@/components/home/MovieSection";
import { FadeIn } from "@/components/ui/FadeIn";
import {
  mapHomepageFeedToData,
  parseHomepageSourceHtml,
  type HomepageData,
} from "@/lib/api/client";
import type { HomepageApiResponse } from "@/types/api";
import { ALLOWED_WORKER_HOSTS, DEFAULT_WORKER_BASE_URL } from "@/lib/api/worker-config";

const HOMEPAGE_SNAPSHOT_KEY = "hindi-anime-homepage-v1";
const HOMEPAGE_SNAPSHOT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

function hasHomepageActivity(data: HomepageData): boolean {
  return data.trendingItems.length > 0 || data.latestEpisodes.length > 0;
}

function readHomepageSnapshot(): HomepageData | null {
  try {
    const raw = localStorage.getItem(HOMEPAGE_SNAPSHOT_KEY);
    if (!raw) return null;

    const snapshot: unknown = JSON.parse(raw);
    if (!snapshot || typeof snapshot !== "object") return null;
    const savedAt = "savedAt" in snapshot ? snapshot.savedAt : undefined;
    const data = "data" in snapshot ? snapshot.data : undefined;
    const ageMs = typeof savedAt === "number" ? Date.now() - savedAt : Number.POSITIVE_INFINITY;
    if (
      typeof savedAt !== "number" ||
      ageMs < 0 ||
      ageMs > HOMEPAGE_SNAPSHOT_MAX_AGE_MS ||
      !data ||
      typeof data !== "object"
    ) return null;

    const candidate = data as Partial<HomepageData>;
    if (
      !Array.isArray(candidate.heroItems) ||
      !Array.isArray(candidate.trendingItems) ||
      !Array.isArray(candidate.popularItems) ||
      !Array.isArray(candidate.latestEpisodes) ||
      !Array.isArray(candidate.movieItems) ||
      !Array.isArray(candidate.seriesItems) ||
      !Array.isArray(candidate.upcomingItems)
    ) return null;

    return hasHomepageActivity(candidate as HomepageData) ? candidate as HomepageData : null;
  } catch {
    return null;
  }
}

function saveHomepageSnapshot(data: HomepageData): void {
  if (!hasHomepageActivity(data)) return;
  try {
    localStorage.setItem(
      HOMEPAGE_SNAPSHOT_KEY,
      JSON.stringify({ savedAt: Date.now(), data })
    );
  } catch {
    // Storage may be disabled or full; the network refresh still updates React state.
  }
}

function getWorkerHomepageUrl(): string {
  let workerOrigin = DEFAULT_WORKER_BASE_URL;
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_CF_PROXY_URL || DEFAULT_WORKER_BASE_URL);
    if (configured.protocol === "https:" && ALLOWED_WORKER_HOSTS.has(configured.hostname)) {
      workerOrigin = configured.origin;
    }
  } catch {
    // Use the allowlisted default Worker URL.
  }

  const url = new URL("/", workerOrigin);
  url.searchParams.set("url", "https://animesalt.cx/");
  return url.toString();
}

async function fetchWorkerHomepage(signal: AbortSignal): Promise<HomepageData> {
  let workerOrigin = DEFAULT_WORKER_BASE_URL;
  try {
    const configured = new URL(process.env.NEXT_PUBLIC_CF_PROXY_URL || DEFAULT_WORKER_BASE_URL);
    if (configured.protocol === "https:" && ALLOWED_WORKER_HOSTS.has(configured.hostname)) {
      workerOrigin = configured.origin;
    }
  } catch {
    // Use the allowlisted default Worker URL.
  }

  // 1. Try pre-parsed JSON snapshot endpoint on Worker (/data/homepage)
  try {
    const jsonUrl = `${workerOrigin}/data/homepage`;
    const res = await fetch(jsonUrl, { signal, cache: "default" });
    if (res.ok && (res.headers.get("content-type") || "").includes("application/json")) {
      const feed = await res.json();
      if (feed && feed.data?.results) {
        const mapped = mapHomepageFeedToData(feed as HomepageApiResponse);
        if (hasHomepageActivity(mapped)) {
          return mapped;
        }
      }
    }
  } catch (err) {
    // Re-throw AbortErrors so the outer caller's catch can handle them properly
    // instead of silently falling through to the HTML scrape path.
    if (err instanceof Error && (err.name === "AbortError" || signal.aborted)) throw err;
    // Fall back to scraping HTML
  }

  if (signal.aborted) throw new DOMException("unmounted", "AbortError");

  // 2. Fall back to scraping the Worker HTML proxy
  const proxyUrl = `${workerOrigin}/?url=https://animesalt.cx/`;
  const response = await fetch(proxyUrl, { signal, cache: "default" });
  if (!response.ok || !(response.headers.get("content-type") || "").toLowerCase().includes("text/html")) {
    throw new Error(`Homepage Worker returned ${response.status}`);
  }
  const html = await response.text();
  if (new TextEncoder().encode(html).byteLength > 1024 * 1024) {
    throw new Error("Homepage Worker response exceeded the size limit");
  }
  const feed = parseHomepageSourceHtml(html);
  if (!feed) throw new Error("Homepage Worker HTML had no recognized data sections");
  return mapHomepageFeedToData(feed);
}

export function BrowserHomepageSections({ initialData }: { initialData: HomepageData }) {
  // Lazy initializer: read localStorage on the very first client render so
  // returning visitors never see the skeleton — even when the ISR snapshot is stale.
  const [data, setData] = useState<HomepageData>(() => {
    if (hasHomepageActivity(initialData)) return initialData;
    const cached = readHomepageSnapshot();
    return cached ?? initialData;
  });
  const [isLoading, setIsLoading] = useState(() => {
    if (hasHomepageActivity(initialData)) return false;
    const cached = readHomepageSnapshot();
    return !cached || !hasHomepageActivity(cached);
  });

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    // Save a fresh server snapshot so it is available on the next visit.
    if (hasHomepageActivity(initialData)) {
      saveHomepageSnapshot(initialData);
    }

    const refreshHomepage = async (): Promise<HomepageData | null> => {
      // 1. Try /api/homepage first (server-cached or CDN response)
      try {
        const response = await fetch("/api/homepage", { signal: controller.signal, cache: "default" });
        if (response.ok) {
          const payload: unknown = await response.json();
          const parsed = payload && typeof payload === "object" && "data" in payload
            ? mapHomepageFeedToData(payload as HomepageApiResponse)
            : (payload as HomepageData);
          if (hasHomepageActivity(parsed)) {
            return parsed;
          }
        }
      } catch {
        // Fall through to direct worker fetch
      }

      if (controller.signal.aborted || !active) return null;

      // 2. Direct client-side fetch from the Cloudflare Worker (bypasses serverless datacenter WAF blocks)
      try {
        const workerData = await fetchWorkerHomepage(controller.signal);
        if (hasHomepageActivity(workerData)) {
          return workerData;
        }
      } catch (err) {
        if (!controller.signal.aborted && active) {
          console.warn("[Homepage] Direct worker fetch failed:", err);
        }
      }

      return null;
    };

    void refreshHomepage()
      .then((freshData) => {
        if (!active || !freshData) return;
        // A fallback hero/popular list is not proof that the live activity feed
        // loaded. Require real trending or fresh-drop rows before replacing the
        // server-rendered snapshot, and preserve either section if it is absent.
        const hasFreshActivity = Boolean(hasHomepageActivity(freshData));
        if (active && hasFreshActivity) {
          saveHomepageSnapshot(freshData);
          setData((current) => ({
            ...freshData,
            // The server snapshot may contain fallback hero picks. Once the
            // live feed is validated, use its hero lineup just like the other
            // refreshed homepage sections.
            heroItems: freshData.heroItems.length > 0 ? freshData.heroItems : current.heroItems,
            trendingItems: freshData.trendingItems.length > 0 ? freshData.trendingItems : current.trendingItems,
            latestEpisodes: freshData.latestEpisodes.length > 0 ? freshData.latestEpisodes : current.latestEpisodes,
          }));
        }
      })
      .catch((error: unknown) => {
        // Suppress expected AbortErrors from component unmount cleanup.
        // DOMException("unmounted", "AbortError") has .name === "AbortError".
        if (controller.signal.aborted) return;
        if (error instanceof Error && error.name === "AbortError") return;
        if (active) {
          console.warn("[Homepage] Refresh failed; retaining current data.", error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
      if (!controller.signal.aborted) {
        // Use a proper AbortError DOMException so that:
        // 1. Fetch correctly identifies it as an AbortError (error.name === "AbortError")
        // 2. Next.js / React DevTools do NOT surface it as a runtime error overlay
        controller.abort(new DOMException("unmounted", "AbortError"));
      }
    };
  }, [initialData]);

  const displayHeroItems = data.heroItems.length > 0
    ? data.heroItems
    : data.trendingItems.length > 0
      ? data.trendingItems.slice(0, 6)
      : data.popularItems.slice(0, 6);

  return (
    <>
      {displayHeroItems.length > 0 ? (
        <AnimeHero items={displayHeroItems} />
      ) : isLoading ? (
        <HeroSkeleton />
      ) : null}
      <DeferredHomeContinueWatching />
      {data.trendingItems.length > 0 ? (
        <FadeIn><TrendingSection items={data.trendingItems} /></FadeIn>
      ) : isLoading ? (
        <AnimeRowSkeleton title="Trending Now" />
      ) : null}
      {data.popularItems.length > 0 ? (
        <FadeIn><PopularSection items={data.popularItems} /></FadeIn>
      ) : isLoading ? (
        <AnimeRowSkeleton title="Popular Anime" />
      ) : null}
      <FadeIn><LatestSection episodes={data.latestEpisodes} /></FadeIn>
      <FadeIn><AllAnimeSection title="On Air & Upcoming" items={data.upcomingItems} viewAllHref="/schedule" /></FadeIn>
      <FadeIn><AllAnimeSection title="Series" items={data.seriesItems} viewAllHref="/series" /></FadeIn>
      <FadeIn><MovieSection items={data.movieItems} /></FadeIn>
    </>
  );
}

function HeroSkeleton() {
  return (
    <section
      role="status"
      aria-label="Loading featured anime"
      className="relative min-h-[480px] overflow-hidden border-b border-border-line bg-background sm:min-h-[520px] md:min-h-[560px] lg:min-h-[600px]"
    >
      <div className="absolute inset-0 animate-pulse bg-gradient-to-r from-surface via-surface-elevated to-surface" />
      <div className="container-page relative flex min-h-[480px] flex-col justify-end gap-4 pb-10 pt-16 sm:min-h-[520px] md:min-h-[560px] lg:min-h-[600px]">
        <div className="h-4 w-32 rounded bg-white/10" />
        <div className="h-10 max-w-xl rounded bg-white/10 sm:h-14" />
        <div className="h-4 max-w-md rounded bg-white/[0.07]" />
        <div className="h-10 w-36 rounded-lg bg-white/10" />
      </div>
      <span className="sr-only">Loading featured anime</span>
    </section>
  );
}

function AnimeRowSkeleton({ title }: { title: string }) {
  return (
    <section aria-hidden="true" className="py-7 md:py-9">
      <div className="container-page">
        <div className="mb-4 h-7 w-40 animate-pulse rounded bg-white/10" />
        <div className="no-scrollbar flex gap-4 overflow-hidden px-1 pb-2 pt-2">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={`${title}-${index}`} className="w-[150px] shrink-0 sm:w-[168px] md:w-[180px]">
              <div className="aspect-[2/3] animate-pulse rounded-xl border border-border-line bg-surface-card" />
              <div className="mt-3 h-4 animate-pulse rounded bg-white/10" />
              <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-white/[0.07]" />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading {title}</span>
    </section>
  );
}

