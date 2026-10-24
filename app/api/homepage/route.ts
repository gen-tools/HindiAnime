import { NextResponse } from "next/server";
import { getHomepageData } from "@/lib/api/client";

export const runtime = "nodejs";
export const revalidate = 300;

function homepageCacheHeaders(edgeTtlSeconds: number) {
  return {
    // Visitors should revalidate in their browser; shared edges may reuse this
    // public feed for a short, explicit interval.
    "Cache-Control": `public, max-age=0, s-maxage=${edgeTtlSeconds}`,
    "Cloudflare-CDN-Cache-Control": `public, max-age=${edgeTtlSeconds}`,
  };
}

export async function GET() {
  const data = await getHomepageData();
  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    // This is a valid fallback snapshot, not a server error. The browser
    // already keeps its rendered data when the feed has no fresh activity.
    return NextResponse.json(
      data,
      { headers: homepageCacheHeaders(60) }
    );
  }

  return NextResponse.json(data, {
    headers: homepageCacheHeaders(300),
  });
}
