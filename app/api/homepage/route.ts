import { NextResponse } from "next/server";
import { getFallbackHomepageData, getHomepageData, mapHomepageFeedToData } from "@/lib/api/client";
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

const HOMEPAGE_ROUTE_TIMEOUT_MS = 12_000;

function homepageFallbackResponse() {
  return NextResponse.json(getFallbackHomepageData(), {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Cloudflare-CDN-Cache-Control": "no-store",
      "Vercel-CDN-Cache-Control": "no-store",
    },
  });
}

export async function GET() {
  // Bound the complete refresh, not only the final direct-Worker fallback.
  // A stalled cache/upstream operation must never leave this API request open.
  let routeTimeout: ReturnType<typeof setTimeout> | undefined;
  const routeDeadline = new Promise<"timeout">((resolve) => {
    routeTimeout = setTimeout(() => resolve("timeout"), HOMEPAGE_ROUTE_TIMEOUT_MS);
  });

  const refresh = (async () => {
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
        // Keep the bundled fallback when the direct Worker request fails.
      } finally {
        clearTimeout(timeout);
      }
    }

    if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
      return NextResponse.json(data, {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate",
          "Cloudflare-CDN-Cache-Control": "no-store",
          "Vercel-CDN-Cache-Control": "no-store",
        },
      });
    }

    return NextResponse.json(data, {
      headers: homepageCacheHeaders(HOMEPAGE_CDN_SECONDS),
    });
  })();

  try {
    const result = await Promise.race([refresh, routeDeadline]);
    if (result === "timeout") return homepageFallbackResponse();
    return result;
  } catch {
    return homepageFallbackResponse();
  } finally {
    if (routeTimeout) clearTimeout(routeTimeout);
  }
}
