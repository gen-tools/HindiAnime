import { NextResponse } from "next/server";
import { getHomepageData } from "@/lib/api/client";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  const data = await getHomepageData();
  if (data.trendingItems.length === 0 && data.latestEpisodes.length === 0) {
    return NextResponse.json(
      { error: "Homepage activity feed is temporarily unavailable" },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }

  return NextResponse.json(data, {
    headers: {
      "Cache-Control": "public, max-age=0, s-maxage=300, stale-while-revalidate=600",
    },
  });
}
