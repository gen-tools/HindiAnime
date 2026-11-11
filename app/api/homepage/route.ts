import { NextResponse } from "next/server";
import { getHomepageData, mapHomepageFeedToData } from "@/lib/api/client";
import { WORKER_LEGACY_HOST } from "@/lib/api/worker-config";
import type { HomepageApiResponse } from "@/types/api";

export const runtime = "nodejs";
const HOMEPAGE_CDN_SECONDS = 900;
// The live feed is shared across visitors and is cached at Vercel's CDN. Keep
// the route itself dynamic so refreshing this JSON does not create durable ISR
// output writes; getHomepageData still uses the validated 15-minute data cache.
export const dynamic = "force-dynamic";

function homepageCacheHeaders(edgeTtlSeconds: number) {
  const sharedCacheControl = "public, max-age=0, stale-while-revalidate=300";
  return {
    // Visitors should revalidate in their browser; shared edges may reuse this
    // public feed for a short, explicit interval. Empty fallbacks use the
    // shorter TTL passed by GET so an upstream hiccup is not cached as data.
    "Cache-Control": sharedCacheControl,
    "Vercel-CDN-Cache-Control": `public, s-maxage=${edgeTtlSeconds}, stale-while-revalidate=300`,
    "Cloudflare-CDN-Cache-Control": `public, max-age=${edgeTtlSeconds}, stale-while-revalidate=300`,
  };
}

export async function GET() {
  // This endpoint is already shared-cached at the CDN. Resolve a fresh parsed
  // AnimeSalt feed on each cache refresh instead of reusing a failed scraper
  // result/cooldown from the server data cache.
  let data = await getHomepageData();

  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`https://${WORKER_LEGACY_HOST}/data/homepage`, {
        headers: { Accept: "application/json" },
        cache: "no-store",
        signal: controller.signal,
      });
      if (res.ok) {
        const feed = (await res.json()) as HomepageApiResponse;
        if (feed && feed.data?.results) {
          const directData = mapHomepageFeedToData(feed);
          if (directData.trendingItems.length > 0 || directData.latestEpisodes.length > 0) {
            data = directData;
          }
        }
      }
    } catch {
      // Fall through to empty fallback response
    } finally {
      clearTimeout(timeout);
    }
  }

  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    return NextResponse.json(
      data,
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Cloudflare-CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
        },
      }
    );
  }

  return NextResponse.json(data, {
    headers: homepageCacheHeaders(HOMEPAGE_CDN_SECONDS),
  });
}
