import { NextResponse } from "next/server";
import { getHomepageData } from "@/lib/api/client";

export const runtime = "nodejs";
const HOMEPAGE_CDN_SECONDS = 900;
// The live feed is shared across visitors and is cached at Vercel's CDN. Keep
// the route itself dynamic so refreshing this JSON does not create durable ISR
// output writes; getHomepageData still uses the validated 15-minute data cache.
export const dynamic = "force-dynamic";

function homepageCacheHeaders(edgeTtlSeconds: number) {
  const sharedCacheControl = `public, max-age=0, s-maxage=${edgeTtlSeconds}, stale-while-revalidate=300`;
  return {
    // Visitors should revalidate in their browser; shared edges may reuse this
    // public feed for a short, explicit interval. Empty fallbacks use the
    // shorter TTL passed by GET so an upstream hiccup is not cached as data.
    "Cache-Control": sharedCacheControl,
    "Vercel-CDN-Cache-Control": `public, s-maxage=${edgeTtlSeconds}, stale-while-revalidate=300`,
    "Cloudflare-CDN-Cache-Control": `public, max-age=${edgeTtlSeconds}`,
  };
}

export async function GET() {
  // This endpoint is already shared-cached at the CDN. Resolve a fresh parsed
  // AnimeSalt feed on each cache refresh instead of reusing a failed scraper
  // result/cooldown from the server data cache.
  const data = await getHomepageData({ diagnostics: true });
  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    // This is a valid fallback snapshot, not a server error. The browser
    // already keeps its rendered data when the feed has no fresh activity.
    return NextResponse.json(
      data,
      { headers: homepageCacheHeaders(60) }
    );
  }

  return NextResponse.json(data, {
    headers: homepageCacheHeaders(HOMEPAGE_CDN_SECONDS),
  });
}
